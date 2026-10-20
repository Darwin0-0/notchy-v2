use crate::{
    error::ApiError,
    file_tools::{FileTools, MAX_TEXT},
    localsend::LocalSend,
    music::Music,
    shelf::{valid_id, Shelf, ShelfFile},
    spotify::Spotify,
    weather::Weather,
};
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Response, Sse,
    },
    Router,
};
use futures_util::{stream, StreamExt};
use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use std::{
    convert::Infallible,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{net::TcpListener, sync::Mutex, task::JoinHandle};
use tokio_util::{io::ReaderStream, sync::CancellationToken};

static ASSETS: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/../dist");
type Result<T> = std::result::Result<T, ApiError>;

pub struct Services {
    pub shelf: Arc<Shelf>,
    pub files: Arc<FileTools>,
    pub nearby: Arc<LocalSend>,
    pub music: Arc<Music>,
    pub weather: Arc<Weather>,
    pub spotify: Arc<Spotify>,
    disposed: AtomicBool,
}
impl Services {
    pub async fn new(root: PathBuf, native: PathBuf) -> anyhow::Result<Self> {
        tokio::fs::create_dir_all(root.join(".desktop-profile")).await?;
        let shelf = Arc::new(Shelf::new(root.join(".shelf")).await?);
        let files =
            Arc::new(FileTools::new(shelf.as_ref().clone(), native.join("OcrBridge.exe")).await?);
        let nearby = Arc::new(LocalSend::new(root.join(".localsend"), shelf.clone()).await?);
        Ok(Self {
            shelf,
            files,
            nearby,
            music: Arc::new(Music::new(native.clone())),
            weather: Arc::new(Weather::new(root.join("weather.json"), native.clone()).await?),
            spotify: Arc::new(Spotify::new(root.join(".desktop-profile/spotify-queue"))),
            disposed: AtomicBool::new(false),
        })
    }
    pub async fn dispose(&self) {
        if self.disposed.swap(true, Ordering::AcqRel) {
            return;
        }
        tokio::join!(
            self.files.dispose(),
            self.nearby.dispose(),
            self.music.dispose(),
            self.weather.dispose(),
            self.spotify.dispose()
        );
    }
}

#[derive(Clone)]
struct ServerState {
    services: Arc<Services>,
    port: u16,
    token: String,
    closing: CancellationToken,
}
pub struct Server {
    pub port: u16,
    pub token: String,
    services: Arc<Services>,
    closing: CancellationToken,
    task: Mutex<Option<JoinHandle<()>>>,
}
impl Server {
    pub async fn start(services: Arc<Services>, port: u16) -> anyhow::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
        let port = listener.local_addr()?.port();
        let token = crate::shelf::token();
        let closing = CancellationToken::new();
        let state = ServerState {
            services: services.clone(),
            port,
            token: token.clone(),
            closing: closing.clone(),
        };
        let app = Router::new().fallback(handle).with_state(state);
        let stopped = closing.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(stopped.cancelled_owned())
                .await;
        });
        Ok(Self {
            port,
            token,
            services,
            closing,
            task: Mutex::new(Some(task)),
        })
    }
    pub async fn dispose(&self) {
        self.closing.cancel();
        self.services.dispose().await;
        if let Some(mut task) = self.task.lock().await.take() {
            if tokio::time::timeout(Duration::from_secs(2), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.closing.cancel();
    }
}

fn failure(status: u16, message: &str) -> ApiError {
    ApiError::new(status, message)
}
fn reply(status: u16, value: Value) -> Response {
    (
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        axum::Json(value),
    )
        .into_response()
}
fn query(uri: &axum::http::Uri) -> Vec<(String, String)> {
    url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .into_owned()
        .collect()
}
fn single<'a>(parameters: &'a [(String, String)], key: &str) -> Option<&'a str> {
    let mut values = parameters
        .iter()
        .filter(|(name, _)| name == key)
        .map(|(_, value)| value.as_str());
    let first = values.next()?;
    if values.next().is_some() {
        None
    } else {
        Some(first)
    }
}
fn only(parameters: &[(String, String)], keys: &[&str]) -> bool {
    parameters
        .iter()
        .all(|(key, _)| keys.contains(&key.as_str()))
}
fn is_file_url(path: &str) -> bool {
    path.strip_prefix("/api/shelf/")
        .or_else(|| path.strip_prefix("/api/files/input/"))
        .is_some_and(valid_id)
}
fn secure(state: &ServerState, request: &Request, parameters: &[(String, String)]) -> Result<()> {
    let headers = request.headers();
    let expected = format!("127.0.0.1:{}", state.port);
    let origin = format!("http://{expected}");
    if request.uri().to_string().len() > 4096
        || headers.get(header::HOST).and_then(|x| x.to_str().ok()) != Some(expected.as_str())
        || headers
            .get(header::ORIGIN)
            .is_some_and(|x| x.to_str().ok() != Some(origin.as_str()))
        || headers
            .get("sec-fetch-site")
            .is_some_and(|x| x == "cross-site")
    {
        return Err(failure(403, "Origine refusée."));
    }
    if state.closing.is_cancelled() {
        return Err(failure(503, "Notchy est fermé."));
    }
    let path = request.uri().path();
    if !path.starts_with("/api/") {
        return Ok(());
    }
    let mutation = matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::DELETE | Method::PATCH
    );
    if mutation
        && headers.get(header::ORIGIN).and_then(|x| x.to_str().ok()) != Some(origin.as_str())
    {
        return Err(failure(403, "Origine refusée."));
    }
    if request.method() == Method::GET && is_file_url(path) {
        return Ok(());
    }
    let supplied = headers.get("x-notchy").and_then(|x| x.to_str().ok());
    let event = path == "/api/music/events";
    if supplied != Some(state.token.as_str())
        && !(event
            && request.method() == Method::GET
            && single(parameters, "token") == Some(state.token.as_str()))
    {
        return Err(failure(403, "Accès au service refusé."));
    }
    Ok(())
}

async fn handle(State(state): State<ServerState>, request: Request) -> Response {
    let mut response = match dispatch(&state, request).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
        .headers_mut()
        .insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("frame-src 'none'; frame-ancestors 'none'"),
    );
    response
}

fn binary(headers: &HeaderMap) -> Result<Option<u64>> {
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|x| x.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if !mime.eq_ignore_ascii_case("application/octet-stream") {
        return Err(failure(415, "Fichier binaire requis."));
    }
    match headers.get(header::CONTENT_LENGTH) {
        None => Ok(None),
        Some(value) => {
            let value = value
                .to_str()
                .map_err(|_| failure(400, "La taille annoncée du fichier est invalide."))?;
            if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                return Err(failure(400, "La taille annoncée du fichier est invalide."));
            }
            value
                .parse()
                .map(Some)
                .map_err(|_| failure(400, "La taille annoncée du fichier est invalide."))
        }
    }
}
async fn control(request: Request, maximum: usize) -> Result<Value> {
    let mime = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|x| x.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if !mime.eq_ignore_ascii_case("application/json") {
        return Err(failure(415, "JSON requis."));
    }
    let body = tokio::time::timeout(
        Duration::from_secs(15),
        to_bytes(request.into_body(), maximum),
    )
    .await
    .map_err(|_| failure(408, "La demande a été interrompue."))?
    .map_err(|_| failure(413, "La demande est trop volumineuse."))?;
    serde_json::from_slice(&body).map_err(|_| failure(400, "Requête JSON invalide."))
}
fn id_control<'a>(value: &'a Value, key: &str, allow_text: bool) -> Result<&'a str> {
    let object = value
        .as_object()
        .ok_or_else(|| failure(400, "Requête invalide."))?;
    if !object
        .keys()
        .all(|name| name == key || allow_text && name == "text")
        || value.get("text").is_some_and(|text| {
            !allow_text
                || text
                    .as_str()
                    .is_none_or(|text| text.chars().count() > MAX_TEXT || text.contains('\0'))
        })
    {
        return Err(failure(400, "Requête invalide."));
    }
    value[key]
        .as_str()
        .filter(|id| valid_id(id))
        .ok_or_else(|| failure(400, "Identifiant invalide."))
}

async fn dispatch(state: &ServerState, request: Request) -> Result<Response> {
    let parameters = query(request.uri());
    secure(state, &request, &parameters)?;
    let path = request.uri().path().to_string();
    let method = request.method().clone();
    if matches!(path.as_str(), "/api/activities" | "/api/activities/events" | "/api/clipboard") {
        return Err(failure(404, "Module indisponible."));
    }
    if method == Method::OPTIONS {
        return Err(failure(405, "Méthode refusée."));
    }
    if !path.starts_with("/api/") {
        return asset(&path, &method);
    }
    if path == "/api/music/events" && method == Method::GET {
        if !only(&parameters, &["token", "spectrum"])
            || parameters
                .iter()
                .filter(|(key, _)| key == "spectrum")
                .count()
                > 1
            || single(&parameters, "spectrum").is_some_and(|v| v != "0" && v != "1")
        {
            return Err(failure(400, "Paramètres musicaux invalides."));
        }
        return Ok(music_events(state, single(&parameters, "spectrum") == Some("1")).await);
    }
    if path == "/api/weather/search" && method == Method::GET {
        if !only(&parameters, &["q"]) {
            return Err(failure(400, "Recherche de ville invalide."));
        }
        let search =
            single(&parameters, "q").ok_or_else(|| failure(400, "Recherche de ville invalide."))?;
        return Ok(reply(200, state.services.weather.search(search).await?));
    }
    if path == "/api/shelf" && method == Method::POST
        || path == "/api/files/input" && method == Method::POST
    {
        if !only(&parameters, &["name"]) {
            return Err(failure(400, "Nom de fichier invalide."));
        }
        let name = single(&parameters, "name")
            .ok_or_else(|| failure(400, "Nom de fichier invalide."))?
            .to_string();
        let size = binary(request.headers())?;
        let incoming = request.into_body().into_data_stream();
        let stopped = state.closing.clone();
        let body = stream::unfold(
            (incoming, stopped, false),
            |(mut incoming, stopped, finished)| async move {
                if finished {
                    return None;
                }
                let item = tokio::select! {
                    biased;
                    _=stopped.cancelled()=>Some(Err(failure(409,"Envoi interrompu."))),
                    value=incoming.next()=>value.map(|value|value.map_err(|_|failure(400,"Envoi interrompu."))),
                }?;
                let finished = item.is_err();
                Some((item, (incoming, stopped, finished)))
            },
        );
        let result = if path == "/api/shelf" {
            state.services.shelf.add_stream(&name, body, size).await?
        } else {
            state
                .services
                .files
                .add_input_stream(&name, body, size)
                .await?
        };
        return Ok(reply(201, result));
    }
    if let Some(id) = path
        .strip_prefix("/api/shelf/")
        .or_else(|| path.strip_prefix("/api/files/input/"))
    {
        if !valid_id(id) {
            return Err(failure(400, "Identifiant invalide."));
        }
        let input = path.starts_with("/api/files/input/");
        if method == Method::GET {
            if !only(&parameters, &["preview"])
                || parameters.len() > 1
                || single(&parameters, "preview").is_some_and(|v| v != "0" && v != "1")
            {
                return Err(failure(400, "Paramètres de fichier invalides."));
            }
            let preview = single(&parameters, "preview") == Some("1");
            let opened = if input {
                state.services.files.open_input(id, preview).await?
            } else {
                state.services.shelf.open(id, preview).await?
            };
            return file_response(opened, preview, state.closing.clone());
        }
        if method == Method::DELETE {
            if !parameters.is_empty() {
                return Err(failure(400, "Paramètres de fichier invalides."));
            }
            return Ok(reply(
                200,
                if input {
                    state.services.files.remove_input(id).await?
                } else {
                    state.services.shelf.remove(id).await?
                },
            ));
        }
        return Err(failure(405, "Méthode refusée."));
    }
    if !parameters.is_empty() {
        return Err(failure(400, "Paramètres invalides."));
    }
    if method == Method::GET {
        let value = match path.as_str() {
            "/api/shelf" => state.services.shelf.list().await?,
            "/api/nearby" => state.services.nearby.snapshot().await,
            "/api/music" => state.services.music.snapshot().await,
            "/api/weather" => state.services.weather.snapshot().await,
            "/api/files/tool" => state.services.files.get_state().await,
            "/api/files/tool/capabilities" => state.services.files.capabilities().await,
            "/api/spotify" => state.services.spotify.command(json!("status")).await?,
            _ => return Err(failure(405, "Méthode ou route refusée.")),
        };
        return Ok(reply(200, value));
    }
    if method != Method::POST {
        return Err(failure(405, "Méthode refusée."));
    }
    let value = control(
        request,
        if path == "/api/files/tool/save" {
            4 * 1024 * 1024
        } else {
            16 * 1024
        },
    )
    .await?;
    let result = match path.as_str() {
        "/api/music" => state.services.music.command(value).await?,
        "/api/weather" => state.services.weather.command(value).await?,
        "/api/spotify" => state.services.spotify.command(value).await?,
        "/api/nearby" => match state
            .services
            .nearby
            .command(value, &state.services.files)
            .await
        {
            Ok(value) => {
                let status = if value["error"].is_string() || value["transfer"]["error"].is_string()
                {
                    409
                } else {
                    200
                };
                return Ok(reply(status, value));
            }
            Err(failure) => {
                let mut snapshot = state.services.nearby.snapshot().await;
                snapshot["error"] = json!(failure.message);
                return Ok(reply(failure.status, snapshot));
            }
        },
        "/api/files/tool" => return Ok(reply(202, state.services.files.start(value).await?)),
        "/api/files/tool/cancel" => {
            let id = id_control(&value, "jobId", false)?;
            state.services.files.cancel(id).await?
        }
        "/api/files/tool/save" => {
            let id = id_control(&value, "jobId", true)?;
            let text = value
                .get("text")
                .and_then(Value::as_str)
                .map(str::to_string);
            return Ok(reply(201, state.services.files.save(id, text).await?));
        }
        "/api/files/keep" => {
            let id = id_control(&value, "id", false)?;
            return Ok(reply(201, state.services.files.keep(id).await?));
        }
        _ => return Err(failure(405, "Méthode ou route refusée.")),
    };
    let status = if result.get("ok") == Some(&json!(false)) {
        409
    } else {
        200
    };
    Ok(reply(status, result))
}

#[cfg(debug_assertions)]
fn development_asset(root: &std::path::Path, path: &str) -> Result<Vec<u8>> {
    use std::{fs, io::Read, path::Component};
    let missing = || failure(404, "Page introuvable.");
    // Keep the exact packaged asset allowlist, including in development.
    if ASSETS.get_file(path).is_none() || path.contains('\\')
        || std::path::Path::new(path).components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err(missing());
    }
    let plain = |metadata: &fs::Metadata| {
        if metadata.file_type().is_symlink() { return false; }
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 { return false; }
        }
        true
    };
    let metadata = fs::symlink_metadata(root).map_err(|_| missing())?;
    if !metadata.is_dir() || !plain(&metadata) { return Err(missing()); }
    let root = root.canonicalize().map_err(|_| missing())?;
    let mut filename = root.clone();
    for part in std::path::Path::new(path).components() {
        filename.push(part);
        if !plain(&fs::symlink_metadata(&filename).map_err(|_| missing())?) { return Err(missing()); }
    }
    let canonical = filename.canonicalize().map_err(|_| missing())?;
    if !canonical.starts_with(&root) || canonical != filename { return Err(missing()); }
    let mut options = fs::OpenOptions::new(); options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(&filename).map_err(|_| missing())?;
    let metadata = file.metadata().map_err(|_| missing())?;
    const MAX_ASSET: u64 = 32 * 1024 * 1024;
    if !metadata.is_file() || !plain(&metadata) || metadata.len() > MAX_ASSET { return Err(missing()); }
    let mut bytes = Vec::new(); file.take(MAX_ASSET + 1).read_to_end(&mut bytes).map_err(|_| missing())?;
    if bytes.len() as u64 > MAX_ASSET || filename.canonicalize().map_err(|_| missing())? != canonical { return Err(missing()); }
    Ok(bytes)
}

fn asset(path: &str, method: &Method) -> Result<Response> {
    if method != Method::GET && method != Method::HEAD {
        return Err(failure(404, "Page introuvable."));
    }
    let path = if path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };
    if path.contains('\\') || path.split('/').any(|part| part == ".." || part == ".") {
        return Err(failure(404, "Page introuvable."));
    }
    let file = ASSETS
        .get_file(path)
        .ok_or_else(|| failure(404, "Page introuvable."))?;
    let extension = PathBuf::from(path)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_string();
    let mime = match extension.as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        "ico" => "image/x-icon",
        "png" => "image/png",
        _ => return Err(failure(404, "Page introuvable.")),
    };
    #[cfg(debug_assertions)]
    let contents = development_asset(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("dist"), path)?;
    #[cfg(not(debug_assertions))]
    let contents = file.contents();
    #[cfg(debug_assertions)]
    let _ = file; // The embedded table is the allowlist; bytes come from the live dist directory.
    let bytes = if extension == "html" {
        String::from_utf8_lossy(contents.as_ref())
            .replace(
                "connect-src 'self'",
                "connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'",
            )
            .into_bytes()
    } else {
        contents.to_vec()
    };
    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, bytes.len())
        .body(if method == Method::HEAD {
            Body::empty()
        } else {
            Body::from(bytes)
        })
        .map_err(|_| failure(503, "Page indisponible."))
}
fn encoded_filename(name: &str) -> String {
    name.as_bytes()
        .iter()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(byte) {
                (*byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
fn file_response(opened: ShelfFile, preview: bool, closing: CancellationToken) -> Result<Response> {
    let name = opened.item["name"].as_str().unwrap_or("fichier");
    let fallback: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || " ._-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let disposition = format!(
        "{}; filename=\"{}\"; filename*=UTF-8''{}",
        if preview { "inline" } else { "attachment" },
        fallback,
        encoded_filename(name)
    );
    let stream = ReaderStream::new(opened.file).take_until(closing.cancelled_owned());
    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, opened.mime)
        .header(
            header::CONTENT_LENGTH,
            opened.item["size"].as_u64().unwrap_or(0),
        )
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::from_stream(stream))
        .map_err(|_| failure(503, "Fichier indisponible."))
}

async fn music_events(state: &ServerState, spectrum: bool) -> Response {
    let subscription = state.services.music.subscribe(spectrum).await;
    let initial = state.services.music.snapshot().await;
    let closing = state.closing.clone();
    let music = state.services.music.clone();
    let stream = stream::unfold(
        (subscription, Some(initial), closing, music, spectrum),
        |(mut subscription, mut initial, closing, music, spectrum)| async move {
            let result = loop {
                let next = if let Some(initial) = initial.take() {
                    ("music".to_string(), initial)
                } else {
                    let event = tokio::select! {_=closing.cancelled()=>return None,value=subscription.receiver.recv()=>value};
                    match event {
                        Ok(value) => value,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            subscription.receiver = subscription.receiver.resubscribe();
                            ("music".into(), music.snapshot().await)
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                    }
                };
                if next.0 != "spectrum" || spectrum {
                    break next;
                }
            };
            let encoded = serde_json::to_string(&result.1).ok()?;
            if encoded.len() > 6_000_000 {
                return None;
            }
            Some((
                Ok::<_, Infallible>(Event::default().event(result.0).data(encoded)),
                (subscription, None, closing, music, spectrum),
            ))
        },
    );
    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keepalive"),
        )
        .into_response()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(debug_assertions)]
    #[test]
    fn development_assets_reload_only_packaged_files_and_keep_their_bounds() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("dist"); std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("index.html"), b"first UI").unwrap();
        assert_eq!(development_asset(&root, "index.html").unwrap(), b"first UI");
        std::fs::write(root.join("index.html"), b"updated UI without recompilation").unwrap();
        assert_eq!(development_asset(&root, "index.html").unwrap(), b"updated UI without recompilation");
        std::fs::write(root.join("private.json"), b"not a packaged asset").unwrap();
        for path in ["private.json", "../index.html", "./index.html", "/index.html", "assets/../../index.html", "assets\\index.html", "index.html%00", "missing.js"] {
            assert_eq!(development_asset(&root, path).unwrap_err().status, 404, "{path}");
        }
        std::fs::remove_file(root.join("index.html")).unwrap();
        std::fs::create_dir(root.join("index.html")).unwrap();
        assert_eq!(development_asset(&root, "index.html").unwrap_err().status, 404);
    }
    #[cfg(debug_assertions)]
    #[test]
    fn development_assets_reject_oversized_files_before_reading() {
        let directory = tempfile::tempdir().unwrap();
        let file = std::fs::File::create(directory.path().join("index.html")).unwrap();
        file.set_len(32 * 1024 * 1024 + 1).unwrap();
        assert_eq!(development_asset(directory.path(), "index.html").unwrap_err().status, 404);
    }
    #[cfg(debug_assertions)]
    #[test]
    fn development_assets_cannot_follow_a_linked_root_or_nested_directory() {
        fn directory_link(source: &std::path::Path, destination: &std::path::Path) {
            #[cfg(unix)] std::os::unix::fs::symlink(source, destination).unwrap();
            #[cfg(windows)] {
                let result = std::process::Command::new("cmd.exe").args(["/D", "/C", "mklink", "/J"])
                    .arg(destination).arg(source).output().unwrap();
                assert!(result.status.success(), "The isolated junction fixture could not be created");
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("outside"); let root = directory.path().join("dist");
        std::fs::create_dir(&source).unwrap(); std::fs::create_dir(&root).unwrap();
        std::fs::write(source.join("index.html"), b"outside root").unwrap();
        std::fs::write(source.join("duration-dm-sans.woff2"), b"outside root").unwrap();
        let linked_root = directory.path().join("linked-dist"); directory_link(&source, &linked_root);
        assert_eq!(development_asset(&linked_root, "index.html").unwrap_err().status, 404);
        directory_link(&source, &root.join("assets"));
        assert_eq!(development_asset(&root, "assets/duration-dm-sans.woff2").unwrap_err().status, 404);
    }
    async fn fixture() -> (tempfile::TempDir, Arc<Services>, Server, reqwest::Client) {
        let directory = tempfile::tempdir().unwrap();
        let services = Arc::new(
            Services::new(
                directory.path().to_path_buf(),
                directory.path().join("missing-native"),
            )
            .await
            .unwrap(),
        );
        let server = Server::start(services.clone(), 0).await.unwrap();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        (directory, services, server, client)
    }
    #[tokio::test]
    async fn base_modules_ignore_old_clipboard_settings_and_retired_apis_cannot_collect() {
        let directory = tempfile::tempdir().unwrap();
        let profile = directory.path().join(".desktop-profile");
        tokio::fs::create_dir_all(&profile).await.unwrap();
        let privacy = profile.join("clipboard-privacy.json");
        let previous = b"{invalid legacy clipboard settings";
        tokio::fs::write(&privacy, previous).await.unwrap();
        let services = Arc::new(Services::new(directory.path().to_path_buf(), directory.path().join("missing-native")).await.unwrap());
        let server = Server::start(services, 0).await.unwrap();
        let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().unwrap();
        let base = format!("http://127.0.0.1:{}", server.port);
        for path in ["/api/clipboard", "/api/activities", "/api/activities/events"] {
            for method in [Method::GET, Method::POST] {
                let response = client.request(method, format!("{base}{path}"))
                    .header("X-Notchy", &server.token)
                    .header("Origin", &base)
                    .json(&json!({"command":"enable"}))
                    .send().await.unwrap();
                assert_eq!(response.status(), 404, "{path} cannot expose or activate a removed collector");
            }
        }
        assert_eq!(tokio::fs::read(&privacy).await.unwrap(), previous);
        server.dispose().await;
    }
    #[tokio::test]
    async fn public_assets_never_serve_storage_and_csp_allows_tauri_ipc() {
        let (_directory, _services, server, client) = fixture().await;
        let base = format!("http://127.0.0.1:{}", server.port);
        let response = client.get(&base).send().await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()[header::X_CONTENT_TYPE_OPTIONS],
            "nosniff"
        );
        assert!(response
            .text()
            .await
            .unwrap()
            .contains("ipc: http://ipc.localhost"));
        for path in ["/app.bundle.js", "/module-layout.css"] {
            let response = client.get(format!("{base}{path}")).send().await.unwrap();
            assert_eq!(response.status(), 200);
            assert!(response.headers()[header::CONTENT_TYPE].to_str().unwrap().contains(
                if path.ends_with(".js") { "text/javascript" } else { "text/css" }
            ));
            assert!(!response.bytes().await.unwrap().is_empty());
        }
        for path in [
            "/.shelf/manifest.json",
            "/src-tauri/Cargo.toml",
            "/package.json",
            "/app.js",
            "/notch.js",
            "/module-contracts.js",
            "/scripts/frontend-manifest.json",
            "/work/private.json",
        ] {
            assert_eq!(
                client
                    .get(format!("{base}{path}"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                404
            );
        }
        assert_eq!(
            client
                .get(&base)
                .header("Host", "evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        server.dispose().await;
    }
    #[tokio::test]
    async fn private_json_reads_and_mutations_require_token_and_origin() {
        let (_directory, _services, server, client) = fixture().await;
        let base = format!("http://127.0.0.1:{}", server.port);
        assert_eq!(
            client
                .get(format!("{base}/api/shelf"))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .get(format!("{base}/api/shelf"))
                .header("X-Notchy", &server.token)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .get(format!("{base}/api/shelf"))
                .header("X-Notchy", &server.token)
                .header("Origin", "https://evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .post(format!("{base}/api/files/keep"))
                .header("X-Notchy", &server.token)
                .json(&json!({"id":"a".repeat(32)}))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .get(format!("{base}/api/activities/events?token=wrong"))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        server.dispose().await;
    }
    #[tokio::test]
    async fn binary_files_stream_to_shelf_and_download_by_opaque_id() {
        let (_directory, _services, server, client) = fixture().await;
        let base = format!("http://127.0.0.1:{}", server.port);
        let response = client
            .post(format!("{base}/api/shelf?name=photo.png"))
            .header("X-Notchy", &server.token)
            .header("Origin", &base)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(vec![137, 80, 78, 71, 13, 10, 26, 10, 1])
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 201);
        let snapshot: Value = response.json().await.unwrap();
        let id = snapshot["item"]["id"].as_str().unwrap();
        let response = client
            .get(format!("{base}/api/shelf/{id}"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(response.headers()[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .starts_with("attachment"));
        assert_eq!(response.bytes().await.unwrap().len(), 9);
        let response = client
            .get(format!("{base}/api/shelf/{id}?preview=1"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(
            client
                .get(format!("{base}/api/shelf/{id}?preview=1&preview=1"))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        assert_eq!(
            client
                .delete(format!("{base}/api/shelf/{id}"))
                .header("X-Notchy", &server.token)
                .header("Origin", &base)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .get(format!("{base}/api/shelf/{id}"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        server.dispose().await;
    }
    #[tokio::test]
    async fn controls_are_bounded_but_upload_metadata_has_no_128mb_quota() {
        let (_directory, _services, server, client) = fixture().await;
        let base = format!("http://127.0.0.1:{}", server.port);
        let response = client
            .post(format!("{base}/api/files/tool"))
            .header("X-Notchy", &server.token)
            .header("Origin", &base)
            .header(header::CONTENT_TYPE, "application/json")
            .body(" ".repeat(16385))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 413);
        let response = client
            .post(format!("{base}/api/files/tool"))
            .header("X-Notchy", &server.token)
            .header("Origin", &base)
            .json(&json!({"id":"bad","command":"ocr"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400);
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        );
        headers.insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_static("5368709120"),
        );
        assert_eq!(binary(&headers).unwrap(), Some(5 * 1024 * 1024 * 1024));
        server.dispose().await;
    }
}
