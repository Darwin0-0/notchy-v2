//! OfficeViewer stays unmodified. This broker owns its disposable WPF workers;
//! neither QuickLook's UI dispatcher nor Notchy parses a workbook.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::{Path, PathBuf}, sync::Arc, time::{Duration, Instant, UNIX_EPOCH}};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const VERSION: &str = "office-isolation-v1";
const CACHE_BYTES: u64 = 128 * 1024 * 1024;
const CACHE_COUNT: usize = 64;
const SNAPSHOT_BYTES: u64 = 16 * 1024 * 1024;
const FILE_BYTES: u64 = 256 * 1024 * 1024;
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const PROCESS_MEMORY: usize = 1024 * 1024 * 1024;
const REQUEST_BYTES: u64 = 65536;
type Result<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    operation: String,
    secret: String,
    id: String,
    path: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply {
    phase: String,
    hwnd: Option<String>,
    cache_path: Option<String>,
    cache_hit: bool,
    error: Option<String>,
    pid: Option<u32>,
    worker_path: Option<String>,
    elapsed_ms: u64,
}
impl Reply {
    fn closed() -> Self { Self { phase: "closed".into(), hwnd: None, cache_path: None, cache_hit: false, error: None, pid: None, worker_path: None, elapsed_ms: 0 } }
    fn error(message: &str) -> Self { Self { phase: "error".into(), error: Some(message.into()), ..Self::closed() } }
}

struct Session {
    id: String,
    reply: Reply,
    cancel: CancellationToken,
    started: Instant,
    last_seen: Instant,
}

#[derive(Clone)]
struct ShelfSource {
    authoritative: PathBuf,
    copy_identity: String,
    authoritative_identity: String,
}

pub struct Broker {
    root: PathBuf,
    worker: PathBuf,
    quicklook: PathBuf,
    office: PathBuf,
    engine: String,
    secret: String,
    pipe: String,
    config: PathBuf,
    session: Mutex<Option<Session>>,
    stopping: CancellationToken,
    connections: Arc<tokio::sync::Semaphore>,
    worker_slot: tokio::sync::Semaphore,
    closed_ids: std::sync::Mutex<std::collections::VecDeque<String>>,
    shelf_sources: std::sync::Mutex<std::collections::BTreeMap<PathBuf, ShelfSource>>,
}

pub fn supports(path: &Path) -> bool {
    path.extension().and_then(|part| part.to_str()).is_some_and(|part|
        matches!(part.to_ascii_lowercase().as_str(), "doc" | "docx" | "docm" | "rtf" | "xls" | "xlsx" | "xlsm" | "pptx" | "pptm" | "potx" | "potm"))
}

fn plain(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir | std::path::Component::CurDir)) {
        return Err("Le chemin de l’aperçu doit être local et absolu.".into());
    }
    #[cfg(windows)] {
        use std::path::{Component, Prefix};
        let drive = match path.components().next() { Some(Component::Prefix(prefix)) => match prefix.kind() { Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive, _ => return Err("Seuls les documents locaux sont pris en charge.".into()) }, _ => return Err("Seuls les documents locaux sont pris en charge.".into()) };
        let root = [drive as u16, b':' as u16, b'\\' as u16, 0];
        if !matches!(unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(root.as_ptr()) }, 2 | 3 | 6) { return Err("Seuls les documents locaux sont pris en charge.".into()); }
    }
    for ancestor in path.ancestors() {
        if let Ok(metadata) = fs::symlink_metadata(ancestor) {
            let mut linked = metadata.file_type().is_symlink();
            #[cfg(windows)] { use std::os::windows::fs::MetadataExt; linked |= metadata.file_attributes() & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0; }
            if linked { return Err("Un chemin lié ou hors ligne ne peut pas être prévisualisé.".into()); }
        }
    }
    Ok(())
}

fn private_directory(path: &Path) -> Result<()> {
    plain(path)?;
    fs::create_dir_all(path).map_err(|_| "Le cache d’aperçu est indisponible.")?;
    plain(path)?;
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::{Foundation::{CloseHandle, LocalFree}, Security::{Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW, SE_FILE_OBJECT}, GetSecurityDescriptorDacl, GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION}, System::Threading::{GetCurrentProcess, OpenProcessToken}};
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 { return Err("Protection du cache indisponible.".into()); }
        let mut size = 0;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size);
        let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        let success = GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), size, &mut size);
        CloseHandle(token);
        if success == 0 { return Err("Protection du cache indisponible.".into()); }
        let mut text = std::ptr::null_mut();
        if ConvertSidToStringSidW((*(buffer.as_ptr().cast::<TOKEN_USER>())).User.Sid, &mut text) == 0 { return Err("Protection du cache indisponible.".into()); }
        let mut count = 0; while count < 256 && *text.add(count) != 0 { count += 1; }
        let sid = String::from_utf16(std::slice::from_raw_parts(text, count)); LocalFree(text.cast());
        let sid = sid.map_err(|_| "Protection du cache indisponible.")?;
        let descriptor_text: Vec<u16> = format!("D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)").encode_utf16().chain(Some(0)).collect();
        let mut descriptor = std::ptr::null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(descriptor_text.as_ptr(), 1, &mut descriptor, std::ptr::null_mut()) == 0 { return Err("Protection du cache indisponible.".into()); }
        let mut present = 0; let mut defaulted = 0; let mut dacl = std::ptr::null_mut();
        let name: Vec<u16> = path.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
        let success = GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted) != 0 && present != 0 &&
            SetNamedSecurityInfoW(name.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(), std::ptr::null_mut(), dacl, std::ptr::null()) == 0;
        LocalFree(descriptor);
        if !success { return Err("Protection du cache indisponible.".into()); }
    }
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| "Protection du cache indisponible.")?; }
    Ok(())
}

fn display(path: &Path) -> String { path.to_string_lossy().trim_start_matches(r"\\?\").to_owned() }

fn fingerprint(path: &Path, engine: &str, width: u32, height: u32) -> Result<(PathBuf, String)> {
    if !supports(path) { return Err("Ce format ne nécessite pas le moteur Office.".into()); }
    metadata_fingerprint(path, engine, width, height)
}

fn metadata_fingerprint(path: &Path, engine: &str, width: u32, height: u32) -> Result<(PathBuf, String)> {
    plain(path)?;
    let file = fs::File::open(path).map_err(|_| "Le document est indisponible.")?;
    let metadata = file.metadata().map_err(|_| "Le document est indisponible.")?;
    if !metadata.is_file() || metadata.len() > FILE_BYTES { return Err("Ce document dépasse la limite de l’aperçu. Ouvre-le dans WPS.".into()); }
    let canonical = fs::canonicalize(path).map_err(|_| "Le document est indisponible.")?;
    plain(&canonical)?;
    let modified = metadata.modified().map_err(|_| "Date du document indisponible.")?.duration_since(UNIX_EPOCH).map_err(|_| "Date du document invalide.")?.as_nanos();
    #[cfg(windows)]
    let identity = {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
        let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } == 0 { return Err("Identité du document indisponible.".into()); }
        format!("{}:{}:{}", information.dwVolumeSerialNumber, information.nFileIndexHigh, information.nFileIndexLow)
    };
    #[cfg(not(windows))]
    let identity = format!("{:?}", metadata.created());
    let key = hex::encode(Sha256::digest(format!("{VERSION}\0{}\0{identity}\0{}\0{modified}\0{engine}\0{width}\0{height}", display(&canonical).to_lowercase(), metadata.len()).as_bytes()));
    Ok((canonical, key))
}

fn valid_snapshot(path: &Path) -> bool {
    if plain(path).is_err() { return false; }
    let Ok(metadata) = fs::symlink_metadata(path) else { return false; };
    if !metadata.is_file() || metadata.len() > SNAPSHOT_BYTES || metadata.len() < 33 { return false; }
    let Ok(mut file) = fs::File::open(path) else { return false; };
    let mut header = [0u8; 24];
    if file.read_exact(&mut header).is_err() || &header[..8] != b"\x89PNG\r\n\x1a\n" || &header[12..16] != b"IHDR" { return false; }
    let width = u32::from_be_bytes(header[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(header[20..24].try_into().unwrap());
    width > 0 && height > 0 && width <= 4096 && height <= 4096 && (width as u64) * (height as u64) <= 8_000_000
}

fn prune(root: &Path, keep: Option<&Path>) -> Result<()> {
    plain(root)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| "Cache indisponible.")?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.len() != 68 || !name.ends_with(".png") || !name[..64].bytes().all(|byte| byte.is_ascii_hexdigit()) { continue; }
        let metadata = fs::symlink_metadata(&path).map_err(|_| "Cache indisponible.")?;
        if !metadata.is_file() || plain(&path).is_err() { continue; }
        entries.push((path, metadata.len(), metadata.modified().unwrap_or(UNIX_EPOCH)));
    }
    entries.sort_by_key(|entry| entry.2);
    let mut total: u64 = entries.iter().map(|entry| entry.1).sum();
    let mut count = entries.len();
    for (path, size, modified) in entries {
        if keep == Some(path.as_path()) { continue; }
        let expired = modified.elapsed().unwrap_or_default() > Duration::from_secs(14 * 86400);
        if !expired && total <= CACHE_BYTES && count <= CACHE_COUNT { continue; }
        // Only named files directly in our private cache, never recursive deletion.
        fs::remove_file(&path).map_err(|_| "Nettoyage du cache indisponible.")?;
        total = total.saturating_sub(size); count = count.saturating_sub(1);
    }
    Ok(())
}

impl Broker {
    /// Runtime files are installed explicitly beside the active QuickLook plugin.
    /// Starting this service never replaces or stops an external QuickLook process.
    pub async fn start(data: &Path, worker: PathBuf, quicklook: PathBuf, office: PathBuf, proxy: PathBuf) -> Result<Arc<Self>> {
        let root = data.join(".desktop-profile/office-preview");
        private_directory(&root)?;
        let cache = root.join("cache"); private_directory(&cache)?;
        let pending = root.join("pending"); private_directory(&pending)?;
        for path in [&worker, &quicklook, &office, &proxy] { plain(path)?; if !path.is_file() { return Err("Le moteur Office isolé est incomplet.".into()); } }
        // A metadata cache is specific to the renderer build; no whole-document
        // hashing lies on the first-frame path.
        let mut digest = Sha256::new();
        for path in [&worker, &office] { digest.update(fs::read(path).map_err(|_| "Moteur Office indisponible.")?); }
        let engine = hex::encode(digest.finalize());
        let secret = format!("{}{}", crate::shelf::token(), crate::shelf::token());
        let pipe = format!(r"\\.\pipe\Notchy.OfficePreview.{}", crate::shelf::token());
        let config = proxy.parent().ok_or("Extension Office indisponible.")?.join("NotchyBroker.json");
        if crate::office_preview_install::broker_running(&config)? { return Err("Une autre instance de Notchy contrôle déjà les aperçus Office.".into()); }
        // Config contains a capability, not a public endpoint. Its directory is
        // owned by this user; HTML frames cannot access named pipes or the file.
        private_directory(config.parent().unwrap())?;
        prune(&cache, None)?;
        let broker = Arc::new(Self { root, worker, quicklook, office, engine, secret, pipe, config, session: Mutex::new(None), stopping: CancellationToken::new(), connections: Arc::new(tokio::sync::Semaphore::new(8)), worker_slot: tokio::sync::Semaphore::new(1), closed_ids: std::sync::Mutex::new(std::collections::VecDeque::new()), shelf_sources: std::sync::Mutex::new(std::collections::BTreeMap::new()) });
        #[cfg(windows)] {
            let first = tokio::net::windows::named_pipe::ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true).create(&broker.pipe).map_err(|_| "Le canal des aperçus est indisponible.")?;
            let bytes = serde_json::to_vec(&json!({"pipe":broker.pipe,"secret":broker.secret,"pid":std::process::id(),"version":VERSION})).unwrap();
            plain(&broker.config)?;
            fs::write(&broker.config, bytes).map_err(|_| "La passerelle Office ne peut pas être activée.")?;
            let server = broker.clone(); tokio::spawn(async move { server.listen(first).await; });
        }
        #[cfg(not(windows))] { return Err("Les aperçus Office natifs nécessitent Windows.".into()); }
        #[cfg(windows)] {
            Ok(broker)
        }
    }

    pub async fn stop(&self) {
        self.stopping.cancel();
        if let Some(session) = self.session.lock().await.take() { session.cancel.cancel(); }
        // Do not revoke a newer instance's configuration.
        if fs::read(&self.config).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()).is_some_and(|value| value["secret"] == self.secret) {
            let _ = fs::remove_file(&self.config);
        }
    }

    pub async fn cancel(&self) {
        if let Some(session) = self.session.lock().await.as_mut() {
            session.cancel.cancel(); session.reply.phase = "closed".into(); session.reply.hwnd = None;
        }
    }

    /// Only the trusted Shelf route registers its immutable exported copy.
    /// The original remains a metadata identity and is never sent to the renderer.
    pub fn register_shelf_source(&self, copy: &Path, authoritative: &Path) -> Result<()> {
        let data = self.root.parent().and_then(Path::parent).ok_or("Stockage de l’étagère indisponible.")?;
        let shelf = data.join(".shelf"); let copies = data.join(".desktop-profile/quicklook-shelf");
        plain(&shelf)?; plain(&copies)?;
        let shelf = fs::canonicalize(shelf).map_err(|_| "Stockage de l’étagère indisponible.")?;
        let copies = fs::canonicalize(copies).map_err(|_| "Copies de l’étagère indisponibles.")?;
        let (copy, copy_identity) = fingerprint(copy, &self.engine, 0, 0)?;
        let (authoritative, authoritative_identity) = metadata_fingerprint(authoritative, &self.engine, 0, 0)?;
        if authoritative.parent() != Some(shelf.as_path()) || !authoritative.file_name().and_then(|part| part.to_str()).is_some_and(crate::shelf::valid_id)
            || !copy.starts_with(&copies) || copy == copies
        { return Err("La source de l’aperçu ne correspond pas à l’étagère privée.".into()); }
        if fs::metadata(&copy).map_err(|_| "Copie d’aperçu indisponible.")?.len() != fs::metadata(&authoritative).map_err(|_| "Document de l’étagère indisponible.")?.len() {
            return Err("Le document a changé pendant sa copie.".into());
        }
        let mut sources = self.shelf_sources.lock().unwrap();
        if !sources.contains_key(&copy) && sources.len() >= CACHE_COUNT {
            if let Some(old) = sources.keys().next().cloned() { sources.remove(&old); }
        }
        sources.insert(copy, ShelfSource { authoritative, copy_identity, authoritative_identity });
        Ok(())
    }

    fn cache_identity(&self, path: &Path, width: u32, height: u32) -> Result<(PathBuf, String, Option<ShelfSource>)> {
        let (path, key) = fingerprint(path, &self.engine, width, height)?;
        let source = self.shelf_sources.lock().unwrap().get(&path).cloned();
        let key = if let Some(source) = source.as_ref() { self.shelf_cache_identity(&path, source, width, height)? } else { key };
        Ok((path, key, source))
    }

    fn shelf_cache_identity(&self, copy: &Path, source: &ShelfSource, width: u32, height: u32) -> Result<String> {
        if metadata_fingerprint(copy, &self.engine, 0, 0)?.1 != source.copy_identity
            || metadata_fingerprint(&source.authoritative, &self.engine, 0, 0)?.1 != source.authoritative_identity
        { return Err("Le document de l’étagère a changé ; ferme puis réessaie.".into()); }
        Ok(metadata_fingerprint(&source.authoritative, &self.engine, width, height)?.1)
    }

    pub async fn snapshot(&self) -> Value {
        let state = self.session.lock().await;
        match state.as_ref() {
            Some(session) => json!({"version":VERSION,"session":session.id,"preview":session.reply,"memoryLimit":PROCESS_MEMORY,"loadTimeoutMs":LOAD_TIMEOUT.as_millis(),"cacheLimit":CACHE_BYTES}),
            None => json!({"version":VERSION,"preview":{"phase":"closed"},"memoryLimit":PROCESS_MEMORY,"loadTimeoutMs":LOAD_TIMEOUT.as_millis(),"cacheLimit":CACHE_BYTES}),
        }
    }

    #[cfg(windows)]
    async fn listen(self: Arc<Self>, mut pipe: tokio::net::windows::named_pipe::NamedPipeServer) {
        loop {
            tokio::select! { _ = self.stopping.cancelled() => break, result = pipe.connect() => if result.is_err() { break; } }
            let Ok(next) = tokio::net::windows::named_pipe::ServerOptions::new().reject_remote_clients(true).create(&self.pipe) else { break; };
            let connected = std::mem::replace(&mut pipe, next);
            let Ok(permit) = self.connections.clone().try_acquire_owned() else { drop(connected); continue; };
            let broker = self.clone(); tokio::spawn(async move {
                let _permit = permit;
                let _ = tokio::time::timeout(Duration::from_secs(3), broker.connection(connected)).await;
            });
        }
    }

    #[cfg(windows)]
    async fn connection(self: Arc<Self>, pipe: tokio::net::windows::named_pipe::NamedPipeServer) -> std::io::Result<()> {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
        let (reader, mut writer) = tokio::io::split(pipe);
        let mut input = BufReader::new(reader.take(REQUEST_BYTES + 1)); let mut bytes = Vec::new();
        input.read_until(b'\n', &mut bytes).await?;
        let response = if bytes.len() as u64 > REQUEST_BYTES || bytes.last() != Some(&b'\n') {
            Reply::error("Requête d’aperçu invalide.")
        } else if let Ok(request) = serde_json::from_slice::<Request>(&bytes) {
            if request.secret != self.secret || !crate::shelf::valid_id(&request.id) { Reply::error("Requête d’aperçu invalide.") }
            else { self.request(request).await }
        } else { Reply::error("Requête d’aperçu invalide.") };
        let mut bytes = serde_json::to_vec(&response).unwrap(); bytes.push(b'\n'); writer.write_all(&bytes).await?;
        writer.shutdown().await
    }

    async fn request(self: &Arc<Self>, request: Request) -> Reply {
        match request.operation.as_str() {
            "status" if request.path.is_none() => {
                let mut session = self.session.lock().await;
                session.as_mut().filter(|session| session.id == request.id).map(|session| {
                    session.last_seen = Instant::now();
                    let mut reply = session.reply.clone(); reply.elapsed_ms = session.started.elapsed().as_millis().min(u64::MAX as u128) as u64; reply
                }).unwrap_or_else(Reply::closed)
            }
            "close" if request.path.is_none() => {
                let mut session = self.session.lock().await;
                {
                    let mut closed = self.closed_ids.lock().unwrap();
                    if closed.len() >= 128 { closed.pop_front(); }
                    closed.push_back(request.id.clone());
                }
                if session.as_ref().is_some_and(|session| session.id == request.id) {
                    if let Some(session) = session.take() { session.cancel.cancel(); }
                }
                Reply::closed()
            }
            "open" => {
                let Some(path) = request.path.filter(|path| !path.chars().any(char::is_control) && path.len() <= 32768) else { return Reply::error("Document invalide."); };
                let (width, height) = (request.width.unwrap_or(900).clamp(320, 1920), request.height.unwrap_or(600).clamp(240, 1080));
                let cancel = self.stopping.child_token();
                let initial = Reply { phase: "loading".into(), ..Reply::closed() };
                {
                    let mut state = self.session.lock().await;
                    // Pipe clients can be scheduled out of order. A completed
                    // Close also revokes an Open not yet accepted by the broker.
                    if self.closed_ids.lock().unwrap().contains(&request.id) { return Reply::closed(); }
                    if let Some(current) = state.as_ref().filter(|session| session.id == request.id) { return current.reply.clone(); }
                    if let Some(previous) = state.take() { previous.cancel.cancel(); }
                    // Reserve before filesystem work: Escape and a newer Open
                    // invalidate this request even while metadata is pending.
                    *state = Some(Session { id: request.id.clone(), reply: initial, cancel: cancel.clone(), started: Instant::now(), last_seen: Instant::now() });
                }
                let broker = self.clone();
                let checked = tokio::task::spawn_blocking(move || broker.cache_identity(Path::new(&path), width, height)).await;
                if cancel.is_cancelled() { return Reply::closed(); }
                let (path, key, shelf_source) = match checked { Ok(Ok(value)) => value, _ => {
                    let error = Reply::error("Ce document est indisponible ou trop volumineux pour l’aperçu. Ouvre-le dans WPS.");
                    self.update(&request.id, |reply| *reply = error.clone()).await;
                    return error;
                } };
                let cache = self.root.join("cache").join(format!("{key}.png"));
                let cache_hit = valid_snapshot(&cache);
                let reply = Reply { phase: "loading".into(), cache_path: cache_hit.then(|| display(&cache)), cache_hit, ..Reply::closed() };
                if cancel.is_cancelled() { return Reply::closed(); }
                self.update(&request.id, |current| *current = reply.clone()).await;
                let broker = self.clone(); tokio::spawn(async move { broker.run_worker(request.id, path, key, shelf_source, width, height, cancel).await; });
                reply
            }
            _ => Reply::error("Requête d’aperçu invalide."),
        }
    }

    async fn update(&self, id: &str, apply: impl FnOnce(&mut Reply)) {
        if let Some(session) = self.session.lock().await.as_mut().filter(|session| session.id == id && !session.cancel.is_cancelled()) { apply(&mut session.reply); }
    }

    #[cfg(windows)]
    async fn run_worker(self: Arc<Self>, id: String, path: PathBuf, key: String, shelf_source: Option<ShelfSource>, width: u32, height: u32, cancel: CancellationToken) {
        // A replacement cannot allocate a second workbook before the previous
        // process has actually exited and released its Job Object.
        let _permit = tokio::select! { _ = cancel.cancelled() => return, permit = self.worker_slot.acquire() => match permit { Ok(permit) => permit, Err(_) => return } };
        let pending = self.root.join("pending").join(format!("{id}.png"));
        let result = self.worker(&id, &path, &key, shelf_source.as_ref(), width, height, &pending, &cancel).await;
        if let Err(message) = result { self.update(&id, |reply| { reply.phase = "error".into(); reply.hwnd = None; reply.error = Some(message); }).await; }
        if plain(&pending).is_ok() { let _ = fs::remove_file(pending); }
    }

    #[cfg(not(windows))]
    async fn run_worker(self: Arc<Self>, id: String, _: PathBuf, _: String, _: Option<ShelfSource>, _: u32, _: u32, _: CancellationToken) {
        self.update(&id, |reply| *reply = Reply::error("Windows est requis.")).await;
    }

    #[cfg(windows)]
    async fn worker(&self, id: &str, path: &Path, key: &str, shelf_source: Option<&ShelfSource>, width: u32, height: u32, pending: &Path, cancel: &CancellationToken) -> Result<()> {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
        plain(&self.worker)?; plain(pending)?;
        if cancel.is_cancelled() { return Ok(()); }
        let loading_deadline = tokio::time::Instant::now() + LOAD_TIMEOUT;
        let source = path.to_path_buf(); let directory = self.root.join("pending"); let copy_cancel = cancel.child_token(); let cancelled = copy_cancel.clone();
        let copying = tokio::task::spawn_blocking(move || detached_copy(&source, &directory, &cancelled));
        let copy = tokio::select! {
            _ = cancel.cancelled() => { copy_cancel.cancel(); return Ok(()); },
            result = tokio::time::timeout_at(loading_deadline, copying) => match result {
                Ok(value) => value.map_err(|_| "La copie d’aperçu a été interrompue.")??,
                Err(_) => { copy_cancel.cancel(); return Err("Le document ne peut pas être préparé dans le délai prévu. Ouvre-le dans WPS.".into()); }
            }
        };
        if cancel.is_cancelled() { return Ok(()); }
        let mut command = tokio::process::Command::new(&self.worker);
        let quicklook_root = self.quicklook.parent().ok_or("Moteur QuickLook indisponible.")?;
        command.args([display(quicklook_root), display(self.office.parent().unwrap()), display(&copy.1), display(pending), width.to_string(), height.to_string()])
            .current_dir(quicklook_root).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true).creation_flags(0x08000000);
        let mut child = command.spawn().map_err(|_| "Le processus d’aperçu n’a pas pu démarrer.")?;
        let _job = match WorkerJob::attach(&child) { Ok(job) => job, Err(error) => { let _ = child.kill().await; let _ = child.wait().await; return Err(error); } };
        let result: Result<()> = async {
        let pid = child.id().ok_or("Processus d’aperçu indisponible.")?;
        self.update(id, |reply| { reply.pid = Some(pid); reply.worker_path = Some(display(&self.worker)); }).await;
        let mut input = child.stdin.take().ok_or("Processus d’aperçu indisponible.")?;
        input.write_all(b"start\n").await.map_err(|_| "Processus d’aperçu indisponible.")?; drop(input);
        let stdout = child.stdout.take().ok_or("Processus d’aperçu indisponible.")?;
        let mut lines = BufReader::new(stdout.take(65536)).lines();
        let stderr = child.stderr.take().ok_or("Processus d’aperçu indisponible.")?;
        // Bound diagnostics and discard file paths/content; exceptions become a
        // stable user-facing error, never a raw stack trace.
        tokio::spawn(async move { let mut input = stderr.take(65536); let mut sink = tokio::io::sink(); let _ = tokio::io::copy(&mut input, &mut sink).await; });
        let deadline = tokio::time::sleep_until(loading_deadline); tokio::pin!(deadline);
        let mut heartbeat = tokio::time::interval(Duration::from_millis(500));
        let mut ready = false;
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break Ok(()),
                _ = &mut deadline, if !ready => break Err("Ce fichier demande trop de ressources. L’aperçu a été arrêté ; tu peux l’ouvrir dans WPS.".into()),
                _ = heartbeat.tick() => {
                    let state = self.session.lock().await;
                    if !state.as_ref().is_some_and(|session| session.id == id && session.last_seen.elapsed() < Duration::from_secs(5)) {
                        break Err("Le lecteur d’aperçu a été fermé. Son traitement a été arrêté.".into());
                    }
                }
                line = lines.next_line() => {
                    let line = match line { Ok(Some(value)) if value.len() <= 8192 => value, _ => break Err("Le moteur n’a pas pu terminer cet aperçu. Tu peux ouvrir le fichier dans WPS.".into()) };
                    let value: Value = match serde_json::from_str(&line) { Ok(value) => value, Err(_) => break Err("Réponse du moteur d’aperçu invalide.".into()) };
                    if value["phase"] == "error" { break Err("Ce document ne peut pas être affiché par le moteur Office. Tu peux l’ouvrir dans WPS.".into()); }
                    if value["phase"] != "ready" || ready { continue; }
                    let Some(hwnd) = value["hwnd"].as_str().filter(|value| value.parse::<usize>().is_ok_and(|number| number != 0)) else { break Err("Fenêtre d’aperçu invalide.".into()); };
                    if !window_owned(hwnd, pid) || !valid_snapshot(pending) { break Err("Le moteur n’a pas produit d’aperçu valide.".into()); }
                    let checked = if let Some(source) = shelf_source { self.shelf_cache_identity(path, source, width, height)? } else { fingerprint(path, &self.engine, width, height)?.1 };
                    if checked != key { break Err("Le fichier a changé pendant le chargement. Ferme puis réessaie.".into()); }
                    let cache = self.root.join("cache").join(format!("{key}.png"));
                    plain(&cache)?;
                    if cache.exists() { fs::remove_file(&cache).map_err(|_| "Le cache ne peut pas être actualisé.")?; }
                    fs::rename(pending, &cache).map_err(|_| "Le cache ne peut pas être enregistré.")?;
                    prune(&self.root.join("cache"), Some(&cache))?;
                    self.update(id, |reply| { reply.phase = "ready".into(); reply.hwnd = Some(hwnd.into()); reply.cache_path = Some(display(&cache)); reply.error = None; }).await;
                    ready = true;
                }
            }
        }
        }.await;
        let _ = child.kill().await; let _ = child.wait().await;
        result
    }
}

fn detached_copy(source: &Path, directory: &Path, cancelled: &CancellationToken) -> Result<(tempfile::TempDir, PathBuf)> {
    use std::io::Write;
    plain(source)?; plain(directory)?;
    let mut input = fs::File::open(source).map_err(|_| "Le document ne peut pas être lu.")?;
    let before = input.metadata().map_err(|_| "Le document ne peut pas être lu.")?;
    if !before.is_file() || before.len() > FILE_BYTES { return Err("Le document dépasse la limite de l’aperçu.".into()); }
    let temporary = tempfile::Builder::new().prefix("office-source-").tempdir_in(directory).map_err(|_| "La copie d’aperçu est indisponible.")?;
    let target = temporary.path().join(source.file_name().ok_or("Nom de fichier indisponible.")?);
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|_| "La copie d’aperçu est indisponible.")?;
    let mut buffer = vec![0u8; 65536]; let mut size = 0u64;
    loop {
        if cancelled.is_cancelled() { return Err("Aperçu annulé.".into()); }
        let read = input.read(&mut buffer).map_err(|_| "Lecture du document interrompue.")?;
        if read == 0 { break; }
        size = size.saturating_add(read as u64);
        if size > FILE_BYTES { return Err("Le document a changé pendant sa copie.".into()); }
        output.write_all(&buffer[..read]).map_err(|_| "La copie d’aperçu ne peut pas être enregistrée.")?;
    }
    drop(output);
    let after = input.metadata().map_err(|_| "Le document ne peut pas être vérifié.")?;
    if size != before.len() || after.len() != before.len() || after.modified().ok() != before.modified().ok() { return Err("Le document a changé pendant sa copie.".into()); }
    #[cfg(windows)] {
        // Keep Internet origin protection without giving the renderer write
        // access to the original (also supports read-only source files).
        let ads = |path: &Path| { let mut value = path.as_os_str().to_os_string(); value.push(":Zone.Identifier"); PathBuf::from(value) };
        match fs::File::open(ads(source)) {
            Ok(input) => {
                let mut bytes = Vec::new(); input.take(65537).read_to_end(&mut bytes).map_err(|_| "La protection d’origine du document ne peut pas être copiée.")?;
                if bytes.len() > 65536 { return Err("La protection d’origine du document est invalide.".into()); }
                fs::write(ads(&target), bytes).map_err(|_| "La protection d’origine du document ne peut pas être conservée.")?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err("La protection d’origine du document ne peut pas être vérifiée.".into()),
        }
    }
    Ok((temporary, target))
}

#[cfg(windows)]
fn window_owned(value: &str, pid: u32) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow};
    let Ok(handle) = value.parse::<usize>() else { return false; };
    let mut actual = 0;
    unsafe { IsWindow(handle as _) != 0 && GetWindowThreadProcessId(handle as _, &mut actual) != 0 && actual == pid }
}

#[cfg(windows)]
struct WorkerJob(usize);
#[cfg(windows)]
impl WorkerJob {
    fn attach(child: &tokio::process::Child) -> Result<Self> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() { return Err("Le rendu Office ne peut pas être isolé.".into()); }
            let job = Self(handle as usize);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            limits.ProcessMemoryLimit = PROCESS_MEMORY; limits.BasicLimitInformation.ActiveProcessLimit = 1;
            let process = child.raw_handle().ok_or("Processus d’aperçu indisponible.")?;
            if SetInformationJobObject(handle, JobObjectExtendedLimitInformation, (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), std::mem::size_of_val(&limits) as u32) == 0 || AssignProcessToJobObject(handle, process) == 0 {
                return Err("Le rendu Office ne peut pas être isolé.".into());
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for WorkerJob { fn drop(&mut self) { unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0 as _); } } }

#[cfg(test)]
mod tests {
    use super::*;
    fn alias_broker(data: &Path) -> Broker {
        Broker { root: data.join(".desktop-profile/office-preview"), worker: PathBuf::new(), quicklook: PathBuf::new(), office: PathBuf::new(), engine: "alias-test".into(), secret: "secret".into(), pipe: "unused".into(), config: data.join("config"), session: Mutex::new(None), stopping: CancellationToken::new(), connections: Arc::new(tokio::sync::Semaphore::new(1)), worker_slot: tokio::sync::Semaphore::new(1), closed_ids: std::sync::Mutex::new(std::collections::VecDeque::new()), shelf_sources: std::sync::Mutex::new(std::collections::BTreeMap::new()) }
    }
    #[test]
    fn shelf_reexports_share_cache_identity_and_changed_backing_or_copy_invalidates_it() {
        let root = tempfile::tempdir().unwrap(); let broker = alias_broker(root.path());
        let shelf = root.path().join(".shelf"); fs::create_dir(&shelf).unwrap();
        let original = shelf.join(crate::shelf::token()); fs::write(&original, b"original workbook").unwrap();
        let copies = root.path().join(".desktop-profile/quicklook-shelf");
        let first = copies.join("session-one/book.xlsx"); let second = copies.join("session-two/book.xlsx");
        for path in [&first, &second] { fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::copy(&original, path).unwrap(); broker.register_shelf_source(path, &original).unwrap(); }
        assert_ne!(fingerprint(&first, &broker.engine, 900, 600).unwrap().1, fingerprint(&second, &broker.engine, 900, 600).unwrap().1);
        let (path, key, source) = broker.cache_identity(&first, 900, 600).unwrap();
        assert_eq!(path, fs::canonicalize(&first).unwrap(), "The renderer must keep reading only the detached copy");
        assert!(source.is_some());
        assert_eq!(key, broker.cache_identity(&second, 900, 600).unwrap().1);
        assert_ne!(key, broker.cache_identity(&second, 800, 600).unwrap().1);
        fs::write(&original, b"updated larger workbook").unwrap();
        assert!(broker.cache_identity(&first, 900, 600).is_err(), "Old copied bytes cannot publish for a changed backing file");
        fs::copy(&original, &second).unwrap(); broker.register_shelf_source(&second, &original).unwrap();
        assert_ne!(key, broker.cache_identity(&second, 900, 600).unwrap().1);
        fs::write(&second, b"renderer replacement").unwrap();
        assert!(broker.cache_identity(&second, 900, 600).is_err());
    }
    #[test]
    fn shelf_aliases_cannot_register_a_foreign_source_or_export_directory() {
        let root = tempfile::tempdir().unwrap(); let broker = alias_broker(root.path());
        let shelf = root.path().join(".shelf"); fs::create_dir(&shelf).unwrap();
        let original = shelf.join(crate::shelf::token()); fs::write(&original, b"book").unwrap();
        let copies = root.path().join(".desktop-profile/quicklook-shelf"); fs::create_dir_all(&copies).unwrap();
        let private = copies.join("book.xlsx"); fs::write(&private, b"book").unwrap();
        let foreign = root.path().join("foreign.xlsx"); fs::write(&foreign, b"book").unwrap();
        assert!(broker.register_shelf_source(&foreign, &original).is_err());
        assert!(broker.register_shelf_source(&private, &foreign).is_err());
        let unowned = shelf.join("manifest.json"); fs::write(&unowned, b"book").unwrap();
        assert!(broker.register_shelf_source(&private, &unowned).is_err());
        assert!(broker.shelf_sources.lock().unwrap().is_empty());
    }
    #[test]
    fn formats_and_requests_are_narrow_and_typed() {
        assert!(supports(Path::new("book.XLSX"))); assert!(supports(Path::new("slides.pptm")));
        for name in ["file.exe", "plugin.qlplugin", "page.html", "image.png", "legacy.ppt"] { assert!(!supports(Path::new(name))); }
        assert!(serde_json::from_value::<Request>(json!({"operation":"open","secret":"s","id":"x","path":"book.xlsx","extra":true})).is_err());
        assert!(serde_json::from_value::<Request>(json!({"operation":"open","secret":"s","id":"x","width":"900"})).is_err());
    }
    #[test]
    fn metadata_changes_and_renderer_viewport_invalidate_cache_without_reading_document() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("book.xlsx"); fs::write(&path, b"first").unwrap();
        let a = fingerprint(&path, "renderer1", 900, 600).unwrap().1;
        assert_eq!(a, fingerprint(&path, "renderer1", 900, 600).unwrap().1);
        assert_ne!(a, fingerprint(&path, "renderer2", 900, 600).unwrap().1);
        assert_ne!(a, fingerprint(&path, "renderer1", 800, 600).unwrap().1);
        fs::write(&path, b"second-longer").unwrap(); assert_ne!(a, fingerprint(&path, "renderer1", 900, 600).unwrap().1);
    }
    #[tokio::test]
    async fn delayed_close_never_cancels_a_newer_session() {
        let root = tempfile::tempdir().unwrap();
        let token = CancellationToken::new();
        let broker = Arc::new(Broker { root: root.path().into(), worker: PathBuf::new(), quicklook: PathBuf::new(), office: PathBuf::new(), engine: "test".into(), secret: "secret".into(), pipe: "unused".into(), config: root.path().join("config"), session: Mutex::new(Some(Session { id: "new".into(), reply: Reply { phase: "loading".into(), ..Reply::closed() }, cancel: token.clone(), started: Instant::now(), last_seen: Instant::now() })), stopping: CancellationToken::new(), connections: Arc::new(tokio::sync::Semaphore::new(1)), worker_slot: tokio::sync::Semaphore::new(1), closed_ids: std::sync::Mutex::new(std::collections::VecDeque::new()), shelf_sources: std::sync::Mutex::new(std::collections::BTreeMap::new()) });
        let request = |operation: &str, id: &str| Request { operation: operation.into(), id: id.into(), secret: "secret".into(), path: None, width: None, height: None };
        broker.request(request("close", "old")).await;
        assert!(!token.is_cancelled());
        assert_eq!(broker.request(request("status", "new")).await.phase, "loading");
        broker.request(request("close", "new")).await;
        assert!(token.is_cancelled());
        assert!(broker.session.lock().await.is_none());
        broker.request(request("close", "late")).await;
        let source = root.path().join("late.xlsx"); fs::write(&source, b"valid source metadata").unwrap();
        let mut late = request("open", "late"); late.path = Some(source.to_string_lossy().into_owned());
        assert_eq!(broker.request(late).await.phase, "closed");
        assert!(broker.session.lock().await.is_none(), "Close arriving before Open must revoke it");
    }
    #[test]
    fn snapshot_limits_reject_invalid_or_enormous_images() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("image.png");
        fs::write(&path, b"not-an-image").unwrap(); assert!(!valid_snapshot(&path));
        let mut png = vec![0u8; 33]; png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n"); png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&u32::MAX.to_be_bytes()); png[20..24].copy_from_slice(&900u32.to_be_bytes());
        fs::write(&path, png).unwrap(); assert!(!valid_snapshot(&path));
    }
    #[test]
    fn detached_document_is_writable_and_never_changes_the_original() {
        let root = tempfile::tempdir().unwrap(); let source = root.path().join("Original.xlsx");
        fs::write(&source, b"original").unwrap();
        let (lease, copy) = detached_copy(&source, root.path(), &CancellationToken::new()).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"original");
        fs::write(&copy, b"renderer edits").unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"original");
        let cancelled = CancellationToken::new(); cancelled.cancel();
        assert!(detached_copy(&source, root.path(), &cancelled).is_err());
        drop(lease); assert!(!copy.exists());
    }
    #[test]
    fn eviction_only_removes_our_named_cache_files() {
        let root = tempfile::tempdir().unwrap(); let unrelated = root.path().join("keep.txt"); fs::write(&unrelated, b"keep").unwrap();
        for i in 0..CACHE_COUNT + 3 { fs::write(root.path().join(format!("{i:064x}.png")), [0]).unwrap(); }
        let keep = root.path().join(format!("{:064x}.png", 0)); prune(root.path(), Some(&keep)).unwrap();
        assert!(keep.exists()); assert_eq!(fs::read(unrelated).unwrap(), b"keep");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), CACHE_COUNT + 1);
    }
}
