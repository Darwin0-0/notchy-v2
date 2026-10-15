use crate::{error::ApiError, native_bridge::Bridge};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::{
    io::BufReader,
    process::Command,
    sync::{broadcast, Mutex},
};
use tokio_util::sync::CancellationToken;

fn empty() -> Value {
    json!({"available":false,"title":"","artist":"","cover":null,"playing":false,"position":0,"duration":0,"canSeek":false,"canToggle":false,"canNext":false,"canPrevious":false,"canShuffle":false,"canRepeat":false,"shuffle":null,"repeat":null,"source":"","sourceId":""})
}
fn clean_text(value: &Value, max: usize) -> String {
    value
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}
pub fn normalize(value: &Value, previous: &Value) -> Value {
    if value["available"] != true || !value["error"].is_null() {
        return empty();
    }
    let title = clean_text(&value["title"], 512);
    let artist = clean_text(&value["artist"], 512);
    let source = clean_text(&value["source"], 80);
    let source_id = clean_text(&value["sourceId"], 256);
    let duration = value["duration"]
        .as_f64()
        .filter(|n| n.is_finite())
        .unwrap_or(0.)
        .clamp(0., 604800.);
    let position = value["position"]
        .as_f64()
        .filter(|n| n.is_finite())
        .unwrap_or(0.)
        .clamp(0., duration);
    let mut result = json!({"available":true,"title":title,"artist":artist,"playing":value["playing"]==true,"position":position,"duration":duration,"source":if source.is_empty(){"Windows Media"}else{&source},"sourceId":source_id});
    for key in [
        "canSeek",
        "canToggle",
        "canNext",
        "canPrevious",
        "canShuffle",
        "canRepeat",
    ] {
        result[key] = json!(value[key] == true && (key != "canSeek" || duration > 0.));
    }
    result["shuffle"] = if value["shuffle"].is_boolean() {
        value["shuffle"].clone()
    } else {
        Value::Null
    };
    result["repeat"] =
        if ["none", "list", "track"].contains(&value["repeat"].as_str().unwrap_or("")) {
            value["repeat"].clone()
        } else {
            Value::Null
        };
    let valid_cover = |v: &Value| {
        v.as_str()
            .filter(|s| {
                s.len() <= 5_400_000
                    && [
                        "data:image/png;base64,",
                        "data:image/jpeg;base64,",
                        "data:image/webp;base64,",
                    ]
                    .iter()
                    .any(|p| s.starts_with(p))
                    && s.split_once(',')
                        .map(|(_, b)| {
                            b.bytes()
                                .all(|x| x.is_ascii_alphanumeric() || b"+/=".contains(&x))
                        })
                        .unwrap_or(false)
            })
            .map(|s| json!(s))
    };
    result["cover"] = if let Some(cover) = value.get("cover") {
        valid_cover(cover).unwrap_or(Value::Null)
    } else if result["title"] == previous["title"]
        && result["artist"] == previous["artist"]
        && result["source"] == previous["source"]
        && result["sourceId"] == previous["sourceId"]
    {
        previous["cover"].clone()
    } else {
        Value::Null
    };
    result
}
struct Cached {
    value: Value,
    at: Instant,
}
pub struct Music {
    bridge: Bridge,
    native: PathBuf,
    cache: Mutex<Cached>,
    commands: Mutex<()>,
    events: broadcast::Sender<(String, Value)>,
    subscribers: AtomicUsize,
    spectrum_subscribers: AtomicUsize,
    epoch: AtomicU64,
    running: Mutex<Option<CancellationToken>>,
    spectrum: Mutex<Option<CancellationToken>>,
    lifecycle: Mutex<()>,
    spectrum_epoch: AtomicU64,
}
pub struct Subscription {
    pub receiver: broadcast::Receiver<(String, Value)>,
    music: Arc<Music>,
    spectrum: bool,
}
impl Drop for Subscription {
    fn drop(&mut self) {
        let music = self.music.clone();
        let spectrum = self.spectrum;
        tauri::async_runtime::spawn(async move {
            music.unsubscribe(spectrum).await;
        });
    }
}
impl Music {
    pub fn new(native: PathBuf) -> Self {
        let (events, _) = broadcast::channel(32);
        Self {
            bridge: Bridge::new(
                native.join("MediaBridge.exe"),
                vec![],
                6_000_000,
                Duration::from_secs(8),
            ),
            native,
            cache: Mutex::new(Cached {
                value: empty(),
                at: Instant::now(),
            }),
            commands: Mutex::new(()),
            events,
            subscribers: AtomicUsize::new(0),
            spectrum_subscribers: AtomicUsize::new(0),
            epoch: AtomicU64::new(0),
            running: Mutex::new(None),
            spectrum: Mutex::new(None),
            lifecycle: Mutex::new(()),
            spectrum_epoch: AtomicU64::new(0),
        }
    }
    pub async fn snapshot(&self) -> Value {
        let cache = self.cache.lock().await;
        let mut value = cache.value.clone();
        if value["playing"] == true {
            value["position"] = json!((value["position"].as_f64().unwrap_or(0.)
                + cache.at.elapsed().as_secs_f64())
            .min(value["duration"].as_f64().unwrap_or(0.)));
        }
        value
    }
    async fn publish(self: &Arc<Self>, reply: Value) {
        let value = {
            let mut cache = self.cache.lock().await;
            let value = normalize(&reply, &cache.value);
            cache.value = value.clone();
            cache.at = Instant::now();
            value
        };
        let _ = self.events.send(("music".into(), value));
        self.sync_spectrum().await;
    }
    pub async fn subscribe(self: &Arc<Self>, spectrum: bool) -> Subscription {
        let _lifecycle = self.lifecycle.lock().await;
        let receiver = self.events.subscribe();
        if spectrum {
            self.spectrum_subscribers.fetch_add(1, Ordering::SeqCst);
        }
        if self.subscribers.fetch_add(1, Ordering::SeqCst) == 0 {
            let epoch = self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
            let token = CancellationToken::new();
            *self.running.lock().await = Some(token.clone());
            let this = self.clone();
            tauri::async_runtime::spawn(async move {
                let mut changed = this.bridge.subscribe();
                let mut interval = tokio::time::interval(Duration::from_secs(10));
                loop {
                    tokio::select! {_=token.cancelled()=>break,_=interval.tick()=>{},_=changed.recv()=>{}}
                    if token.is_cancelled() {
                        break;
                    }
                    let _guard = this.commands.lock().await;
                    let reply = this
                        .bridge
                        .request(json!({"command":"get"}))
                        .await
                        .unwrap_or_else(|_| empty());
                    if this.epoch.load(Ordering::SeqCst) == epoch && !token.is_cancelled() {
                        this.publish(reply).await;
                    }
                }
            });
        }
        self.sync_spectrum().await;
        Subscription {
            receiver,
            music: self.clone(),
            spectrum,
        }
    }
    async fn unsubscribe(self: &Arc<Self>, spectrum: bool) {
        let _lifecycle = self.lifecycle.lock().await;
        if spectrum {
            self.spectrum_subscribers.fetch_sub(1, Ordering::SeqCst);
        }
        if self.subscribers.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.epoch.fetch_add(1, Ordering::SeqCst);
            if let Some(token) = self.running.lock().await.take() {
                token.cancel();
            }
            self.bridge.stop().await;
            *self.cache.lock().await = Cached {
                value: empty(),
                at: Instant::now(),
            };
        }
        self.sync_spectrum().await;
    }
    async fn sync_spectrum(self: &Arc<Self>) {
        let playing = self.cache.lock().await.value["playing"] == true;
        let mut active = self.spectrum.lock().await;
        let wanted = playing
            && self.spectrum_subscribers.load(Ordering::SeqCst) > 0
            && self.subscribers.load(Ordering::SeqCst) > 0;
        if !wanted {
            self.spectrum_epoch.fetch_add(1, Ordering::SeqCst);
            if let Some(token) = active.take() {
                token.cancel();
            }
            return;
        }
        if active.is_some() {
            return;
        }
        let token = CancellationToken::new();
        let generation = self.spectrum_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        *active = Some(token.clone());
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut command = Command::new(this.native.join("SpectrumBridge.exe"));
            command
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            if let Ok(mut child) = command.spawn() {
                let mut stdout = BufReader::new(child.stdout.take().unwrap());
                loop {
                    let next = crate::native_bridge::read_frame(&mut stdout, 1024);
                    let frame = tokio::select! {_=token.cancelled()=>break,n=next=>n};
                    let Ok(Some(line)) = frame else { break };
                    if let Ok(value) = serde_json::from_slice::<Value>(&line) {
                        if value
                            .as_array()
                            .map(|v| {
                                v.len() == 8
                                    && v.iter().all(|x| {
                                        x.as_f64()
                                            .map(|n| (0.0..=1.0).contains(&n))
                                            .unwrap_or(false)
                                    })
                            })
                            .unwrap_or(false)
                        {
                            let _ = this.events.send(("spectrum".into(), value));
                        }
                    }
                }
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
            let mut active = this.spectrum.lock().await;
            if this.spectrum_epoch.load(Ordering::SeqCst) == generation {
                active.take();
            }
        });
    }
    pub async fn command(self: &Arc<Self>, value: Value) -> Result<Value, ApiError> {
        let object = value
            .as_object()
            .ok_or_else(|| ApiError::new(400, "Commande musicale invalide."))?;
        let name = value["command"].as_str().unwrap_or("");
        if name == "open" && object.len() == 1 {
            let current = self.snapshot().await;
            if current["available"] == true && current["source"] != "Spotify" {
                return Err(ApiError::new(409, "Ce lecteur ne fournit pas de lien d’ouverture."));
            }
            crate::desktop::open_uri("spotify:")?;
            return Ok(json!({"ok":true}));
        }
        let seek = name == "seek";
        if !(seek
            && object.len() == 5
            && object
                .keys()
                .all(|k| ["command", "position", "title", "artist", "sourceId"].contains(&k.as_str()))
            && value["position"]
                .as_f64()
                .map(|n| n.is_finite() && (0.0..=604800.).contains(&n))
                .unwrap_or(false)
            && ["title", "artist"].iter().all(|key| {
                value[key]
                    .as_str()
                    .map(|s| s.chars().count() <= 240 && !s.chars().any(|c| c.is_control()))
                    .unwrap_or(false)
            })
            && value["sourceId"]
                .as_str()
                .map(|s| !s.is_empty() && s.chars().count() <= 256 && !s.chars().any(|c| c.is_control()))
                .unwrap_or(false)
            || object.len() == 1
                && ["toggle", "next", "previous", "shuffle", "repeat"].contains(&name))
        {
            return Err(ApiError::new(400, "Commande musicale invalide."));
        }
        if self.subscribers.load(Ordering::SeqCst) == 0 {
            return Err(ApiError::new(409, "Panneau musical inactif."));
        }
        let _guard = self
            .commands
            .try_lock()
            .map_err(|_| ApiError::new(409, "Une commande musicale est déjà en cours."))?;
        let epoch = self.epoch.load(Ordering::SeqCst);
        if seek {
            let fresh = self.bridge.request(json!({"command":"get"})).await?;
            self.publish(fresh).await;
            let current = self.snapshot().await;
            if current["canSeek"] != true {
                return Err(ApiError::new(
                    409,
                    "Le lecteur Windows ne permet pas de déplacer la lecture.",
                ));
            }
            if ["title", "artist"]
                .iter()
                .any(|key| clean_text(&current[key], 240) != value[key].as_str().unwrap_or(""))
                || current["sourceId"] != value["sourceId"]
            {
                return Err(ApiError::new(409, "Le morceau a changé. Réessaie."));
            }
            if value["position"].as_f64().unwrap() > current["duration"].as_f64().unwrap_or(0.) {
                return Err(ApiError::new(
                    409,
                    "Cette position dépasse la durée du morceau.",
                ));
            }
        }
        if self.epoch.load(Ordering::SeqCst) != epoch {
            return Err(ApiError::new(409, "Panneau musical inactif."));
        }
        let payload = if seek {
            json!({"command":"seek","position":value["position"],"sourceId":value["sourceId"]})
        } else {
            json!({"command":name})
        };
        let reply = self.bridge.request(payload).await?;
        if self.epoch.load(Ordering::SeqCst) != epoch {
            return Err(ApiError::new(409, "Panneau musical inactif."));
        }
        let ok = reply["available"] == true && reply["ok"] != false && reply["error"].is_null();
        self.publish(reply).await;
        if !ok {
            return Err(ApiError::new(409, "Commande indisponible dans ce lecteur."));
        }
        let mut result = self.snapshot().await;
        result["ok"] = json!(true);
        Ok(result)
    }
    pub async fn dispose(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        if let Some(token) = self.running.lock().await.take() {
            token.cancel();
        }
        if let Some(token) = self.spectrum.lock().await.take() {
            token.cancel();
        }
        self.bridge.dispose().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn music_projection_preserves_artwork_only_for_the_same_track() {
        let a = json!({"available":true,"title":"A","artist":"B","duration":120,"canSeek":true,"cover":"data:image/png;base64,YQ=="});
        let first = normalize(&a, &empty());
        assert_eq!(first["canSeek"], true);
        let next = json!({"available":true,"title":"A","artist":"B","duration":120});
        assert_eq!(normalize(&next, &first)["cover"], first["cover"]);
        assert_eq!(
            normalize(&json!({"available":true,"title":"C","artist":"B"}), &first)["cover"],
            Value::Null
        );
        assert_eq!(
            normalize(
                &json!({"available":true,"canSeek":"true","duration":0}),
                &empty()
            )["canSeek"],
            false
        );
    }

    #[test]
    fn native_music_keeps_the_real_source_and_never_shares_artwork_between_players() {
        let cover = "data:image/png;base64,YQ==";
        let spotify = normalize(&json!({"available":true,"title":"Song","artist":"Artist","source":"Spotify","sourceId":"Spotify.exe","cover":cover}), &empty());
        let browser = json!({"available":true,"title":"Song","artist":"Artist","source":"Microsoft Edge","sourceId":"msedge.exe","duration":120,"canToggle":true,"canNext":false,"canSeek":true});
        let edge = normalize(&browser, &spotify);
        assert_eq!(edge["source"], "Microsoft Edge");
        assert_eq!(edge["sourceId"], "msedge.exe");
        assert_eq!(edge["cover"], Value::Null);
        assert_eq!(edge["canToggle"], true);
        assert_eq!(edge["canNext"], false);
        assert_eq!(edge["canSeek"], true);

        let mut with_cover = browser.clone();
        with_cover["cover"] = json!(cover);
        let same_player = normalize(&with_cover, &empty());
        assert_eq!(normalize(&browser, &same_player)["cover"], cover);
        let mut other_session = browser.clone();
        other_session["sourceId"] = json!("another-edge-session");
        assert_eq!(normalize(&other_session, &same_player)["cover"], Value::Null);
    }

    #[test]
    fn native_music_does_not_invent_spotify_and_bounds_source_metadata() {
        assert_eq!(empty()["source"], "");
        assert_eq!(empty()["sourceId"], "");
        assert_eq!(normalize(&json!({"available":true}), &empty())["source"], "Windows Media");
        let value = normalize(&json!({"available":true,"source":"VLC\n\u{0000}","sourceId":"x".repeat(300)}), &empty());
        assert_eq!(value["source"], "VLC");
        assert_eq!(value["sourceId"].as_str().unwrap().len(), 256);
        assert_eq!(normalize(&json!({"available":true,"source":"VLC","error":"offline"}), &value), empty());
    }

    #[tokio::test]
    async fn seeking_requires_the_original_bounded_player_identity() {
        let music = Arc::new(Music::new(PathBuf::new()));
        let valid = json!({"command":"seek","position":42,"title":"Song","artist":"Artist","sourceId":"Spotify.exe"});
        // A valid command reaches the inactive-player guard without starting a native bridge.
        assert_eq!(music.command(valid.clone()).await.unwrap_err().status, 409);
        for source in [Value::Null, json!(""), json!("x".repeat(257)), json!("Spotify\n.exe"), json!(true)] {
            let mut invalid = valid.clone();
            invalid["sourceId"] = source;
            assert_eq!(music.command(invalid).await.unwrap_err().status, 400);
        }
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove("sourceId");
        assert_eq!(music.command(missing).await.unwrap_err().status, 400);
        let mut extra = valid;
        extra["extra"] = json!(true);
        assert_eq!(music.command(extra).await.unwrap_err().status, 400);
        for name in ["get", "toggle", "next", "previous", "shuffle", "repeat"] {
            assert_eq!(music.command(json!({"command":name,"sourceId":"Spotify.exe"})).await.unwrap_err().status, 400);
        }
    }
}
