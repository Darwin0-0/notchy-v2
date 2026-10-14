use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{broadcast, oneshot, Mutex as AsyncMutex},
};
use tokio_util::sync::CancellationToken;

use crate::error::ApiError;

type Result<T> = std::result::Result<T, ApiError>;
const DEFAULT_FRAME_BYTES: usize = 6_000_000;
const MAX_FRAME_BYTES: usize = 12_000_000;
const MAX_REQUEST_BYTES: usize = 4096;

pub async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    maximum: usize,
) -> Result<Option<Vec<u8>>> {
    let maximum = if maximum == 0 {
        DEFAULT_FRAME_BYTES
    } else {
        maximum.min(MAX_FRAME_BYTES)
    };
    let mut frame = Vec::new();
    loop {
        let (consumed, complete) = {
            let bytes = reader
                .fill_buf()
                .await
                .map_err(|_| ApiError::new(503, "Composant Windows indisponible."))?;
            if bytes.is_empty() {
                return if frame.is_empty() {
                    Ok(None)
                } else {
                    Err(ApiError::new(503, "Réponse Windows incomplète."))
                };
            }
            let newline = bytes.iter().position(|byte| *byte == b'\n');
            let length = newline.unwrap_or(bytes.len());
            if frame.len().saturating_add(length) > maximum {
                return Err(ApiError::new(503, "Réponse Windows trop volumineuse."));
            }
            frame.extend_from_slice(&bytes[..length]);
            (length + usize::from(newline.is_some()), newline.is_some())
        };
        reader.consume(consumed);
        if complete {
            return Ok(Some(frame));
        }
    }
}
pub(crate) fn parse_frame(bytes: &[u8]) -> Result<Value> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| ApiError::new(503, "Réponse Windows invalide."))?;
    if !value.is_object() {
        return Err(ApiError::new(503, "Réponse Windows invalide."));
    }
    Ok(value)
}

struct Pending {
    generation: u64,
    sender: oneshot::Sender<Result<Value>>,
}
struct Process {
    generation: u64,
    input: Arc<AsyncMutex<ChildStdin>>,
    cancel: CancellationToken,
    done: Arc<AsyncMutex<Option<oneshot::Receiver<()>>>>,
}
#[derive(Default)]
struct State {
    process: Option<Process>,
    generation: u64,
    sequence: u32,
    disposed: bool,
    pending: HashMap<u32, Pending>,
}
struct Inner {
    executable: PathBuf,
    args: Vec<String>,
    maximum: usize,
    timeout: Duration,
    state: Mutex<State>,
    events: broadcast::Sender<Value>,
}

#[derive(Clone)]
pub struct Bridge {
    inner: Arc<Inner>,
}

impl Bridge {
    pub fn new(executable: PathBuf, args: Vec<String>, maximum: usize, timeout: Duration) -> Self {
        let (events, _) = broadcast::channel(16);
        Self {
            inner: Arc::new(Inner {
                executable,
                args,
                maximum: if maximum == 0 {
                    DEFAULT_FRAME_BYTES
                } else {
                    maximum.min(MAX_FRAME_BYTES)
                },
                timeout,
                state: Mutex::new(State::default()),
                events,
            }),
        }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.inner.events.subscribe()
    }

    fn start(&self) -> Result<(u64, Arc<AsyncMutex<ChildStdin>>)> {
        let mut state = self.inner.state.lock().unwrap();
        if state.disposed {
            return Err(ApiError::new(503, "Application fermée."));
        }
        if let Some(process) = &state.process {
            return Ok((process.generation, process.input.clone()));
        }
        let mut command = Command::new(&self.inner.executable);
        command
            .args(&self.inner.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|_| ApiError::new(503, "Composant Windows indisponible."))?;
        let input =
            Arc::new(AsyncMutex::new(child.stdin.take().ok_or_else(|| {
                ApiError::new(503, "Composant Windows indisponible.")
            })?));
        let mut output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or_else(|| ApiError::new(503, "Composant Windows indisponible."))?,
        );
        if let Some(mut errors) = child.stderr.take() {
            tokio::spawn(async move {
                let _ = tokio::io::copy(&mut errors, &mut tokio::io::sink()).await;
            });
        }
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        let cancel = CancellationToken::new();
        let (finished, done) = oneshot::channel();
        state.process = Some(Process {
            generation,
            input: input.clone(),
            cancel: cancel.clone(),
            done: Arc::new(AsyncMutex::new(Some(done))),
        });
        let bridge = self.clone();
        tokio::spawn(async move {
            let error = loop {
                tokio::select! {
                    _ = cancel.cancelled() => { break ApiError::new(503, "Composant Windows arrêté."); }
                    read = read_frame(&mut output, bridge.inner.maximum) => {
                        match read {
                            Ok(None) => break ApiError::new(503, "Composant Windows indisponible."),
                            Err(error) => break error,
                            Ok(Some(bytes)) if bytes.iter().all(u8::is_ascii_whitespace) => {},
                            Ok(Some(bytes)) => match parse_frame(&bytes) {
                                Err(error) => break error,
                                Ok(value) => bridge.dispatch(generation, value),
                            },
                        }
                    }
                }
            };
            let _ = bridge.fail_generation(generation, error);
            let _ = child.start_kill();
            let _ = child.wait().await;
            let _ = finished.send(());
        });
        Ok((generation, input))
    }

    fn dispatch(&self, generation: u64, value: Value) {
        let mut state = self.inner.state.lock().unwrap();
        if state.process.as_ref().map(|process| process.generation) != Some(generation) {
            return;
        }
        if value["event"] == "changed" && value.get("id").is_none() {
            let _ = self.inner.events.send(value);
            return;
        }
        let Some(id) = value["id"].as_u64().and_then(|id| u32::try_from(id).ok()) else {
            return;
        };
        if state.pending.get(&id).map(|pending| pending.generation) == Some(generation) {
            if let Some(pending) = state.pending.remove(&id) {
                let _ = pending.sender.send(Ok(value));
            }
        }
    }
    fn fail_generation(&self, generation: u64, error: ApiError) -> Option<Process> {
        let mut state = self.inner.state.lock().unwrap();
        if state.process.as_ref().map(|process| process.generation) != Some(generation) {
            return None;
        }
        let process = state.process.take();
        if let Some(process) = &process {
            process.cancel.cancel();
        }
        for (_, pending) in state.pending.drain() {
            let _ = pending.sender.send(Err(error.clone()));
        }
        process
    }

    pub async fn request(&self, mut value: Value) -> Result<Value> {
        let object = value
            .as_object_mut()
            .ok_or_else(|| ApiError::new(400, "Commande Windows invalide."))?;
        let command = object
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::new(400, "Commande Windows invalide."))?;
        if command.is_empty()
            || command.len() > 64
            || !command.as_bytes()[0].is_ascii_lowercase()
            || !command
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || object.contains_key("id")
        {
            return Err(ApiError::new(400, "Commande Windows invalide."));
        }
        let (generation, input) = self.start()?;
        let (sender, receiver) = oneshot::channel();
        let id = {
            let mut state = self.inner.state.lock().unwrap();
            if state.disposed
                || state.process.as_ref().map(|process| process.generation) != Some(generation)
            {
                return Err(ApiError::new(503, "Composant Windows arrêté."));
            }
            if state.pending.len() >= 2 {
                return Err(ApiError::new(409, "Commande Windows déjà en cours."));
            }
            state.sequence = if state.sequence >= i32::MAX as u32 {
                1
            } else {
                state.sequence + 1
            };
            while state.pending.contains_key(&state.sequence) {
                state.sequence += 1;
            }
            let id = state.sequence;
            state.pending.insert(id, Pending { generation, sender });
            id
        };
        let _cleanup = PendingCleanup {
            inner: self.inner.clone(),
            id,
            generation,
        };
        value["id"] = Value::from(id);
        let mut message = serde_json::to_vec(&value)
            .map_err(|_| ApiError::new(400, "Commande Windows invalide."))?;
        if message.len() >= MAX_REQUEST_BYTES {
            return Err(ApiError::new(400, "Commande Windows trop volumineuse."));
        }
        message.push(b'\n');
        let result = tokio::time::timeout(self.inner.timeout, async {
            input
                .lock()
                .await
                .write_all(&message)
                .await
                .map_err(|_| ApiError::new(503, "Composant Windows indisponible."))?;
            receiver
                .await
                .unwrap_or_else(|_| Err(ApiError::new(503, "Composant Windows indisponible.")))
        })
        .await;
        match result {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => {
                self.fail_generation(generation, error.clone());
                Err(error)
            }
            Err(_) => {
                let error = ApiError::new(504, "Délai Windows dépassé.");
                self.fail_generation(generation, error.clone());
                Err(error)
            }
        }
    }
    pub async fn stop(&self) {
        let generation = self
            .inner
            .state
            .lock()
            .unwrap()
            .process
            .as_ref()
            .map(|process| process.generation);
        if let Some(generation) = generation {
            if let Some(process) =
                self.fail_generation(generation, ApiError::new(503, "Composant Windows arrêté."))
            {
                if let Some(done) = process.done.lock().await.take() {
                    let _ = tokio::time::timeout(Duration::from_secs(1), done).await;
                }
            }
        }
    }
    pub async fn dispose(&self) {
        self.inner.state.lock().unwrap().disposed = true;
        self.stop().await;
    }
}
struct PendingCleanup {
    inner: Arc<Inner>,
    id: u32,
    generation: u64,
}
impl Drop for PendingCleanup {
    fn drop(&mut self) {
        let mut state = self.inner.state.lock().unwrap();
        if state
            .pending
            .get(&self.id)
            .map(|pending| pending.generation)
            == Some(self.generation)
        {
            state.pending.remove(&self.id);
        }
    }
}

#[cfg(all(test, windows))]
pub(crate) fn test_helper() -> (tempfile::TempDir, PathBuf) {
    use std::os::windows::process::CommandExt;
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("Fixture.cs");
    let executable = temporary.path().join("Fixture.exe");
    std::fs::write(&source, r##"
using System; using System.Text.RegularExpressions; using System.Threading;
class Fixture {
 static int Id(string line){return Int32.Parse(Regex.Match(line,"\\\"id\\\":([0-9]+)").Groups[1].Value);}
 static void Send(int id){Console.WriteLine("{\"id\":"+id+",\"ok\":true}");Console.Out.Flush();}
 static void Main(string[] args){Console.OutputEncoding=new System.Text.UTF8Encoding(false);string mode=args.Length>0?args[0]:"watcher";
  if(mode=="watcher"){Console.WriteLine("{\"text\":\"INITIAL MUST NOT BE CAPTURED\"}");Console.WriteLine("{\"ready\":true}");Console.Out.Flush();Thread.Sleep(40);Console.WriteLine("{\"text\":\"Fixture copied after explicit activation\"}");Console.Out.Flush();Thread.Sleep(30000);return;}
  if(mode=="oversize"){Console.Write(new String('x',8192));Console.Out.Flush();Thread.Sleep(30000);return;}
  string first=Console.ReadLine();if(mode=="hang"){Thread.Sleep(30000);return;}if(mode=="exit")return;
  if(mode=="reorder"){string second=Console.ReadLine();Send(Id(second));Send(Id(first));Thread.Sleep(30000);return;}
  while(first!=null){Console.WriteLine("{\"event\":\"changed\"}");Send(Id(first));first=Console.ReadLine();}
 }
}
"##).unwrap();
    let directory = std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:/Windows"));
    let compiler = directory.join("Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    let output = std::process::Command::new(compiler)
        .creation_flags(0x08000000)
        .arg("/nologo")
        .arg("/target:exe")
        .arg(format!("/out:{}", executable.display()))
        .arg(source)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Fake helper compilation failed: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    (temporary, executable)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn incomplete_frames_are_bounded_before_a_newline_exists() {
        let mut reader = BufReader::new(&b"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"[..]);
        assert_eq!(
            read_frame(&mut reader, 32).await.unwrap_err().message,
            "Réponse Windows trop volumineuse."
        );
    }
    #[tokio::test]
    async fn split_utf8_frames_and_crlf_decode_without_splitting_strings() {
        let value = "{\"id\":1,\"text\":\"été\"}\r\n{\"event\":\"changed\"}\n".as_bytes();
        let mut reader = BufReader::with_capacity(1, value);
        let first = parse_frame(&read_frame(&mut reader, 200).await.unwrap().unwrap()).unwrap();
        assert_eq!(first["text"], "été");
        let second = parse_frame(&read_frame(&mut reader, 200).await.unwrap().unwrap()).unwrap();
        assert_eq!(second["event"], "changed");
        assert!(read_frame(&mut reader, 200).await.unwrap().is_none());
        assert!(parse_frame(b"[]").is_err());
        assert!(parse_frame(b"bad").is_err());
    }
    #[tokio::test]
    async fn invalid_commands_and_disposal_never_start_a_helper() {
        let bridge = Bridge::new(
            PathBuf::from("does-not-exist.exe"),
            vec![],
            0,
            Duration::from_secs(1),
        );
        assert_eq!(
            bridge
                .request(serde_json::json!({"command":"Get"}))
                .await
                .unwrap_err()
                .status,
            400
        );
        assert_eq!(
            bridge
                .request(serde_json::json!({"command":"get","id":1}))
                .await
                .unwrap_err()
                .status,
            400
        );
        bridge.dispose().await;
        assert_eq!(
            bridge
                .request(serde_json::json!({"command":"get"}))
                .await
                .unwrap_err()
                .status,
            503
        );
    }
    #[tokio::test]
    async fn a_response_from_an_old_process_cannot_resolve_a_new_request() {
        let bridge = Bridge::new(PathBuf::new(), vec![], 0, Duration::from_secs(1));
        let (sender, mut receiver) = oneshot::channel();
        bridge.inner.state.lock().unwrap().pending.insert(
            1,
            Pending {
                generation: 2,
                sender,
            },
        );
        bridge.dispatch(1, serde_json::json!({"id":1,"ok":true}));
        assert!(matches!(
            receiver.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn helper_replies_are_correlated_and_events_are_broadcast() {
        let (_temporary, executable) = test_helper();
        let bridge = Bridge::new(
            executable.clone(),
            vec!["echo".into()],
            1024,
            Duration::from_secs(2),
        );
        let mut events = bridge.subscribe();
        let reply = bridge
            .request(serde_json::json!({"command":"get"}))
            .await
            .unwrap();
        assert_eq!(reply["ok"], true);
        assert_eq!(events.recv().await.unwrap()["event"], "changed");
        bridge.dispose().await;
        let reorder = Bridge::new(
            executable,
            vec!["reorder".into()],
            1024,
            Duration::from_secs(2),
        );
        let (first, second) = tokio::join!(
            reorder.request(serde_json::json!({"command":"get"})),
            reorder.request(serde_json::json!({"command":"toggle"}))
        );
        assert_eq!(first.unwrap()["id"], 1);
        assert_eq!(second.unwrap()["id"], 2);
        reorder.dispose().await;
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn pending_limits_timeout_and_oversized_unterminated_frames_stop_only_their_helper() {
        let (_temporary, executable) = test_helper();
        let bridge = Bridge::new(
            executable.clone(),
            vec!["hang".into()],
            1024,
            Duration::from_millis(300),
        );
        let first = {
            let bridge = bridge.clone();
            tokio::spawn(async move { bridge.request(serde_json::json!({"command":"get"})).await })
        };
        let second = {
            let bridge = bridge.clone();
            tokio::spawn(async move { bridge.request(serde_json::json!({"command":"get"})).await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if bridge.inner.state.lock().unwrap().pending.len() == 2 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            bridge
                .request(serde_json::json!({"command":"get"}))
                .await
                .unwrap_err()
                .status,
            409
        );
        assert!(first.await.unwrap().is_err());
        assert!(second.await.unwrap().is_err());
        assert!(bridge.inner.state.lock().unwrap().process.is_none());
        bridge.dispose().await;
        let oversized = Bridge::new(
            executable,
            vec!["oversize".into()],
            32,
            Duration::from_secs(2),
        );
        let result = oversized
            .request(serde_json::json!({"command":"get"}))
            .await
            .unwrap_err();
        assert_eq!(result.message, "Réponse Windows trop volumineuse.");
        oversized.dispose().await;
    }
}
