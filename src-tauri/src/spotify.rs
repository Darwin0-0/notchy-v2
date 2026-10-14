use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Weak,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Request, State},
    response::{IntoResponse, Response},
    Router,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use futures_util::future::join_all;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{fs, io::AsyncWriteExt, sync::Mutex};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::error::ApiError;

const REDIRECT: &str = "http://127.0.0.1:43821/callback";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const QUEUE_URL: &str = "https://api.spotify.com/v1/me/player/queue";
const PLAY_URL: &str = "https://api.spotify.com/v1/me/player/play";
const SCOPES: [&str; 3] = [
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-modify-playback-state",
];
const STORE_HEADER: &[u8] = b"NOTCHY-SPOTIFY-DPAPI1\0";
const TOKEN_LIMIT: usize = 16384;
const API_LIMIT: usize = 1024 * 1024;
const ART_LIMIT: usize = 262144;
const ART_BUDGET: usize = 524288;

type Result<T> = std::result::Result<T, ApiError>;
fn configured_client_id(path: &Path, override_id: Option<&str>) -> std::result::Result<String, &'static str> {
    let id = if let Some(id) = override_id {
        id.to_owned()
    } else {
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err("configuration-required"),
            Err(_) => return Err("configuration-invalid"),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 2048 {
            return Err("configuration-invalid");
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("configuration-invalid");
            }
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields, rename_all = "camelCase")]
        struct Configuration { client_id: String }
        let bytes = std::fs::read(path).map_err(|_| "configuration-invalid")?;
        let configuration: Configuration = serde_json::from_slice(&bytes).map_err(|_| "configuration-invalid")?;
        configuration.client_id
    };
    if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("configuration-invalid");
    }
    Ok(id)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn clean(value: Option<&str>, max: usize) -> String {
    value
        .unwrap_or_default()
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(*c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .take(max)
        .collect()
}
fn random_secret(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

pub fn valid_track_uri(value: &str) -> bool {
    value
        .strip_prefix("spotify:track:")
        .is_some_and(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}
pub fn valid_command(value: &Value) -> bool {
    if let Some(command) = value.as_str() {
        return matches!(command, "status" | "queue" | "connect" | "disconnect");
    }
    value.as_object().is_some_and(|object| {
        object.len() == 2
            && value["command"] == "play-track"
            && value["uri"].as_str().is_some_and(valid_track_uri)
    })
}

fn status_message(status: &str) -> &'static str {
    match status {
    "configuration-required" => "Configure ton identifiant d’application Spotify avec NOTCHY_SPOTIFY_CLIENT_ID ou .desktop-profile/spotify-client.json, puis relance Notchy.",
    "configuration-invalid" => "La configuration Spotify est invalide. Indique uniquement un clientId de 32 caractères hexadécimaux, puis relance Notchy.",
    "disconnected" => "Connecte Spotify pour consulter À suivre.", "connecting" => "Autorise Notchy dans ton navigateur.",
    "connected" => "Spotify connecté.", "ok" => "", "accepted" => "Lecture demandée à Spotify sur l’appareil actif.",
    "scope-required" => "Reconnecte Spotify pour autoriser la lecture des titres.", "busy" => "Une commande Spotify est déjà en cours.",
    "limited" => "Spotify demande une pause avant la prochaine lecture.", "unauthorized" => "Reconnecte Spotify pour restaurer la session.",
    "forbidden" => "Spotify refuse cet accès. Vérifie Premium, les autorisations et l’éligibilité de ton compte.",
    "offline" => "Spotify est momentanément indisponible. Réessaie.", "unavailable" => "La file Spotify est indisponible pour le moment.",
    "cancelled" => "Lecture annulée.", "invalid" => "Commande Spotify invalide.", _ => "La connexion Spotify a échoué. Réessaie.",
}
}
fn projection(status: &str, can_play: bool) -> Value {
    json!({"status":status,"current":null,"items":[],"message":status_message(status),"canPlay":can_play && matches!(status,"ok"|"connected"|"accepted")})
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    expires: u64,
    scopes: Vec<String>,
}
impl Tokens {
    fn valid(&self) -> bool {
        secret_valid(&self.access_token)
            && secret_valid(&self.refresh_token)
            && self.expires > 0
            && self.scopes.len() <= 3
            && self
                .scopes
                .iter()
                .all(|scope| SCOPES.contains(&scope.as_str()))
            && self.scopes.iter().collect::<HashSet<_>>().len() == self.scopes.len()
    }
    fn can_play(&self) -> bool {
        self.scopes.iter().any(|scope| scope == SCOPES[2])
    }
}
fn secret_valid(value: &str) -> bool {
    !value.is_empty() && value.len() <= 8192 && value.bytes().all(|b| b.is_ascii_graphic())
}

fn refreshed_tokens(
    value: &Value,
    previous: Option<&Tokens>,
    authorization: bool,
) -> Result<Tokens> {
    let access = value["access_token"]
        .as_str()
        .filter(|s| secret_valid(s))
        .ok_or_else(|| ApiError::new(503, "Réponse Spotify invalide."))?;
    let refresh = value["refresh_token"]
        .as_str()
        .or_else(|| previous.map(|tokens| tokens.refresh_token.as_str()))
        .filter(|s| secret_valid(s))
        .ok_or_else(|| ApiError::new(503, "Réponse Spotify invalide."))?;
    let expires = value["expires_in"]
        .as_u64()
        .filter(|seconds| *seconds > 0 && *seconds <= 86400)
        .ok_or_else(|| ApiError::new(503, "Durée Spotify invalide."))?;
    let granted: Vec<String> = if authorization {
        SCOPES.iter().map(|scope| (*scope).into()).collect()
    } else {
        previous
            .map(|tokens| tokens.scopes.clone())
            .unwrap_or_default()
    };
    // Refresh can retain an existing grant; only a new OAuth consent may add playback control.
    let scopes = if let Some(scope) = value["scope"].as_str() {
        let reported = scope.split_whitespace().collect::<HashSet<_>>();
        granted
            .into_iter()
            .filter(|scope| reported.contains(scope.as_str()))
            .collect()
    } else {
        granted
    };
    Ok(Tokens {
        access_token: access.into(),
        refresh_token: refresh.into(),
        expires: now() + expires * 1000,
        scopes,
    })
}

fn normalize_track(item: &Value) -> Option<Value> {
    if !item.is_object() {
        return None;
    }
    let id = clean(item["id"].as_str(), 200);
    let kind = if item["type"] == "episode" {
        "episode"
    } else {
        "track"
    };
    let uri = item["uri"].as_str().filter(|uri| {
        kind == "track" && valid_track_uri(uri) && *uri == format!("spotify:track:{id}")
    });
    let name = clean(item["name"].as_str(), 160);
    let artists = if let Some(artists) = item["artists"].as_array() {
        artists
            .iter()
            .take(8)
            .map(|artist| clean(artist["name"].as_str(), 100))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
    } else {
        let publisher = clean(item["show"]["publisher"].as_str(), 100);
        if publisher.is_empty() {
            Vec::new()
        } else {
            vec![publisher]
        }
    };
    let album = clean(
        item["album"]["name"]
            .as_str()
            .or(item["show"]["name"].as_str()),
        160,
    );
    let duration = item["duration_ms"]
        .as_u64()
        .map(|value| value.min(86400000));
    Some(
        json!({"id":if id.is_empty(){Value::Null}else{id.into()},"type":kind,"uri":uri,"name":if name.is_empty(){"Titre indisponible"}else{name.as_str()},"artists":artists,"album":album,"duration":duration,"artwork":null}),
    )
}

fn artwork_url(item: &Value) -> Option<Url> {
    let mut images = item["album"]["images"]
        .as_array()
        .or(item["images"].as_array())?
        .iter()
        .collect::<Vec<_>>();
    images.sort_by_key(|image| image["width"].as_u64().unwrap_or(1000));
    images
        .into_iter()
        .filter_map(|image| image["url"].as_str().and_then(|s| Url::parse(s).ok()))
        .find(|url| {
            url.scheme() == "https"
                && url.host_str() == Some("i.scdn.co")
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
        })
}

struct AuthFlow {
    nonce: String,
    verifier: String,
    generation: u64,
    consumed: AtomicBool,
    stop: CancellationToken,
}
#[derive(Clone)]
struct CallbackState {
    spotify: Weak<Spotify>,
    flow: Arc<AuthFlow>,
}

struct StateData {
    loaded: bool,
    tokens: Option<Tokens>,
    cache: Value,
    cached_at: Option<u64>,
    retry_at: u64,
    generation: u64,
    cancelled: CancellationToken,
    auth: Option<Arc<AuthFlow>>,
}

pub struct Spotify {
    directory: PathBuf,
    client_id: std::result::Result<String, &'static str>,
    client: Option<reqwest::Client>,
    state: Mutex<StateData>,
    operation: Mutex<()>,
    playing: AtomicBool,
    disposed: AtomicBool,
    artwork: Mutex<HashMap<String, (String, usize)>>,
    #[cfg(test)]
    test_routes: Option<[String; 3]>,
    #[cfg(test)]
    memory_store: bool,
}

impl Spotify {
    pub fn new(directory: PathBuf) -> Self {
        let configuration = directory.parent().unwrap_or(&directory).join("spotify-client.json");
        let client_id = match std::env::var("NOTCHY_SPOTIFY_CLIENT_ID") {
            Ok(id) => configured_client_id(&configuration, Some(&id)),
            Err(std::env::VarError::NotPresent) => configured_client_id(&configuration, None),
            Err(_) => Err("configuration-invalid"),
        };
        Self {
            directory,
            client_id,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(12))
                .build()
                .ok(),
            state: Mutex::new(StateData {
                loaded: false,
                tokens: None,
                cache: projection("disconnected", false),
                cached_at: None,
                retry_at: 0,
                generation: 0,
                cancelled: CancellationToken::new(),
                auth: None,
            }),
            operation: Mutex::new(()),
            playing: AtomicBool::new(false),
            disposed: AtomicBool::new(false),
            artwork: Mutex::new(HashMap::new()),
            #[cfg(test)]
            test_routes: None,
            #[cfg(test)]
            memory_store: false,
        }
    }

    fn store(&self) -> PathBuf {
        self.directory.join("spotify-rust-session.dpapi")
    }
    fn endpoint(&self, original: &str) -> String {
        #[cfg(test)]
        if let Some(routes) = &self.test_routes {
            if original == TOKEN_URL {
                return routes[0].clone();
            }
            if original == QUEUE_URL {
                return routes[1].clone();
            }
            if original == PLAY_URL {
                return routes[2].clone();
            }
        }
        original.into()
    }

    async fn load(&self) {
        let mut state = self.state.lock().await;
        if state.loaded {
            return;
        }
        state.loaded = true;
        #[cfg(test)]
        if self.memory_store {
            return;
        }
        let loaded = async {
            let metadata = fs::symlink_metadata(self.store()).await?;
            if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 65536 {
                return Err(ApiError::new(503, "Session Spotify invalide."));
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err(ApiError::new(503, "Session Spotify invalide."));
                }
            }
            let bytes = fs::read(self.store()).await?;
            if !bytes.starts_with(STORE_HEADER) {
                return Err(ApiError::new(503, "Session Spotify invalide."));
            }
            let plaintext = protect(&bytes[STORE_HEADER.len()..], false)?;
            let tokens: Tokens = serde_json::from_slice(&plaintext)
                .map_err(|_| ApiError::new(503, "Session Spotify invalide."))?;
            if !tokens.valid() {
                return Err(ApiError::new(503, "Session Spotify invalide."));
            }
            Ok(tokens)
        }
        .await;
        if let Ok(tokens) = loaded {
            let playable = tokens.can_play();
            state.tokens = Some(tokens);
            state.cache = projection("connected", playable);
        }
        // Electron's safeStorage blob is deliberately left untouched; the Rust profile reconnects once.
    }

    async fn persist(&self, tokens: &Tokens) -> Result<()> {
        #[cfg(test)]
        if self.memory_store {
            return Ok(());
        }
        fs::create_dir_all(&self.directory).await?;
        let metadata = fs::symlink_metadata(&self.directory).await?;
        let actual = fs::canonicalize(&self.directory).await?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || actual
                .to_string_lossy()
                .trim_start_matches("\\\\?\\")
                .to_ascii_lowercase()
                != self
                    .directory
                    .to_string_lossy()
                    .trim_start_matches("\\\\?\\")
                    .to_ascii_lowercase()
        {
            return Err(ApiError::new(503, "Stockage Spotify indisponible."));
        }
        let bytes = serde_json::to_vec(tokens)
            .map_err(|_| ApiError::new(503, "Session Spotify invalide."))?;
        let encrypted = protect(&bytes, true)?;
        let mut data = STORE_HEADER.to_vec();
        data.extend_from_slice(&encrypted);
        let temporary = self
            .directory
            .join(format!(".spotify-{}.tmp", uuid::Uuid::new_v4().simple()));
        let outcome = async {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .await?;
            file.write_all(&data).await?;
            file.sync_all().await?;
            drop(file);
            fs::rename(&temporary, self.store()).await?;
            Ok::<_, ApiError>(())
        }
        .await;
        let _ = fs::remove_file(&temporary).await;
        outcome
    }

    async fn current(&self) -> Value {
        if let Err(status) = self.client_id {
            return projection(status, false);
        }
        let state = self.state.lock().await;
        self.cached_projection(&state)
    }

    pub async fn command(self: &Arc<Self>, value: Value) -> Result<Value> {
        if !valid_command(&value) {
            return Ok(projection("invalid", false));
        }
        if self.disposed.load(Ordering::Acquire) {
            return Ok(projection("unavailable", false));
        }
        self.load().await;
        if value != "disconnect" {
            if let Err(status) = self.client_id {
                return Ok(projection(status, false));
            }
        }
        match value.as_str() {
            Some("status") => Ok(self.current().await),
            Some("disconnect") => {
                self.disconnect().await;
                Ok(self.current().await)
            }
            Some("connect") => self.connect().await,
            Some("queue") => {
                let _operation = self.operation.lock().await;
                Ok(self.queue().await)
            }
            _ => self.play(value["uri"].as_str().unwrap()).await,
        }
    }

    async fn queue(&self) -> Value {
        let (generation, cancelled) = {
            let state = self.state.lock().await;
            if state.auth.is_some() {
                return projection("connecting", false);
            }
            if state.tokens.is_none() {
                return projection("disconnected", false);
            }
            if state
                .cached_at
                .is_some_and(|at| now().saturating_sub(at) < 10000)
                || now() < state.retry_at
            {
                return self.cached_projection(&state);
            }
            (state.generation, state.cancelled.clone())
        };
        let fetched = self.api(false, None, generation, &cancelled).await;
        let result = match fetched {
            Ok(data) => self.queue_projection(data, generation, &cancelled).await,
            Err(value) => value,
        };
        let mut state = self.state.lock().await;
        if state.generation != generation
            || cancelled.is_cancelled()
            || self.disposed.load(Ordering::Acquire)
        {
            return projection("cancelled", false);
        }
        state.cached_at = Some(now());
        state.cache = result.clone();
        if result["status"] == "limited" {
            state.retry_at = now() + result["retryAfter"].as_u64().unwrap_or(30) * 1000;
        } else {
            state.retry_at = 0;
        }
        result
    }

    fn cached_projection(&self, state: &StateData) -> Value {
        let mut result = if now() < state.retry_at {
            projection("limited", false)
        } else {
            state.cache.clone()
        };
        if result["status"] == "limited" {
            result["retryAfter"] = state
                .retry_at
                .saturating_sub(now())
                .div_ceil(1000)
                .max(1)
                .into();
        }
        result
    }

    async fn play(&self, uri: &str) -> Result<Value> {
        if self.playing.swap(true, Ordering::AcqRel) {
            return Ok(projection("busy", false));
        }
        let _busy = Playing(&self.playing);
        let _operation = self.operation.lock().await;
        {
            let state = self.state.lock().await;
            if state.auth.is_some() {
                return Ok(projection("connecting", false));
            }
            let Some(tokens) = state.tokens.as_ref() else {
                return Ok(projection("disconnected", false));
            };
            if !tokens.can_play() {
                return Ok(projection("scope-required", false));
            }
            if now() < state.retry_at {
                return Ok(self.cached_projection(&state));
            }
        }
        let stale = {
            let state = self.state.lock().await;
            state
                .cached_at
                .is_none_or(|at| now().saturating_sub(at) > 30000)
        };
        if stale {
            let result = self.queue().await;
            if result["status"] != "ok" {
                return Ok(result);
            }
        }
        let (generation, cancelled) = {
            let state = self.state.lock().await;
            if state.cache["status"] != "ok" {
                return Ok(state.cache.clone());
            }
            if state
                .cached_at
                .is_none_or(|at| now().saturating_sub(at) > 30000)
            {
                return Ok(projection("unavailable", false));
            }
            if !state.cache["items"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item["uri"] == uri))
            {
                return Ok(projection("invalid", false));
            }
            (state.generation, state.cancelled.clone())
        };
        let result = match self.api(true, Some(uri), generation, &cancelled).await {
            Ok(_) => {
                let mut value = projection("accepted", true);
                value["accepted"] = true.into();
                value
            }
            Err(value) => value,
        };
        let mut state = self.state.lock().await;
        if state.generation != generation || cancelled.is_cancelled() {
            return Ok(projection("cancelled", false));
        }
        if result["status"] == "accepted" {
            state.cached_at = None;
            state.cache = projection("connected", true);
        }
        if result["status"] == "limited" {
            state.retry_at = now() + result["retryAfter"].as_u64().unwrap_or(30) * 1000;
        }
        Ok(result)
    }

    async fn api(
        &self,
        play: bool,
        uri: Option<&str>,
        generation: u64,
        cancelled: &CancellationToken,
    ) -> std::result::Result<Value, Value> {
        if self
            .state
            .lock()
            .await
            .tokens
            .as_ref()
            .is_some_and(|token| token.expires < now() + 60000)
        {
            if let Err(value) = self.refresh(generation, cancelled).await {
                return Err(value);
            }
        }
        for attempt in 0..2 {
            let access = {
                let state = self.state.lock().await;
                if state.generation != generation || cancelled.is_cancelled() {
                    return Err(projection("cancelled", false));
                }
                let Some(tokens) = state.tokens.as_ref() else {
                    return Err(projection("disconnected", false));
                };
                if play && !tokens.can_play() {
                    return Err(projection("scope-required", false));
                }
                tokens.access_token.clone()
            };
            let Some(client) = self.client.as_ref() else {
                return Err(projection("unavailable", false));
            };
            let request = if play {
                let Some(uri) = uri.filter(|uri| valid_track_uri(uri)) else {
                    return Err(projection("invalid", false));
                };
                client
                    .put(self.endpoint(PLAY_URL))
                    .bearer_auth(&access)
                    .json(&json!({"uris":[uri],"position_ms":0}))
            } else {
                client.get(self.endpoint(QUEUE_URL)).bearer_auth(&access)
            };
            let response = tokio::select! {_=cancelled.cancelled()=>return Err(projection("cancelled",false)),response=request.send()=>response.map_err(|_|projection("offline",false))?};
            if response.status().as_u16() == 401 && attempt == 0 {
                self.refresh(generation, cancelled).await?;
                continue;
            }
            if !response.status().is_success() {
                return Err(api_failure(&response));
            }
            if response.status().as_u16() == 204 {
                return Ok(Value::Null);
            }
            return tokio::select! {_=cancelled.cancelled()=>Err(projection("cancelled",false)),value=bounded_json(response,API_LIMIT)=>value.map_err(|_|projection("offline",false))};
        }
        Err(projection("unauthorized", false))
    }

    async fn refresh(
        &self,
        generation: u64,
        cancelled: &CancellationToken,
    ) -> std::result::Result<(), Value> {
        let client_id = self.client_id.as_deref().map_err(|status| projection(status, false))?;
        let previous = {
            let state = self.state.lock().await;
            if state.generation != generation {
                return Err(projection("cancelled", false));
            }
            state
                .tokens
                .clone()
                .ok_or_else(|| projection("disconnected", false))?
        };
        let fields = [
            ("grant_type", "refresh_token"),
            ("refresh_token", previous.refresh_token.as_str()),
            ("client_id", client_id),
        ];
        let value = self
            .token_request(&fields, cancelled)
            .await
            .map_err(|error| {
                projection(
                    if error.status == 400 || error.status == 401 {
                        "unauthorized"
                    } else {
                        "offline"
                    },
                    false,
                )
            })?;
        let tokens = refreshed_tokens(&value, Some(&previous), false)
            .map_err(|_| projection("offline", false))?;
        let mut state = self.state.lock().await;
        if state.generation != generation || cancelled.is_cancelled() {
            return Err(projection("cancelled", false));
        }
        self.persist(&tokens)
            .await
            .map_err(|_| projection("error", false))?;
        state.tokens = Some(tokens);
        Ok(())
    }

    async fn token_request(
        &self,
        fields: &[(&str, &str)],
        cancelled: &CancellationToken,
    ) -> Result<Value> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| ApiError::new(503, "Spotify indisponible."))?;
        let response = tokio::select! {_=cancelled.cancelled()=>return Err(ApiError::new(499,"Connexion annulée.")),response=client.post(self.endpoint(TOKEN_URL)).form(fields).send()=>response.map_err(|_|ApiError::new(503,"Spotify indisponible."))?};
        if !response.status().is_success() {
            return Err(ApiError::new(
                response.status().as_u16(),
                "Spotify refuse la connexion.",
            ));
        }
        tokio::select! {_=cancelled.cancelled()=>Err(ApiError::new(499,"Connexion annulée.")),value=bounded_json(response,TOKEN_LIMIT)=>value}
    }

    async fn queue_projection(
        &self,
        data: Value,
        generation: u64,
        cancelled: &CancellationToken,
    ) -> Value {
        let mut current = normalize_track(&data["currently_playing"]).unwrap_or(Value::Null);
        let mut pairs = data["queue"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .take(50)
                    .filter_map(|item| {
                        normalize_track(item).map(|normalized| (normalized, item.clone()))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut targets = Vec::new();
        if current.is_object() {
            if let Some(url) = artwork_url(&data["currently_playing"]) {
                targets.push((None, url));
            }
        }
        for (index, (_, original)) in pairs.iter().take(12).enumerate() {
            if let Some(url) = artwork_url(original) {
                targets.push((Some(index), url));
            }
        }
        let deadline = tokio::time::Instant::now() + Duration::from_millis(1500);
        let mut budget = ART_BUDGET;
        for group in targets.chunks(3) {
            if tokio::time::Instant::now() >= deadline || cancelled.is_cancelled() {
                break;
            }
            let images = join_all(group.iter().map(|(index, url)| async move {
                (*index, self.read_artwork(url, cancelled, deadline).await)
            }))
            .await;
            for (index, image) in images {
                if let Some((image, bytes)) = image {
                    if bytes > budget {
                        continue;
                    }
                    budget -= bytes;
                    match index {
                        None => current["artwork"] = image.into(),
                        Some(index) => pairs[index].0["artwork"] = image.into(),
                    }
                }
            }
        }
        let state = self.state.lock().await;
        if state.generation != generation || cancelled.is_cancelled() {
            return projection("cancelled", false);
        }
        let can_play = state.tokens.as_ref().is_some_and(Tokens::can_play);
        let mut result = projection("ok", can_play);
        result["current"] = current;
        result["items"] = pairs
            .into_iter()
            .map(|(item, _)| item)
            .collect::<Vec<_>>()
            .into();
        result
    }

    async fn read_artwork(
        &self,
        url: &Url,
        cancelled: &CancellationToken,
        deadline: tokio::time::Instant,
    ) -> Option<(String, usize)> {
        if let Some(image) = self.artwork.lock().await.get(url.as_str()).cloned() {
            return Some(image);
        }
        let client = self.client.as_ref()?;
        // Public artwork requests never carry an account token or follow a redirect.
        let image = tokio::select! {_=cancelled.cancelled()=>return None,result=tokio::time::timeout_at(deadline,async{let response=client.get(url.clone()).send().await.ok()?;if !response.status().is_success(){return None;}let mime=response.headers().get("content-type")?.to_str().ok()?.split(';').next()?.to_ascii_lowercase();if !matches!(mime.as_str(),"image/jpeg"|"image/png"|"image/webp"){return None;}let bytes=bounded_bytes(response,ART_LIMIT).await.ok()?;if bytes.is_empty(){return None;}Some((format!("data:{mime};base64,{}",STANDARD.encode(&bytes)),bytes.len()))})=>result.ok().flatten()}?;
        let mut cache = self.artwork.lock().await;
        while cache.values().map(|(_, size)| *size).sum::<usize>() + image.1 > ART_BUDGET {
            let key = cache.keys().next().cloned()?;
            cache.remove(&key);
        }
        cache.insert(url.to_string(), image.clone());
        Some(image)
    }

    async fn connect(self: &Arc<Self>) -> Result<Value> {
        let client_id = match self.client_id.as_deref() {
            Ok(id) => id,
            Err(status) => return Ok(projection(status, false)),
        };
        {
            let state = self.state.lock().await;
            if state.auth.is_some() {
                return Ok(projection("connecting", false));
            }
        }
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", 43821)).await {
            Ok(listener) => listener,
            Err(_) => {
                let mut state = self.state.lock().await;
                if state.auth.is_some() {
                    return Ok(projection("connecting", false));
                }
                state.cache = projection("error", false);
                drop(state);
                return Ok(self.current().await);
            }
        };
        let flow = {
            let mut state = self.state.lock().await;
            state.cancelled.cancel();
            if let Some(auth) = state.auth.take() {
                auth.stop.cancel();
            }
            state.generation += 1;
            state.cancelled = CancellationToken::new();
            state.cached_at = None;
            state.retry_at = 0;
            let flow = Arc::new(AuthFlow {
                nonce: random_secret(32),
                verifier: random_secret(48),
                generation: state.generation,
                consumed: AtomicBool::new(false),
                stop: CancellationToken::new(),
            });
            state.auth = Some(flow.clone());
            state.cache = projection("connecting", false);
            flow
        };
        let mut url = Url::parse("https://accounts.spotify.com/authorize").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("client_id", client_id),
            ("response_type", "code"),
            ("redirect_uri", REDIRECT),
            ("scope", SCOPES.join(" ").as_str()),
            ("state", flow.nonce.as_str()),
            ("code_challenge_method", "S256"),
            (
                "code_challenge",
                URL_SAFE_NO_PAD
                    .encode(Sha256::digest(flow.verifier.as_bytes()))
                    .as_str(),
            ),
        ]);
        let app = Router::new().fallback(callback).with_state(CallbackState {
            spotify: Arc::downgrade(self),
            flow: flow.clone(),
        });
        let weak = Arc::downgrade(self);
        let auth = flow.clone();
        tokio::spawn(async move {
            let shutdown = auth.stop.clone();
            let server =
                axum::serve(listener, app).with_graceful_shutdown(shutdown.cancelled_owned());
            tokio::select! {_=auth.stop.cancelled()=>{},_=tokio::time::sleep(Duration::from_secs(120))=>{auth.stop.cancel();if let Some(service)=weak.upgrade(){let mut state=service.state.lock().await;if state.generation==auth.generation&&state.auth.as_ref().is_some_and(|active|Arc::ptr_eq(active,&auth)){state.auth=None;state.cache=projection("error",false);}}},_=server=>{}}
        });
        if open_browser(url.as_str()).is_err() {
            flow.stop.cancel();
            let mut state = self.state.lock().await;
            if state.generation == flow.generation {
                state.auth = None;
                state.cache = projection("error", false);
            }
        }
        Ok(self.current().await)
    }

    async fn disconnect(&self) {
        let mut state = self.state.lock().await;
        state.generation += 1;
        state.cancelled.cancel();
        state.cancelled = CancellationToken::new();
        if let Some(auth) = state.auth.take() {
            auth.stop.cancel();
        }
        state.tokens = None;
        state.cache = projection("disconnected", false);
        state.cached_at = None;
        state.retry_at = 0;
        #[cfg(test)]
        if self.memory_store {
            return;
        }
        let _ = fs::remove_file(self.store()).await;
        self.artwork.lock().await.clear();
    }

    pub async fn dispose(&self) {
        self.disposed.store(true, Ordering::Release);
        let mut state = self.state.lock().await;
        state.generation += 1;
        state.cancelled.cancel();
        if let Some(auth) = state.auth.take() {
            auth.stop.cancel();
        }
        state.cache = projection("unavailable", false);
        state.cached_at = None;
        self.artwork.lock().await.clear();
    }
}

struct Playing<'a>(&'a AtomicBool);
impl Drop for Playing<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn api_failure(response: &reqwest::Response) -> Value {
    let status = match response.status().as_u16() {
        401 => "unauthorized",
        403 => "forbidden",
        429 => "limited",
        _ => "unavailable",
    };
    let mut value = projection(status, false);
    if status == "limited" {
        value["retryAfter"] = response
            .headers()
            .get("retry-after")
            .and_then(|header| header.to_str().ok())
            .and_then(|text| text.parse::<u64>().ok())
            .unwrap_or(30)
            .clamp(1, 300)
            .into();
    }
    value
}
async fn bounded_bytes(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(ApiError::new(503, "Réponse Spotify trop volumineuse."));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ApiError::new(503, "Réponse Spotify interrompue."))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(ApiError::new(503, "Réponse Spotify trop volumineuse."));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn bounded_json(response: reqwest::Response, limit: usize) -> Result<Value> {
    serde_json::from_slice(&bounded_bytes(response, limit).await?)
        .map_err(|_| ApiError::new(503, "Réponse Spotify invalide."))
}

async fn callback(State(context): State<CallbackState>, request: Request) -> Response {
    if request.method() != "GET"
        || request.uri().path() != "/callback"
        || request.uri().to_string().len() > 8192
    {
        return callback_reply(404, "Notchy : adresse inconnue.");
    }
    let query = Url::parse(&format!("http://127.0.0.1{}", request.uri()))
        .ok()
        .map(|url| url.query_pairs().into_owned().collect::<HashMap<_, _>>())
        .unwrap_or_default();
    let Some(service) = context.spotify.upgrade() else {
        return callback_reply(400, "Connexion expirée.");
    };
    let (generation, cancelled) = {
        let state = service.state.lock().await;
        (state.generation, state.cancelled.clone())
    };
    if query.get("state") != Some(&context.flow.nonce)
        || generation != context.flow.generation
        || context.flow.consumed.swap(true, Ordering::AcqRel)
    {
        return callback_reply(
            400,
            "Connexion invalide. Relance la connexion depuis Notchy.",
        );
    }
    let code = query.get("code").filter(|value| {
        !value.is_empty() && value.len() <= 4096 && value.chars().all(|c| !c.is_control())
    });
    if query.contains_key("error") || code.is_none() {
        let mut state = service.state.lock().await;
        if state.generation == generation {
            state.auth = None;
            state.cache = projection(
                if state.tokens.is_some() {
                    "connected"
                } else {
                    "disconnected"
                },
                state.tokens.as_ref().is_some_and(Tokens::can_play),
            );
        }
        context.flow.stop.cancel();
        return callback_reply(200, "Connexion annulée. Tu peux revenir dans Notchy.");
    }
    let _operation = service.operation.lock().await;
    let authorized = async {
        let client_id = service.client_id.as_deref().map_err(|status| ApiError::new(503, status_message(status)))?;
        let fields = [
            ("grant_type", "authorization_code"),
            ("code", code.unwrap().as_str()),
            ("redirect_uri", REDIRECT),
            ("code_verifier", context.flow.verifier.as_str()),
            ("client_id", client_id),
        ];
        let value = service.token_request(&fields, &cancelled).await?;
        let tokens = refreshed_tokens(&value, None, true)?;
        let mut state = service.state.lock().await;
        if state.generation != generation || cancelled.is_cancelled() {
            return Err(ApiError::new(499, "Connexion annulée."));
        }
        service.persist(&tokens).await?;
        let can_play = tokens.can_play();
        state.tokens = Some(tokens);
        state.cache = projection("connected", can_play);
        state.cached_at = None;
        state.auth = None;
        Ok::<_, ApiError>(())
    }
    .await;
    context.flow.stop.cancel();
    if authorized.is_ok() {
        callback_reply(
            200,
            "Spotify est connecté à Notchy. Tu peux fermer cet onglet.",
        )
    } else {
        let mut state = service.state.lock().await;
        if state.generation == generation {
            state.auth = None;
            state.cache = projection("error", false);
        }
        callback_reply(400, "La connexion a échoué. Relance-la depuis Notchy.")
    }
}

fn callback_reply(status: u16, text: &'static str) -> Response {
    let mut response = (axum::http::StatusCode::from_u16(status).unwrap(), text).into_response();
    for (key, value) in [
        ("cache-control", "no-store"),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
    ] {
        response.headers_mut().insert(key, value.parse().unwrap());
    }
    response
}

fn open_browser(url: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(url)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| ApiError::new(503, "Impossible d’ouvrir le navigateur."))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err(ApiError::new(503, "Cette connexion nécessite Windows."))
    }
}

#[cfg(windows)]
fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    if bytes.is_empty() || bytes.len() > 65536 {
        return Err(ApiError::new(503, "Session Spotify invalide."));
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let entropy_bytes = b"Notchy Rust Spotify session v1";
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let success = unsafe {
        if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err(ApiError::new(
            503,
            "Le stockage sécurisé Windows est indisponible.",
        ));
    }
    if output.pbData.is_null() || output.cbData == 0 || output.cbData > 65536 {
        if !output.pbData.is_null() {
            unsafe {
                LocalFree(output.pbData as *mut _);
            }
        }
        return Err(ApiError::new(503, "Session Spotify invalide."));
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}
#[cfg(not(windows))]
fn protect(_: &[u8], _: bool) -> Result<Vec<u8>> {
    Err(ApiError::new(
        503,
        "Le stockage sécurisé Windows est indisponible.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Semaphore;

    #[derive(Clone)]
    struct Call {
        method: String,
        path: String,
        body: Value,
    }
    struct Mock {
        calls: Mutex<Vec<Call>>,
        handler: Arc<dyn Fn(&Call) -> (u16, Value, Option<&'static str>) + Send + Sync>,
        gate: Option<Arc<Semaphore>>,
    }
    struct Fixture {
        _directory: tempfile::TempDir,
        service: Arc<Spotify>,
        mock: Arc<Mock>,
        server: tokio::task::JoinHandle<()>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    async fn mocked(State(mock): State<Arc<Mock>>, request: Request) -> Response {
        let method = request.method().to_string();
        let path = request.uri().to_string();
        let bytes = axum::body::to_bytes(request.into_body(), 65536)
            .await
            .unwrap();
        let call = Call {
            method,
            path,
            body: serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned())),
        };
        mock.calls.lock().await.push(call.clone());
        if call.path == "/play" {
            if let Some(gate) = &mock.gate {
                let permit = gate.acquire().await.unwrap();
                permit.forget();
            }
        }
        let (status, value, retry) = (mock.handler)(&call);
        let mut response = if status == 204 {
            (axum::http::StatusCode::NO_CONTENT, "").into_response()
        } else {
            (
                axum::http::StatusCode::from_u16(status).unwrap(),
                axum::Json(value),
            )
                .into_response()
        };
        if let Some(retry) = retry {
            response
                .headers_mut()
                .insert("retry-after", retry.parse().unwrap());
        }
        response
    }

    async fn fixture<F>(scopes: &[&str], handler: F, gate: Option<Arc<Semaphore>>) -> Fixture
    where
        F: Fn(&Call) -> (u16, Value, Option<&'static str>) + Send + Sync + 'static,
    {
        let directory = tempfile::Builder::new()
            .prefix("notchy-rust-spotify-")
            .tempdir()
            .unwrap();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let mock = Arc::new(Mock {
            calls: Mutex::new(Vec::new()),
            handler: Arc::new(handler),
            gate,
        });
        let app = Router::new().fallback(mocked).with_state(mock.clone());
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let mut service = Spotify::new(directory.path().to_path_buf());
        service.client_id = Ok("a".repeat(32));
        service.memory_store = true;
        service.test_routes = Some([
            format!("{base}/token"),
            format!("{base}/queue"),
            format!("{base}/play"),
        ]);
        {
            let state = service.state.get_mut();
            state.loaded = true;
            state.tokens = Some(Tokens {
                access_token: "fixture-access".into(),
                refresh_token: "fixture-refresh".into(),
                expires: now() + 3600000,
                scopes: scopes.iter().map(|scope| (*scope).into()).collect(),
            });
            state.cache = projection("connected", state.tokens.as_ref().unwrap().can_play());
        }
        Fixture {
            _directory: directory,
            service: Arc::new(service),
            mock,
            server,
        }
    }

    fn track(id: char, kind: &str) -> Value {
        let id = id.to_string().repeat(22);
        json!({"id":id,"uri":format!("spotify:{kind}:{id}"),"type":kind,"name":"Fixture title","artists":[{"name":"Fixture artist"}],"duration_ms":180000})
    }
    fn play(id: char) -> Value {
        json!({"command":"play-track","uri":format!("spotify:track:{}",id.to_string().repeat(22))})
    }

    #[test]
    fn client_configuration_is_local_validated_and_environment_takes_priority() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("spotify-client.json");
        assert_eq!(configured_client_id(&path, None), Err("configuration-required"));
        let id = "a".repeat(32);
        assert_eq!(configured_client_id(&path, Some(&id)), Ok(id.clone()));
        std::fs::write(&path, serde_json::to_vec(&json!({"clientId":id})).unwrap()).unwrap();
        assert_eq!(configured_client_id(&path, None), Ok(id.clone()));
        for value in ["", "invalid", "NOTCHY_SPOTIFY_CLIENT_ID=invalid"] {
            assert_eq!(configured_client_id(&path, Some(value)), Err("configuration-invalid"));
        }
        for invalid in [
            json!({"clientId":"g".repeat(32)}),
            json!({"clientId":format!(" {id}")}),
            json!({"client_id":id}),
            json!({"clientId":id,"clientSecret":"unsupported"}),
            json!({"clientId":false}),
        ] {
            std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert_eq!(configured_client_id(&path, None), Err("configuration-invalid"));
        }
        std::fs::write(&path, b"{invalid").unwrap();
        assert_eq!(configured_client_id(&path, None), Err("configuration-invalid"));
        assert_eq!(configured_client_id(&path, Some(&id)), Ok(id));
        std::fs::write(&path, vec![b' '; 2049]).unwrap();
        assert_eq!(configured_client_id(&path, None), Err("configuration-invalid"));
    }

    #[tokio::test]
    async fn absent_client_configuration_preserves_tokens_and_makes_no_network_request() {
        let mut f = fixture(&SCOPES, |_| (200, json!({}), None), None).await;
        Arc::get_mut(&mut f.service).unwrap().client_id = Err("configuration-required");
        for command in [json!("status"), json!("queue"), json!("connect"), play('A')] {
            let status = f.service.command(command).await.unwrap();
            assert_eq!(status["status"], "configuration-required");
            assert_eq!(status["canPlay"], false);
            assert!(status["message"].as_str().unwrap().contains("NOTCHY_SPOTIFY_CLIENT_ID"));
            assert!(!status.to_string().contains("fixture-access"));
        }
        assert!(f.mock.calls.lock().await.is_empty());
        assert_eq!(f.service.state.lock().await.tokens.as_ref().unwrap().refresh_token, "fixture-refresh");
        f.service.dispose().await;
    }

    #[test]
    fn commands_and_uri_membership_are_strict() {
        let uri = format!("spotify:track:{}", "A".repeat(22));
        assert!(valid_command(&json!({"command":"play-track","uri":uri})));
        for value in [
            json!({"command":"play-track","uri":format!("spotify:episode:{}","A".repeat(22))}),
            json!({"command":"play-track","uri":uri,"deviceId":"foreign"}),
            json!("transfer"),
            json!({"command":"queue"}),
            Value::Null,
        ] {
            assert!(!valid_command(&value));
        }
    }

    #[test]
    fn refreshing_a_read_only_grant_never_adds_playback_control() {
        let previous = Tokens {
            access_token: "fixture-access".into(),
            refresh_token: "fixture-refresh".into(),
            expires: 1,
            scopes: SCOPES[..2].iter().map(|scope| (*scope).into()).collect(),
        };
        let value =
            json!({"access_token":"fixture-refreshed","expires_in":3600,"scope":SCOPES.join(" ")});
        let refreshed = refreshed_tokens(&value, Some(&previous), false).unwrap();
        assert_eq!(refreshed.scopes, previous.scopes);
        assert!(!refreshed.can_play());
        assert_eq!(refreshed.refresh_token, previous.refresh_token);
        let value = json!({"access_token":"fixture-first","refresh_token":"fixture-refresh","expires_in":3600});
        assert!(refreshed_tokens(&value, None, true).unwrap().can_play());
    }

    #[test]
    fn normalized_tracks_strip_private_fields_bidi_and_foreign_artwork() {
        let item = json!({"id":"A".repeat(22),"uri":format!("spotify:track:{}","A".repeat(22)),"name":"Title\u{202e}\n","artists":[{"name":"Artist"}],"album":{"name":"Album","images":[{"url":"https://evil.invalid/secret","width":16},{"url":"https://i.scdn.co/image/authentic","width":64}]},"duration_ms":180000,"access_token":"private"});
        let result = normalize_track(&item).unwrap();
        assert_eq!(result["name"], "Title");
        assert_eq!(result["duration"], 180000);
        assert!(!result.to_string().contains("private"));
        assert_eq!(artwork_url(&item).unwrap().host_str(), Some("i.scdn.co"));
        for url in [
            "http://i.scdn.co/image/x",
            "https://i.scdn.co.evil.invalid/image/x",
            "https://token@i.scdn.co/image/x",
            "https://i.scdn.co/image/x?token=secret",
            "https://i.scdn.co:444/image/x",
        ] {
            assert!(artwork_url(&json!({"album":{"images":[{"url":url}]}})).is_none());
        }
    }

    #[tokio::test]
    async fn authentic_queue_membership_controls_one_uri_without_claiming_playback() {
        let f=fixture(&SCOPES,|call|if call.path=="/queue"{(200,json!({"currently_playing":track('C',"track"),"queue":[track('A',"track"),track('B',"episode")]}),None)}else{(204,Value::Null,None)},None).await;
        let queued = f.service.command(json!("queue")).await.unwrap();
        assert_eq!(queued["status"], "ok");
        assert_eq!(queued["canPlay"], true);
        assert!(queued["items"][1]["uri"].is_null());
        assert_eq!(
            f.service.command(play('Z')).await.unwrap()["status"],
            "invalid"
        );
        assert_eq!(
            f.service.command(play('C')).await.unwrap()["status"],
            "invalid"
        );
        let accepted = f.service.command(play('A')).await.unwrap();
        assert_eq!(accepted["status"], "accepted");
        assert_eq!(accepted["accepted"], true);
        assert!(accepted["current"].is_null());
        let calls = f.mock.calls.lock().await;
        let writes = calls
            .iter()
            .filter(|call| call.method == "PUT")
            .collect::<Vec<_>>();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].path, "/play");
        assert_eq!(
            writes[0].body,
            json!({"uris":[format!("spotify:track:{}","A".repeat(22))],"position_ms":0})
        );
        drop(calls);
        f.service.command(json!("queue")).await.unwrap();
        assert_eq!(
            f.mock
                .calls
                .lock()
                .await
                .iter()
                .filter(|call| call.path == "/queue")
                .count(),
            2
        );
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn readonly_queue_is_usable_and_playback_requires_explicit_new_consent() {
        let f = fixture(
            &SCOPES[..2],
            |_| (200, json!({"queue":[track('A',"track")]}), None),
            None,
        )
        .await;
        assert_eq!(
            f.service.command(json!("queue")).await.unwrap()["canPlay"],
            false
        );
        assert_eq!(
            f.service.command(play('A')).await.unwrap()["status"],
            "scope-required"
        );
        assert!(f
            .mock
            .calls
            .lock()
            .await
            .iter()
            .all(|call| call.method == "GET"));
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn concurrent_reads_share_the_bounded_cache_and_stale_membership_is_refreshed() {
        let reads = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let counted = reads.clone();
        let f = fixture(
            &SCOPES,
            move |call| {
                if call.path == "/queue" {
                    let id = if counted.fetch_add(1, Ordering::AcqRel) == 0 {
                        'A'
                    } else {
                        'B'
                    };
                    (200, json!({"queue":[track(id,"track")]}), None)
                } else {
                    (204, Value::Null, None)
                }
            },
            None,
        )
        .await;
        let values = join_all((0..3).map(|_| f.service.command(json!("queue")))).await;
        assert!(values
            .iter()
            .all(|value| value.as_ref().unwrap()["status"] == "ok"));
        assert_eq!(reads.load(Ordering::Acquire), 1);
        f.service.state.lock().await.cached_at = Some(now() - 30001);
        assert_eq!(
            f.service.command(play('A')).await.unwrap()["status"],
            "invalid"
        );
        assert_eq!(reads.load(Ordering::Acquire), 2);
        assert!(f
            .mock
            .calls
            .lock()
            .await
            .iter()
            .all(|call| call.method == "GET"));
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn refresh_retains_readonly_scope_and_denial_never_fabricates_a_queue() {
        let reads = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let counted = reads.clone();
        let f=fixture(&SCOPES[..2],move|call|if call.path=="/token"{(200,json!({"access_token":"fixture-refreshed","expires_in":3600,"scope":SCOPES.join(" ")}),None)}else if counted.fetch_add(1,Ordering::AcqRel)==0{(401,json!({}),None)}else{(403,json!({}),None)},None).await;
        let result = f.service.command(json!("queue")).await.unwrap();
        assert_eq!(result["status"], "forbidden");
        assert!(result["items"].as_array().unwrap().is_empty());
        assert_eq!(f.mock.calls.lock().await.len(), 3);
        assert!(!f
            .service
            .state
            .lock()
            .await
            .tokens
            .as_ref()
            .unwrap()
            .can_play());
        assert!(!result.to_string().contains("fixture-refreshed"));
        let calls = f.mock.calls.lock().await;
        let token = calls.iter().find(|call| call.path == "/token").unwrap();
        let fields = url::form_urlencoded::parse(token.body.as_str().unwrap().as_bytes()).into_owned().collect::<HashMap<_, _>>();
        assert_eq!(fields.get("client_id"), Some(&"a".repeat(32)));
        assert!(!fields.contains_key("client_secret"));
        drop(calls);
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn rate_limit_and_large_response_are_bounded_without_repeat_network_reads() {
        let f = fixture(&SCOPES, |_| (429, json!({}), Some("99999")), None).await;
        assert_eq!(
            f.service.command(json!("queue")).await.unwrap()["retryAfter"],
            300
        );
        assert_eq!(
            f.service.command(json!("queue")).await.unwrap()["status"],
            "limited"
        );
        assert_eq!(f.mock.calls.lock().await.len(), 1);
        f.service.dispose().await;
        let f = fixture(
            &SCOPES,
            |_| (200, json!({"padding":"X".repeat(API_LIMIT+1)}), None),
            None,
        )
        .await;
        assert_eq!(
            f.service.command(json!("queue")).await.unwrap()["status"],
            "offline"
        );
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn disconnect_aborts_a_write_and_delayed_reply_cannot_resurrect_the_session() {
        let gate = Arc::new(Semaphore::new(0));
        let f = fixture(
            &SCOPES,
            |call| {
                if call.path == "/queue" {
                    (200, json!({"queue":[track('A',"track")]}), None)
                } else {
                    (204, Value::Null, None)
                }
            },
            Some(gate.clone()),
        )
        .await;
        f.service.command(json!("queue")).await.unwrap();
        let service = f.service.clone();
        let playing = tokio::spawn(async move { service.command(play('A')).await.unwrap() });
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if f.mock
                    .calls
                    .lock()
                    .await
                    .iter()
                    .any(|call| call.path == "/play")
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            f.service.command(play('A')).await.unwrap()["status"],
            "busy"
        );
        assert_eq!(
            f.service.command(json!("disconnect")).await.unwrap()["status"],
            "disconnected"
        );
        gate.add_permits(1);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), playing)
                .await
                .unwrap()
                .unwrap()["status"],
            "cancelled"
        );
        assert_eq!(
            f.service.command(json!("status")).await.unwrap()["status"],
            "disconnected"
        );
        f.service.dispose().await;
    }

    #[tokio::test]
    async fn electron_token_blob_is_not_read_or_removed_during_rust_migration() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join("spotify-session.bin");
        fs::write(&legacy, b"Electron fixture that must remain intact")
            .await
            .unwrap();
        let mut service = Spotify::new(directory.path().to_path_buf());
        service.client_id = Ok("a".repeat(32));
        let service = Arc::new(service);
        assert_eq!(
            service.command(json!("status")).await.unwrap()["status"],
            "disconnected"
        );
        assert_eq!(
            service.command(json!("disconnect")).await.unwrap()["status"],
            "disconnected"
        );
        assert_eq!(
            fs::read(&legacy).await.unwrap(),
            b"Electron fixture that must remain intact"
        );
        service.dispose().await;
    }
}
