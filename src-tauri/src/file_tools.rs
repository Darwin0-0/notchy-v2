use base64::{engine::general_purpose::STANDARD, Engine};
use bytes::Bytes;
use futures_util::Stream;
use image::{DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader};
use lopdf::{dictionary, Document, Object, Stream as PdfStream};
use serde_json::{json, Value};
use std::{
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{watch, Mutex},
};

use crate::{
    error::ApiError,
    shelf::{extension, token, valid_id, SharedFile, Shelf, ShelfFile},
};

pub const FORMATS: [&str; 5] = ["png", "jpeg", "webp", "pdf", "svg"];
pub const MAX_TEXT: usize = 1_000_000;
const INPUT_BYTES: u64 = 25 * 1024 * 1024;
const OUTPUT_BYTES: usize = 80 * 1024 * 1024;
const PIXELS: u64 = 40_000_000;
const PDF_PAGES: usize = 100;
const PROCESS_OUTPUT: u64 = 8 * 1024 * 1024;
type Result<T> = std::result::Result<T, ApiError>;

fn error(status: u16, message: impl ToString) -> ApiError {
    ApiError::new(status, message)
}
fn idle() -> Value {
    json!({"status":"idle","stage":"","progress":null,"text":"","result":null,"error":""})
}
fn file_title(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn result_name(name: &str, ending: &str) -> String {
    let mut stem = file_title(name);
    while stem.len() + ending.len() > 255 {
        stem.pop();
    }
    format!("{stem}{ending}")
}
fn input_item(mut item: Value) -> Value {
    if item["thumbnail"].is_string() {
        item["thumbnail"] = json!(format!(
            "/api/files/input/{}?preview=1",
            item["id"].as_str().unwrap_or("")
        ));
    }
    item
}
async fn cancellation(mut receiver: watch::Receiver<bool>) {
    while !*receiver.borrow() {
        if receiver.changed().await.is_err() {
            return;
        }
    }
}

#[cfg(windows)]
struct WorkerJob(usize);
#[cfg(windows)]
impl WorkerJob {
    fn attach(child: &tokio::process::Child) -> Result<Self> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(error(503, "Le traitement local ne peut pas être isolé."));
            }
            let job = Self(handle as usize);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.ProcessMemoryLimit = 512 * 1024 * 1024;
            let process = child
                .raw_handle()
                .ok_or_else(|| error(503, "Le traitement local n’a pas pu démarrer."))?;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, process) == 0
            {
                return Err(error(503, "Le traitement local ne peut pas être isolé."));
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for WorkerJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}

struct LimitedOutput {
    cursor: Cursor<Vec<u8>>,
    limit: usize,
}
impl LimitedOutput {
    fn new(limit: usize) -> Self {
        Self {
            cursor: Cursor::new(Vec::new()),
            limit,
        }
    }
    fn into_inner(self) -> Vec<u8> {
        self.cursor.into_inner()
    }
}
impl Write for LimitedOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.cursor.position().saturating_add(bytes.len() as u64) > self.limit as u64 {
            return Err(std::io::Error::other(
                "Le fichier converti dépasse la limite de sortie.",
            ));
        }
        std::io::Write::write(&mut self.cursor, bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        std::io::Write::flush(&mut self.cursor)
    }
}
impl std::io::Seek for LimitedOutput {
    fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {
        let previous = self.cursor.position();
        let next = std::io::Seek::seek(&mut self.cursor, position)?;
        if next > self.limit as u64 {
            self.cursor.set_position(previous);
            return Err(std::io::Error::other(
                "Le fichier converti dépasse la limite de sortie.",
            ));
        }
        Ok(next)
    }
}

#[derive(Clone)]
pub struct FileTools {
    shelf: Shelf,
    staging: Shelf,
    temporary: Arc<tempfile::TempDir>,
    helper: Arc<PathBuf>,
    state: Arc<Mutex<Value>>,
    cancel: Arc<Mutex<Option<watch::Sender<bool>>>>,
    busy: Arc<AtomicBool>,
    saving: Arc<AtomicBool>,
    capabilities_cache: Arc<Mutex<Option<Value>>>,
}

impl FileTools {
    pub async fn new(shelf: Shelf, helper_path: PathBuf) -> anyhow::Result<Self> {
        let temporary = tempfile::Builder::new().prefix("notchy-files-").tempdir()?;
        let staging = Shelf::new(temporary.path().to_path_buf()).await?;
        Ok(Self {
            shelf,
            staging,
            temporary: Arc::new(temporary),
            helper: Arc::new(helper_path),
            state: Arc::new(Mutex::new(idle())),
            cancel: Arc::new(Mutex::new(None)),
            busy: Arc::new(AtomicBool::new(false)),
            saving: Arc::new(AtomicBool::new(false)),
            capabilities_cache: Arc::new(Mutex::new(None)),
        })
    }

    pub async fn get_state(&self) -> Value {
        self.state.lock().await.clone()
    }

    pub async fn dispose(&self) {
        if let Some(cancel) = self.cancel.lock().await.as_ref() {
            let _ = cancel.send(true);
        }
        let _ = tokio::time::timeout(Duration::from_secs(5), async {
            while self.busy.load(Ordering::Acquire) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
    }

    pub async fn capabilities(&self) -> Value {
        let mut cache = self.capabilities_cache.lock().await;
        if let Some(value) = &*cache {
            return value.clone();
        }
        let (_sender, cancel) = watch::channel(false);
        let native = match self
            .process(
                self.helper.as_ref(),
                &[],
                json!({"command":"capabilities"}),
                cancel,
                Duration::from_secs(15),
                None,
            )
            .await
        {
            Ok(value) if valid_capabilities(&value) => {
                json!({"ok":true,"available":value["available"],"languages":value["languages"],"defaultLanguage":value["defaultLanguage"],"maxImageDimension":value["maxImageDimension"],"maxPages":20,"maxFileBytes":64*1024*1024})
            }
            _ => {
                json!({"ok":false,"available":false,"languages":[],"maxPages":20,"maxFileBytes":64*1024*1024,"error":"Le moteur OCR Windows est indisponible sur ce PC."})
            }
        };
        let value = json!({"convert":{"available":true,"formats":FORMATS,"inputFormats":["png","jpeg","webp","gif","tiff","bmp"],"svgRasterEmbedded":true,"webpLossless":true},"extract":{"available":true,"image":native["available"],"pdf":true,"error":native["error"]},"ocr":native,"pdf":{"available":true},"limits":{"inputBytes":INPUT_BYTES,"pixels":PIXELS,"outputBytes":OUTPUT_BYTES,"pages":PDF_PAGES,"textCharacters":MAX_TEXT}});
        *cache = Some(value.clone());
        value
    }

    pub async fn add_input_stream<S, E>(
        &self,
        name: &str,
        source: S,
        size: Option<u64>,
    ) -> Result<Value>
    where
        S: Stream<Item = std::result::Result<Bytes, E>> + Send,
        E: std::fmt::Display + Send,
    {
        let result = self.staging.add_stream(name, source, size).await?;
        Ok(json!({"item":input_item(result["item"].clone())}))
    }

    pub async fn open_input(&self, id: &str, preview: bool) -> Result<ShelfFile> {
        let mut opened = self.staging.open(id, preview).await?;
        opened.item = input_item(opened.item);
        Ok(opened)
    }

    pub async fn remove_input(&self, id: &str) -> Result<Value> {
        let state = self.state.lock().await;
        if state["source"]["id"] == id && self.busy.load(Ordering::Acquire) {
            return Err(error(
                409,
                "Annule le traitement avant de retirer ce fichier.",
            ));
        }
        drop(state);
        self.staging.remove(id).await?;
        Ok(json!({"ok":true}))
    }

    pub async fn keep(&self, id: &str) -> Result<Value> {
        let selected = self.staging.share_entries(&[id.to_string()]).await?;
        let file = &selected[0];
        self.shelf
            .add_path(
                file.item["name"].as_str().unwrap_or(""),
                &file.path,
                file.item["size"].as_u64().unwrap_or(0),
            )
            .await
    }

    pub async fn share_entries(&self, ids: &[String]) -> Result<Vec<SharedFile>> {
        self.staging.share_entries(ids).await
    }

    async fn source(&self, id: &str) -> Result<SharedFile> {
        let ids = [id.to_string()];
        match self.staging.share_entries(&ids).await {
            Ok(mut files) => Ok(files.remove(0)),
            Err(e) if e.status == 404 || e.status == 503 => {
                Ok(self.shelf.share_entries(&ids).await?.remove(0))
            }
            Err(e) => Err(e),
        }
    }

    pub async fn start(&self, value: Value) -> Result<Value> {
        let object = value
            .as_object()
            .ok_or_else(|| error(400, "Choisis un fichier et une action valides."))?;
        let id = value["id"].as_str().unwrap_or("");
        let command = value["command"].as_str().unwrap_or("");
        let quality = value.get("quality").and_then(Value::as_u64).unwrap_or(88);
        if !object
            .keys()
            .all(|key| ["id", "command", "format", "quality"].contains(&key.as_str()))
            || !valid_id(id)
            || !["convert", "ocr"].contains(&command)
            || command == "convert" && !FORMATS.contains(&value["format"].as_str().unwrap_or(""))
            || value.get("quality").is_some()
                && (value["quality"].as_u64().is_none() || !(1..=100).contains(&quality))
        {
            return Err(error(400, "Choisis un fichier et une action valides."));
        }
        if self.saving.load(Ordering::Acquire)
            || self
                .busy
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
        {
            return Err(error(
                409,
                "Un fichier est en cours de traitement ou d’annulation.",
            ));
        }
        let job_id = token();
        let (sender, cancel) = watch::channel(false);
        *self.cancel.lock().await = Some(sender);
        let state = json!({"jobId":job_id,"status":"running","command":command,"source":{"id":id},"stage":"inspecting","progress":null,"text":"","result":null,"error":"","method":"","pages":0});
        *self.state.lock().await = state.clone();
        let service = self.clone();
        tokio::spawn(async move {
            let result = service.perform(&job_id, value, cancel.clone()).await;
            let mut state = service.state.lock().await;
            if state["jobId"] == job_id && state["status"] == "running" {
                if *cancel.borrow() {
                    state["status"] = json!("cancelled");
                } else if let Err(failure) = result {
                    state["status"] = json!("error");
                    state["error"] = json!(failure.message.chars().take(400).collect::<String>());
                } else {
                    state["status"] = json!("complete");
                }
                state["progress"] = Value::Null;
            }
            drop(state);
            let folder = service.temporary.path().join(format!("job-{job_id}"));
            if folder.parent() == Some(service.temporary.path()) {
                let _ = fs::remove_dir_all(folder).await;
            }
            *service.cancel.lock().await = None;
            service.busy.store(false, Ordering::Release);
        });
        Ok(state)
    }

    async fn update(&self, job_id: &str, stage: &str, progress: Value) {
        let mut state = self.state.lock().await;
        if state["jobId"] == job_id && state["status"] == "running" {
            state["stage"] = json!(stage);
            state["progress"] = progress;
        }
    }

    async fn perform(
        &self,
        job_id: &str,
        value: Value,
        cancel: watch::Receiver<bool>,
    ) -> Result<()> {
        let id = value["id"].as_str().unwrap_or("");
        let file = self.source(id).await?;
        let name = file.item["name"].as_str().unwrap_or("").to_string();
        {
            let mut state = self.state.lock().await;
            if state["jobId"] != job_id || state["status"] != "running" {
                return Err(error(409, "Opération annulée."));
            }
            state["source"] = json!({"id":id,"name":name,"size":file.item["size"],"kind":file.item["kind"],"extension":extension(&name)});
        }
        if *cancel.borrow() {
            return Err(error(409, "Opération annulée."));
        }
        let executable = std::env::current_exe()
            .map_err(|_| error(503, "Le traitement local n’a pas pu démarrer."))?;
        let folder = self.temporary.path().join(format!("job-{job_id}"));
        fs::create_dir(&folder)
            .await
            .map_err(|_| error(503, "Le stockage temporaire est indisponible."))?;
        let command = value["command"].as_str().unwrap_or("");
        if command == "convert" {
            self.update(job_id, "converting", Value::Null).await;
            let format = value["format"].as_str().unwrap_or("");
            let ext = if format == "jpeg" { "jpg" } else { format };
            let output_name = result_name(&name, &format!("-converti.{ext}"));
            let destination = folder.join(&output_name);
            let result = self.process(&executable, &["--notchy-file-worker"], json!({"command":"convert","file":{"path":file.path,"item":file.item},"format":format,"quality":value.get("quality").cloned().unwrap_or(json!(88)),"destination":destination}), cancel.clone(), Duration::from_secs(45), None).await?;
            if result["ok"] != true {
                return Err(error(
                    422,
                    result["error"]
                        .as_str()
                        .unwrap_or("La conversion a échoué."),
                ));
            }
            if *cancel.borrow() {
                return Err(error(409, "Opération annulée."));
            }
            self.update(job_id, "saving", Value::Null).await;
            let size = result["size"]
                .as_u64()
                .ok_or_else(|| error(503, "Le résultat de conversion est invalide."))?;
            let added = self
                .shelf
                .add_path(&output_name, &destination, size)
                .await?;
            let mut state = self.state.lock().await;
            if *cancel.borrow() || state["jobId"] != job_id || state["status"] != "running" {
                drop(state);
                if let Some(id) = added["item"]["id"].as_str() {
                    let _ = self.shelf.remove(id).await;
                }
                return Err(error(409, "Opération annulée."));
            }
            let mut item = added["item"].clone();
            item["type"] = json!(format);
            item["format"] = json!(format);
            item["rasterEmbedded"] = json!(format == "svg");
            item["firstFrameOnly"] = result["firstFrameOnly"].clone();
            item["download"] = json!(format!("/api/shelf/{}", item["id"].as_str().unwrap_or("")));
            if format == "webp" {
                item["lossless"] = json!(true);
            }
            state["result"] = item;
        } else {
            self.update(job_id, "extracting", Value::Null).await;
            let inspect = self
                .process(
                    &executable,
                    &["--notchy-file-worker"],
                    json!({"command":"extract","file":{"path":file.path,"item":file.item}}),
                    cancel.clone(),
                    Duration::from_secs(45),
                    None,
                )
                .await?;
            if inspect["ok"] != true {
                return Err(error(
                    422,
                    inspect["error"]
                        .as_str()
                        .unwrap_or("Ce fichier n’a pas pu être lu."),
                ));
            }
            let mut page_texts = inspect["pageTexts"].as_array().cloned().unwrap_or_default();
            let is_pdf = inspect["kind"] == "pdf";
            let empty = inspect["emptyPages"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let mut method = "pdf-text".to_string();
            if !is_pdf || !empty.is_empty() {
                if empty.len() > 20 {
                    return Err(error(422, "Ce PDF contient plus de 20 pages scannées. Sépare-le en lots de 20 pages maximum."));
                }
                self.update(job_id, "ocr", Value::Null).await;
                let target = folder.join(if is_pdf { "scan.pdf" } else { "scan.png" });
                if is_pdf {
                    let mut opened = match self.staging.open(id, false).await {
                        Ok(file) => file,
                        Err(failure) if failure.status == 404 => self.shelf.open(id, false).await?,
                        Err(failure) => return Err(failure),
                    };
                    let mut out = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&target)
                        .await
                        .map_err(|_| error(503, "Le stockage temporaire est indisponible."))?;
                    tokio::select! { result = tokio::io::copy(&mut opened.file,&mut out) => { result.map_err(|_| error(404,"Ce fichier n’est plus disponible."))?; }, _ = cancellation(cancel.clone()) => return Err(error(409,"Opération annulée.")) }
                    out.sync_all()
                        .await
                        .map_err(|_| error(503, "Le stockage temporaire est indisponible."))?;
                } else {
                    let converted = self.process(&executable, &["--notchy-file-worker"], json!({"command":"convert","file":{"path":file.path,"item":file.item},"format":"png","quality":90,"destination":target}), cancel.clone(), Duration::from_secs(45), None).await?;
                    if converted["ok"] != true {
                        return Err(error(
                            422,
                            converted["error"]
                                .as_str()
                                .unwrap_or("Ce fichier ne peut pas être reconnu localement."),
                        ));
                    }
                }
                let recognized = self.process(self.helper.as_ref(), &[], json!({"command":"recognize","path":target,"pages":if is_pdf {json!(empty)} else {Value::Null}}), cancel.clone(), Duration::from_secs(240), Some(job_id)).await?;
                let requested = if is_pdf { Some(empty.as_slice()) } else { None };
                if !valid_ocr_result(&recognized, requested) {
                    return Err(error(503, "Le moteur OCR a renvoyé une réponse invalide."));
                }
                if is_pdf {
                    for page in recognized["pageTexts"].as_array().unwrap() {
                        let number = page["page"].as_u64().unwrap_or(0);
                        if number == 0 || number as usize > page_texts.len() {
                            return Err(error(
                                503,
                                "Le moteur OCR a renvoyé une réponse invalide.",
                            ));
                        }
                        page_texts[number as usize - 1] = page["text"].clone();
                    }
                    method = "pdf-text+windows-ocr".into();
                } else {
                    page_texts = recognized["pageTexts"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|x| x["text"].clone())
                        .collect();
                    method = "windows-ocr".into();
                }
            }
            let text = page_texts
                .iter()
                .map(|x| x.as_str().unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n\n");
            if text.chars().count() > MAX_TEXT || text.contains('\0') {
                return Err(error(413, "Le texte dépasse la limite de ce panneau."));
            }
            if text.trim().is_empty() {
                return Err(error(422, "Aucun texte lisible n’a été trouvé."));
            }
            let mut state = self.state.lock().await;
            if state["jobId"] == job_id && state["status"] == "running" && !*cancel.borrow() {
                state["text"] = json!(text);
                state["method"] = json!(method);
                state["pages"] = json!(page_texts.len());
                state["result"] = json!({"name":result_name(&name,".txt"),"type":"text","characters":text.chars().count()});
            }
        }
        Ok(())
    }

    pub async fn cancel(&self, job_id: &str) -> Result<Value> {
        let mut state = self.state.lock().await;
        if !valid_id(job_id) || state["jobId"] != job_id || state["status"] != "running" {
            return Err(error(409, "Ce traitement n’est plus actif."));
        }
        if let Some(cancel) = self.cancel.lock().await.as_ref() {
            let _ = cancel.send(true);
        }
        state["status"] = json!("cancelled");
        state["progress"] = Value::Null;
        Ok(state.clone())
    }

    pub async fn save(&self, job_id: &str, value: Option<String>) -> Result<Value> {
        if self
            .saving
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(error(409, "Un texte est encore en cours d’enregistrement."));
        }
        let result = async {
            let snapshot = self.get_state().await;
            if !valid_id(job_id)
                || snapshot["jobId"] != job_id
                || snapshot["status"] != "complete"
                || snapshot["command"] != "ocr"
            {
                return Err(error(409, "Ce texte n’est plus disponible."));
            }
            let text = value.unwrap_or_else(|| snapshot["text"].as_str().unwrap_or("").to_string());
            if text.chars().count() > MAX_TEXT || text.contains('\0') {
                return Err(error(400, "Texte invalide."));
            }
            let name = snapshot["result"]["name"].as_str().unwrap_or("texte.txt");
            let added = self.shelf.add_bytes(name, text.into_bytes()).await?;
            let mut state = self.state.lock().await;
            if state["jobId"] != job_id {
                drop(state);
                if let Some(id) = added["item"]["id"].as_str() {
                    let _ = self.shelf.remove(id).await;
                }
                return Err(error(409, "Ce texte n’est plus disponible."));
            }
            let mut result = added["item"].clone();
            let download = format!("/api/shelf/{}", result["id"].as_str().unwrap_or(""));
            result["type"] = json!("text");
            result["saved"] = json!(true);
            result["download"] = json!(download);
            state["result"] = result;
            Ok(json!({"item":added["item"],"download":download}))
        }
        .await;
        self.saving.store(false, Ordering::Release);
        result
    }

    async fn process(
        &self,
        executable: &Path,
        args: &[&str],
        input: Value,
        cancel: watch::Receiver<bool>,
        duration: Duration,
        job_id: Option<&str>,
    ) -> Result<Value> {
        if *cancel.borrow() {
            return Err(error(409, "Opération annulée."));
        }
        let encoded = serde_json::to_vec(&input)
            .map_err(|_| error(400, "La demande de traitement est invalide."))?;
        if encoded.len() > 16_000 {
            return Err(error(400, "La demande de traitement est invalide."));
        }
        let operation = async {
            let mut command = Command::new(executable);
            command
                .args(args)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            {
                command.creation_flags(0x08000000);
            }
            let mut child = command
                .spawn()
                .map_err(|_| error(503, "Le traitement local n’a pas pu démarrer."))?;
            #[cfg(windows)]
            let _isolation = WorkerJob::attach(&child)?;
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| error(503, "Le traitement local n’a pas pu démarrer."))?;
            stdin
                .write_all(&encoded)
                .await
                .map_err(|_| error(503, "Le traitement local n’a pas pu démarrer."))?;
            stdin
                .write_all(b"\n")
                .await
                .map_err(|_| error(503, "Le traitement local n’a pas pu démarrer."))?;
            drop(stdin);
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| error(503, "Le traitement local n’a pas pu démarrer."))?;
            let mut reader = BufReader::new(stdout.take(PROCESS_OUTPUT + 1));
            let mut total = 0u64;
            let mut completed = 0u64;
            loop {
                let mut line = Vec::new();
                let size = reader
                    .read_until(b'\n', &mut line)
                    .await
                    .map_err(|_| error(503, "Le traitement local a été interrompu."))?;
                total += size as u64;
                if total > PROCESS_OUTPUT {
                    return Err(error(
                        503,
                        "Le traitement a renvoyé une réponse trop volumineuse.",
                    ));
                }
                if size == 0 {
                    return Err(error(503, "Le traitement local a été interrompu."));
                }
                if line.iter().all(u8::is_ascii_whitespace) {
                    continue;
                }
                let frame: Value = serde_json::from_slice(&line)
                    .map_err(|_| error(503, "Le traitement a renvoyé une réponse invalide."))?;
                if frame["type"] == "error" {
                    return Err(error(422, ocr_error(frame["code"].as_str().unwrap_or(""))));
                }
                if frame["type"] == "progress" {
                    let next = frame["completed"].as_u64().ok_or_else(|| {
                        error(503, "Le moteur OCR a renvoyé une réponse invalide.")
                    })?;
                    let count = frame["total"].as_u64().ok_or_else(|| {
                        error(503, "Le moteur OCR a renvoyé une réponse invalide.")
                    })?;
                    let page = frame["page"].as_u64().unwrap_or(0);
                    if !(1..=20).contains(&count)
                        || page == 0
                        || page > 2000
                        || next < completed
                        || next > count
                        || !["recognizing", "page-completed"]
                            .contains(&frame["stage"].as_str().unwrap_or(""))
                        || input["pages"]
                            .as_array()
                            .is_some_and(|pages| !pages.contains(&json!(page)))
                    {
                        return Err(error(503, "Le moteur OCR a renvoyé une réponse invalide."));
                    }
                    completed = next;
                    if let Some(id) = job_id {
                        self.update(
                            id,
                            "ocr",
                            json!({"current":next,"total":count,"label":"Reconnaissance du texte"}),
                        )
                        .await;
                    }
                    continue;
                }
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Ok(frame);
            }
        };
        tokio::select! {
            result = tokio::time::timeout(duration,operation) => result.map_err(|_|error(504,"Ce fichier prend trop de temps à traiter."))?,
            _ = cancellation(cancel) => Err(error(409,"Opération annulée.")),
        }
    }
}

fn ocr_error(code: &str) -> &'static str {
    match code {
        "language-unavailable" => "Aucune langue OCR compatible n’est installée dans Windows.",
        "ocr-unavailable" => "Le moteur OCR Windows n’est pas disponible sur ce PC.",
        "file-too-large" => "Le fichier doit peser moins de 64 Mo.",
        "image-too-large" => "Cette image dépasse la limite du moteur OCR.",
        "text-too-large" => "Le texte extrait dépasse la limite de ce panneau.",
        "timeout" => "L’extraction a dépassé le délai prévu. Essaie avec moins de pages.",
        _ => "Windows n’a pas pu reconnaître le texte de ce fichier.",
    }
}

fn valid_capabilities(value: &Value) -> bool {
    let Some(languages) = value["languages"].as_array() else {
        return false;
    };
    value["type"] == "capabilities"
        && value["available"].is_boolean()
        && languages.len() <= 100
        && value["maxImageDimension"]
            .as_u64()
            .is_some_and(|v| (1..=65536).contains(&v))
        && languages.iter().all(|language| {
            language["tag"].as_str().is_some_and(valid_language)
                && language["name"]
                    .as_str()
                    .is_some_and(|v| v.chars().count() <= 200)
        })
        && (value["available"] != true
            || !languages.is_empty()
                && languages
                    .iter()
                    .any(|language| language["tag"] == value["defaultLanguage"]))
}
fn valid_language(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn valid_ocr_result(value: &Value, requested: Option<&[Value]>) -> bool {
    let (Some(text), Some(pages), Some(records), Some(total), Some(language)) = (
        value["text"].as_str(),
        value["pages"].as_array(),
        value["pageTexts"].as_array(),
        value["totalPages"].as_u64(),
        value["language"].as_str(),
    ) else {
        return false;
    };
    if value["type"] != "result"
        || !value["truncated"].is_boolean()
        || !valid_language(language)
        || !(1..=2000).contains(&total)
        || pages.is_empty()
        || pages.len() > 20
        || pages.len() != records.len()
        || text.chars().count() > 512040
    {
        return false;
    }
    let mut unique = std::collections::HashSet::new();
    let mut texts = Vec::new();
    let mut length = 0;
    for (page, record) in pages.iter().zip(records) {
        let (Some(number), Some(text)) = (page.as_u64(), record["text"].as_str()) else {
            return false;
        };
        if number == 0 || number > total || !unique.insert(number) || record["page"] != *page {
            return false;
        }
        length += text.chars().count();
        texts.push(text);
    }
    length <= 512000
        && text == texts.join("\n\n")
        && requested.is_none_or(|requested| requested == pages.as_slice())
}

// The worker runs before Tauri starts, keeping untrusted decoders out of the UI process.
pub fn worker_main() {
    let result = (|| -> anyhow::Result<Value> {
        let mut input = Vec::new();
        std::io::stdin().take(16_001).read_to_end(&mut input)?;
        anyhow::ensure!(
            input.len() <= 16_000,
            "La demande de traitement est trop volumineuse."
        );
        let request: Value = serde_json::from_slice(&input)?;
        worker_request(&request)
    })();
    let output = match result {
        Ok(value) => value,
        Err(e) => json!({"ok":false,"error":e.to_string().chars().take(400).collect::<String>()}),
    };
    let _ = writeln!(std::io::stdout(), "{}", output);
}

fn worker_source(request: &Value) -> anyhow::Result<Vec<u8>> {
    let supplied = request["file"]["path"].as_str().unwrap_or("");
    let path = Path::new(supplied);
    anyhow::ensure!(
        path.is_absolute() && !supplied.chars().any(|c| c < '\u{20}' || c == '\u{7f}'),
        "Choisis un fichier local disponible."
    );
    let before = std::fs::symlink_metadata(path)
        .map_err(|_| anyhow::anyhow!("Ce fichier local est indisponible."))?;
    anyhow::ensure!(
        before.is_file() && !before.file_type().is_symlink(),
        "Ce fichier local est indisponible."
    );
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        anyhow::ensure!(
            before.file_attributes() & 0x400 == 0,
            "Ce fichier local est indisponible."
        );
    }
    anyhow::ensure!(
        before.len() > 0 && before.len() <= INPUT_BYTES,
        "Le fichier dépasse la limite de 25 Mo."
    );
    anyhow::ensure!(
        request["file"]["item"]["size"].as_u64() == Some(before.len()),
        "Le fichier a changé. Dépose-le de nouveau."
    );
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
    }
    let mut file = options
        .open(path)
        .map_err(|_| anyhow::anyhow!("Ce fichier local est indisponible."))?;
    let opened = file.metadata()?;
    anyhow::ensure!(
        opened.len() == before.len() && opened.modified().ok() == before.modified().ok(),
        "Le fichier a changé. Dépose-le de nouveau."
    );
    if let Some(expected) = request["file"]["item"]["modifiedAt"].as_u64() {
        let actual = opened
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis() as u64;
        anyhow::ensure!(
            actual == expected,
            "Le fichier a changé. Dépose-le de nouveau."
        );
    }
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(INPUT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    anyhow::ensure!(
        bytes.len() as u64 == before.len()
            && after.len() == before.len()
            && after.modified().ok() == before.modified().ok(),
        "Le fichier a changé. Dépose-le de nouveau."
    );
    Ok(bytes)
}

fn image_reader(bytes: &[u8]) -> anyhow::Result<ImageReader<Cursor<&[u8]>>> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| anyhow::anyhow!("Ce type d’image n’est pas pris en charge."))?;
    anyhow::ensure!(
        matches!(
            reader.format(),
            Some(
                ImageFormat::Png
                    | ImageFormat::Jpeg
                    | ImageFormat::WebP
                    | ImageFormat::Gif
                    | ImageFormat::Tiff
                    | ImageFormat::Bmp
            )
        ),
        "Ce type d’image n’est pas pris en charge."
    );
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    Ok(reader)
}

fn decode_image(bytes: &[u8]) -> anyhow::Result<DynamicImage> {
    let (width, height) = image_reader(bytes)?
        .into_dimensions()
        .map_err(|_| anyhow::anyhow!("Ce type d’image n’est pas pris en charge."))?;
    anyhow::ensure!(
        width > 0 && height > 0 && u64::from(width) * u64::from(height) <= PIXELS,
        "Cette image est trop grande pour être traitée."
    );
    let mut decoder = image_reader(bytes)?
        .into_decoder()
        .map_err(|_| anyhow::anyhow!("L’image ne peut pas être décodée."))?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|_| anyhow::anyhow!("L’image ne peut pas être décodée."))?;
    image.apply_orientation(orientation);
    Ok(image)
}

fn rgb_on_white(image: &DynamicImage) -> image::RgbImage {
    image::RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y).0;
        let alpha = u16::from(pixel[3]);
        image::Rgb(
            [0, 1, 2]
                .map(|i| ((u16::from(pixel[i]) * alpha + 255 * (255 - alpha) + 127) / 255) as u8),
        )
    })
}

fn jpeg_bytes(image: &DynamicImage, quality: u8) -> anyhow::Result<Vec<u8>> {
    let mut bytes = LimitedOutput::new(OUTPUT_BYTES);
    let rgb = rgb_on_white(image);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode_image(&DynamicImage::ImageRgb8(rgb))
        .map_err(|_| anyhow::anyhow!("La conversion JPEG a échoué."))?;
    Ok(bytes.into_inner())
}

fn image_pdf(image: &DynamicImage) -> anyhow::Result<Vec<u8>> {
    let mut document = Document::with_version("1.5");
    let pages_id = document.new_object_id();
    let image_id = document.add_object(PdfStream::new(dictionary!{"Type"=>"XObject","Subtype"=>"Image","Width"=>i64::from(image.width()),"Height"=>i64::from(image.height()),"ColorSpace"=>"DeviceRGB","BitsPerComponent"=>8,"Filter"=>"DCTDecode"},jpeg_bytes(image,95)?));
    let scale = (14400.0 / f64::from(image.width().max(image.height()))).min(1.0);
    let width = (f64::from(image.width()) * scale) as f32;
    let height = (f64::from(image.height()) * scale) as f32;
    let content = lopdf::content::Content {
        operations: vec![
            lopdf::content::Operation::new("q", vec![]),
            lopdf::content::Operation::new(
                "cm",
                vec![
                    width.into(),
                    0.into(),
                    0.into(),
                    height.into(),
                    0.into(),
                    0.into(),
                ],
            ),
            lopdf::content::Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
            lopdf::content::Operation::new("Q", vec![]),
        ],
    };
    let content_id = document.add_object(PdfStream::new(dictionary! {}, content.encode()?));
    let page_id = document.add_object(dictionary!{"Type"=>"Page","Parent"=>pages_id,"MediaBox"=>vec![0.into(),0.into(),width.into(),height.into()],"Resources"=>dictionary!{"XObject"=>dictionary!{"Im0"=>image_id}},"Contents"=>content_id});
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {"Type"=>"Pages","Kids"=>vec![page_id.into()],"Count"=>1}),
    );
    let root = document.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
    let info = document.add_object(dictionary! {"Creator"=>Object::string_literal("Notchy")});
    document.trailer.set("Root", root);
    document.trailer.set("Info", info);
    let mut bytes = LimitedOutput::new(OUTPUT_BYTES);
    document.save_to(&mut bytes)?;
    Ok(bytes.into_inner())
}

fn worker_request(request: &Value) -> anyhow::Result<Value> {
    let bytes = worker_source(request)?;
    let pdf = bytes
        .iter()
        .take(1024)
        .copied()
        .collect::<Vec<_>>()
        .windows(5)
        .any(|x| x == b"%PDF-");
    match request["command"].as_str() {
        Some("extract") if pdf => {
            let document = Document::load_mem(&bytes)
                .map_err(|_| anyhow::anyhow!("Ce PDF n’a pas pu être lu."))?;
            anyhow::ensure!(
                !document.is_encrypted() && !document.was_encrypted(),
                "Ce PDF est protégé par un mot de passe."
            );
            let pages = document.get_pages();
            anyhow::ensure!(
                !pages.is_empty() && pages.len() <= PDF_PAGES,
                "Ce PDF dépasse la limite de 100 pages."
            );
            let mut texts = Vec::new();
            let mut empty = Vec::new();
            let mut characters = 0;
            for number in pages.keys() {
                let text = document
                    .extract_text(&[*number])
                    .map_err(|_| anyhow::anyhow!("Le texte de ce PDF n’a pas pu être lu."))?
                    .trim()
                    .to_string();
                characters += text.chars().count() + 2;
                anyhow::ensure!(
                    characters <= MAX_TEXT,
                    "Le texte extrait dépasse la limite de caractères."
                );
                if text.is_empty() {
                    empty.push(*number);
                }
                texts.push(text);
            }
            Ok(
                json!({"ok":true,"kind":"pdf","pages":texts.len(),"pageTexts":texts,"emptyPages":empty,"method":"pdf-text"}),
            )
        }
        Some("extract") => {
            decode_image(&bytes)?;
            Ok(json!({"ok":true,"kind":"image"}))
        }
        Some("convert") => {
            anyhow::ensure!(
                !pdf,
                "Le convertisseur accepte une image. Pour un PDF, choisis Extraire le texte."
            );
            let format = request["format"].as_str().unwrap_or("");
            let quality = request["quality"].as_u64().unwrap_or(88);
            anyhow::ensure!(
                FORMATS.contains(&format) && (1..=100).contains(&quality),
                "Choisis un format et une qualité valides."
            );
            let image = decode_image(&bytes)?;
            let mut raster = LimitedOutput::new(if format == "svg" {
                (OUTPUT_BYTES - 4096) * 3 / 4
            } else {
                OUTPUT_BYTES
            });
            let output = match format {
                "jpeg" => jpeg_bytes(&image, quality as u8)?,
                "pdf" => image_pdf(&image)?,
                "webp" => {
                    image
                        .write_to(&mut raster, ImageFormat::WebP)
                        .map_err(|_| anyhow::anyhow!("La conversion WEBP a échoué."))?;
                    raster.into_inner()
                }
                _ => {
                    image
                        .write_to(&mut raster, ImageFormat::Png)
                        .map_err(|_| anyhow::anyhow!("La conversion PNG a échoué."))?;
                    if format == "svg" {
                        format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><title>Image raster intégrée — sans vectorisation</title><image width=\"{}\" height=\"{}\" href=\"data:image/png;base64,{}\"/></svg>",image.width(),image.height(),image.width(),image.height(),image.width(),image.height(),STANDARD.encode(raster.into_inner())).into_bytes()
                    } else {
                        raster.into_inner()
                    }
                }
            };
            anyhow::ensure!(
                output.len() <= OUTPUT_BYTES,
                "Le fichier converti dépasse la limite de sortie."
            );
            let destination = PathBuf::from(request["destination"].as_str().unwrap_or(""));
            anyhow::ensure!(
                destination.is_absolute()
                    && destination != PathBuf::from(request["file"]["path"].as_str().unwrap_or("")),
                "Choisis un emplacement de sortie valide."
            );
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&destination)
                .map_err(|_| {
                    anyhow::anyhow!("Le fichier de sortie existe déjà ou n’est pas accessible.")
                })?;
            file.write_all(&output)
                .map_err(|_| anyhow::anyhow!("Le résultat n’a pas pu être enregistré."))?;
            file.sync_all()?;
            let first_frame_only = image::guess_format(&bytes).ok() == Some(ImageFormat::Gif)
                && bytes
                    .windows(3)
                    .filter(|x| *x == [0x21, 0xf9, 0x04])
                    .count()
                    > 1;
            Ok(
                json!({"ok":true,"size":output.len(),"format":format,"width":image.width(),"height":image.height(),"rasterEmbedded":format=="svg","firstFrameOnly":first_frame_only,"lossless":format=="webp"}),
            )
        }
        _ => anyhow::bail!("Traitement invalide."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_budget_is_enforced_before_allocation() {
        let mut output = LimitedOutput::new(4);
        output.write_all(b"abcd").unwrap();
        assert!(output.write_all(b"e").is_err());
        assert!(std::io::Seek::seek(&mut output, std::io::SeekFrom::Start(1000)).is_err());
        assert_eq!(output.into_inner(), b"abcd");
    }
    fn fixture(path: &Path, bytes: &[u8]) -> Value {
        std::fs::write(path, bytes).unwrap();
        let metadata = std::fs::metadata(path).unwrap();
        json!({"path":path,"item":{"name":"photo.png","size":metadata.len(),"modifiedAt":metadata.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()as u64}})
    }
    fn png() -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            3,
            2,
            image::Rgba([10, 20, 30, 200]),
        ));
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap();
        output.into_inner()
    }
    #[test]
    fn all_conversion_formats_are_real_outputs() {
        let directory = tempfile::tempdir().unwrap();
        let source = fixture(&directory.path().join("input"), &png());
        for format in FORMATS {
            let destination = directory.path().join(format!("output.{format}"));
            let result=worker_request(&json!({"command":"convert","file":source,"format":format,"quality":85,"destination":destination})).unwrap();
            assert_eq!(result["ok"], true);
            let bytes = std::fs::read(destination).unwrap();
            assert!(!bytes.is_empty());
            match format {
                "svg" => assert!(String::from_utf8(bytes)
                    .unwrap()
                    .contains("data:image/png;base64,")),
                "pdf" => assert_eq!(Document::load_mem(&bytes).unwrap().get_pages().len(), 1),
                _ => assert!(image::load_from_memory(&bytes).is_ok()),
            }
        }
    }
    #[test]
    fn files_must_match_size_and_output_is_exclusive() {
        let directory = tempfile::tempdir().unwrap();
        let source = fixture(&directory.path().join("input"), &png());
        let target = directory.path().join("out.png");
        std::fs::write(&target, b"keep").unwrap();
        assert!(worker_request(&json!({"command":"convert","file":source,"format":"png","quality":85,"destination":target})).is_err());
        assert_eq!(std::fs::read(target).unwrap(), b"keep");
        let mut bad = source;
        bad["item"]["size"] = json!(100);
        assert!(worker_request(&json!({"command":"extract","file":bad})).is_err());
    }
    #[test]
    fn native_frames_are_validated() {
        let frame = json!({"type":"result","text":"bonjour","pages":[1],"pageTexts":[{"page":1,"text":"bonjour"}],"totalPages":1,"truncated":false,"language":"fr-FR"});
        assert!(valid_ocr_result(&frame, None));
        let mut bad = frame.clone();
        bad["text"] = json!("autre");
        assert!(!valid_ocr_result(&bad, None));
        assert!(!valid_ocr_result(&frame, Some(&[json!(2)])));
        assert!(valid_capabilities(
            &json!({"type":"capabilities","available":true,"languages":[{"tag":"fr-FR","name":"Français"}],"defaultLanguage":"fr-FR","maxImageDimension":10000})
        ));
    }
    #[test]
    fn existing_pdf_text_is_extracted_without_ocr() {
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document
            .add_object(dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica"});
        let content = lopdf::content::Content {
            operations: vec![
                lopdf::content::Operation::new("BT", vec![]),
                lopdf::content::Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 12.into()]),
                lopdf::content::Operation::new("Td", vec![50.into(), 100.into()]),
                lopdf::content::Operation::new(
                    "Tj",
                    vec![Object::string_literal("Bonjour Notchy")],
                ),
                lopdf::content::Operation::new("ET", vec![]),
            ],
        };
        let content_id =
            document.add_object(PdfStream::new(dictionary! {}, content.encode().unwrap()));
        let page_id=document.add_object(dictionary!{"Type"=>"Page","Parent"=>pages_id,"MediaBox"=>vec![0.into(),0.into(),300.into(),200.into()],"Resources"=>dictionary!{"Font"=>dictionary!{"F1"=>font_id}},"Contents"=>content_id});
        document.objects.insert(
            pages_id,
            Object::Dictionary(
                dictionary! {"Type"=>"Pages","Kids"=>vec![page_id.into()],"Count"=>1},
            ),
        );
        let root = document.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
        document.trailer.set("Root", root);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let source = fixture(&directory.path().join("pdf"), &bytes);
        let result = worker_request(&json!({"command":"extract","file":source})).unwrap();
        assert_eq!(result["kind"], "pdf");
        assert!(result["emptyPages"].as_array().unwrap().is_empty());
        assert!(result["pageTexts"][0]
            .as_str()
            .unwrap()
            .contains("Bonjour Notchy"));
    }
    #[test]
    fn deeply_nested_pdf_objects_are_rejected_without_aborting() {
        fn pdf(depth: usize) -> Vec<u8> {
            let objects = [
                format!("<< /Type /Catalog /Pages 2 0 R /X {}{} >>", "[".repeat(depth), "]".repeat(depth)),
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>".into(),
                "<< /Length 0 >>\nstream\n\nendstream".into(),
            ];
            let mut bytes = b"%PDF-1.4\n".to_vec();
            let mut offsets = Vec::new();
            for (index, object) in objects.iter().enumerate() {
                offsets.push(bytes.len());
                writeln!(bytes, "{} 0 obj\n{object}\nendobj", index + 1).unwrap();
            }
            let xref = bytes.len();
            write!(bytes, "xref\n0 5\n0000000000 65535 f \n").unwrap();
            for offset in offsets {
                writeln!(bytes, "{offset:010} 00000 n ").unwrap();
            }
            write!(bytes, "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").unwrap();
            bytes
        }
        let directory = tempfile::tempdir().unwrap();
        let control = fixture(&directory.path().join("control.pdf"), &pdf(2));
        let result = worker_request(&json!({"command":"extract","file":control})).unwrap();
        assert_eq!(result["kind"], "pdf");
        assert_eq!(result["pages"], 1);
        // This small fixture previously exhausted the parser stack in the worker.
        let nested = pdf(10_380);
        assert!(nested.len() < 50_000);
        let source = fixture(&directory.path().join("nested.pdf"), &nested);
        assert!(worker_request(&json!({"command":"extract","file":source})).is_err());
    }
    #[test]
    fn encrypted_pdfs_remain_rejected_after_automatic_empty_password_decryption() {
        let bytes = image_pdf(&image::load_from_memory(&png()).unwrap()).unwrap();
        let mut document = Document::load_mem(&bytes).unwrap();
        document.trailer.set("ID", Object::Array(vec![Object::string_literal("notchy-pdf-fixture"); 2]));
        let state = lopdf::EncryptionState::try_from(lopdf::EncryptionVersion::V2 {
            document: &document,
            owner_password: "fixture-owner",
            user_password: "",
            key_length: 128,
            permissions: lopdf::Permissions::all(),
        }).unwrap();
        document.encrypt(&state).unwrap();
        let mut encrypted = Vec::new();
        document.save_to(&mut encrypted).unwrap();
        let loaded = Document::load_mem(&encrypted).unwrap();
        assert!(!loaded.is_encrypted());
        assert!(loaded.was_encrypted());
        let directory = tempfile::tempdir().unwrap();
        let source = fixture(&directory.path().join("encrypted.pdf"), &encrypted);
        let error = worker_request(&json!({"command":"extract","file":source})).unwrap_err();
        assert!(error.to_string().contains("protégé par un mot de passe"));
    }
    #[tokio::test]
    async fn already_cancelled_jobs_never_start_a_process() {
        let directory = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(directory.path().join("shelf")).await.unwrap();
        let tools = FileTools::new(shelf, directory.path().join("missing.exe"))
            .await
            .unwrap();
        let (_sender, cancel) = watch::channel(true);
        let result = tools
            .process(
                Path::new("does-not-exist.exe"),
                &[],
                json!({}),
                cancel,
                Duration::from_millis(10),
                None,
            )
            .await;
        assert_eq!(result.unwrap_err().status, 409);
        assert!(tools
            .start(json!({"id":"bad","command":"convert","format":"png"}))
            .await
            .is_err());
    }
    #[tokio::test]
    async fn staging_and_text_save_preserve_shelf_contract() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let tools = FileTools::new(shelf.clone(), temporary.path().join("missing.exe"))
            .await
            .unwrap();
        let uploaded = tools
            .add_input_stream(
                "photo.png",
                futures_util::stream::once(async { Ok::<_, std::io::Error>(Bytes::from(png())) }),
                None,
            )
            .await
            .unwrap();
        let id = uploaded["item"]["id"].as_str().unwrap();
        assert!(uploaded["item"]["thumbnail"]
            .as_str()
            .unwrap()
            .starts_with("/api/files/input/"));
        tools.keep(id).await.unwrap();
        let job_id = token();
        *tools.state.lock().await = json!({"jobId":job_id,"status":"complete","command":"ocr","text":"bonjour","result":{"name":"texte.txt"}});
        let saved = tools.save(&job_id, Some("corrigé".into())).await.unwrap();
        assert!(saved["download"]
            .as_str()
            .unwrap()
            .starts_with("/api/shelf/"));
        assert_eq!(
            shelf.list().await.unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(tools.save(&job_id, Some("a\0b".into())).await.is_err());
    }
}
