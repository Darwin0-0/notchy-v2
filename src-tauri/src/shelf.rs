use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Semaphore},
};

use crate::error::ApiError;

pub const MAX_FILES: usize = 20;
const MAX_PREVIEW_SIZE: u64 = 8 * 1024 * 1024;
#[cfg(windows)]
const RECEIVED_ZONE: &[u8] = b"[ZoneTransfer]\r\nZoneId=3\r\n";
type Result<T> = std::result::Result<T, ApiError>;

pub fn valid_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn valid_name(value: &str) -> bool {
    if value.is_empty()
        || value.len() > 255
        || value.ends_with('.')
        || value.ends_with(' ')
        || value
            .chars()
            .any(|c| c <= '\u{1f}' || c == '\u{7f}' || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let stem = value.split('.').next().unwrap_or("").to_ascii_lowercase();
    !(matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

pub fn extension(name: &str) -> String {
    let ext = name.rsplit_once('.').map(|(_, x)| x).unwrap_or("");
    if ext.len() <= 16 && ext.bytes().all(|b| b.is_ascii_alphanumeric()) {
        ext.to_ascii_lowercase()
    } else {
        String::new()
    }
}

pub fn kind(name: &str) -> &'static str {
    match extension(name).as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "heic" => "image",
        "zip" | "7z" | "rar" | "tar" | "gz" => "archive",
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" => "audio",
        "mp4" | "mov" | "mkv" | "avi" | "webm" => "video",
        "pdf" | "txt" | "md" | "rtf" | "docx" | "xlsx" | "pptx" | "csv" | "json" | "log" => {
            "document"
        }
        _ => "file",
    }
}

pub fn token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn error(status: u16, message: &str) -> ApiError {
    ApiError::new(status, message)
}
fn storage_error(cause: impl std::fmt::Display + std::any::Any) -> ApiError {
    if let Some(io) = (&cause as &dyn std::any::Any).downcast_ref::<std::io::Error>() {
        #[cfg(windows)]
        let disk_full = matches!(io.raw_os_error(), Some(112 | 39));
        #[cfg(not(windows))]
        let disk_full = matches!(io.raw_os_error(), Some(28 | 122));
        if io.kind() == std::io::ErrorKind::StorageFull || disk_full {
            return error(
                507,
                "L’espace disque disponible ne permet pas de conserver ce fichier.",
            );
        }
    }
    error(503, "Le stockage de l’étagère est indisponible.")
}

fn reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn canonical_equal(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .eq_ignore_ascii_case(b.to_string_lossy().trim_start_matches("\\\\?\\"))
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

async fn check_directory(path: &Path, create: bool) -> Result<()> {
    if create {
        fs::create_dir_all(path).await.map_err(storage_error)?;
    }
    let metadata = fs::symlink_metadata(path).await.map_err(storage_error)?;
    let actual = fs::canonicalize(path).await.map_err(storage_error)?;
    if !metadata.is_dir() || reparse(&metadata) || !canonical_equal(&actual, path) {
        return Err(error(503, "Le stockage de l’étagère est indisponible."));
    }
    Ok(())
}

fn preview_type(name: &str, bytes: &[u8]) -> Option<&'static str> {
    match extension(name).as_str() {
        "png" if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) => Some("image/png"),
        "jpg" | "jpeg" if bytes.starts_with(&[255, 216, 255]) => Some("image/jpeg"),
        "webp" if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WEBP"[..]) => {
            Some("image/webp")
        }
        _ => None,
    }
}

#[cfg(windows)]
fn origin_stream(path: &Path) -> PathBuf {
    let mut stream = path.as_os_str().to_os_string();
    stream.push(":Zone.Identifier");
    PathBuf::from(stream)
}

#[cfg(windows)]
async fn origin_is_marked(path: &Path) -> bool {
    let Ok(file) = fs::File::open(origin_stream(path)).await else {
        return false;
    };
    let mut bytes = Vec::new();
    file.take(RECEIVED_ZONE.len() as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .is_ok()
        && bytes == RECEIVED_ZONE
}

#[cfg(not(windows))]
async fn origin_is_marked(_: &Path) -> bool {
    false
}

#[cfg(windows)]
async fn mark_received_origin(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path).await?;
    if !metadata.is_file() || reparse(&metadata) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid received file"));
    }
    if origin_is_marked(path).await {
        return Ok(());
    }
    let mut stream = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(origin_stream(path))
        .await?;
    stream.write_all(RECEIVED_ZONE).await?;
    stream.sync_all().await?;
    drop(stream);
    if !origin_is_marked(path).await {
        return Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "File origin metadata is unavailable"));
    }
    Ok(())
}

#[cfg(not(windows))]
async fn mark_received_origin(_: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "Windows file origin metadata is unavailable"))
}

async fn protect_open_copy(path: &Path, received: bool) -> Result<()> {
    if received {
        mark_received_origin(path).await.map_err(|_| error(
            415,
            "La protection Windows de ce fichier reçu est indisponible. L’ouverture automatique est bloquée ; le fichier reste dans l’étagère.",
        ))?;
    }
    Ok(())
}

fn not_received(received: &bool) -> bool {
    !*received
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    id: String,
    name: String,
    size: u64,
    added_at: u64,
    #[serde(default, skip_serializing_if = "not_received")]
    received: bool,
    #[serde(skip)]
    origin_marked: bool,
    #[serde(skip)]
    preview_mime: Option<String>,
}

impl Entry {
    fn record(&self) -> Value {
        json!({"id":self.id,"name":self.name,"size":self.size,"kind":kind(&self.name),
            "addedAt":self.added_at,"received":self.received,"originProtected":self.received.then_some(self.origin_marked),"thumbnail":self.preview_mime.as_ref().map(|_| format!("/api/shelf/{}?preview=1",self.id))})
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u8,
    revision: u64,
    items: Vec<Entry>,
}

struct State {
    entries: Vec<Entry>,
    revision: u64,
}
impl State {
    fn snapshot(&self) -> Value {
        json!({"items":self.entries.iter().map(Entry::record).collect::<Vec<_>>(),"limit":MAX_FILES,"revision":self.revision})
    }
}

#[derive(Clone)]
pub struct Shelf {
    directory: Arc<PathBuf>,
    state: Arc<Mutex<State>>,
    pending: Arc<Semaphore>,
}

pub struct ShelfFile {
    pub file: fs::File,
    pub item: Value,
    pub mime: String,
    pub path: PathBuf,
}
/// A detached copy kept alive only for the native QuickLook session. A viewer
/// (or its own Open action) must never edit the authoritative Shelf object.
pub struct ShelfPreview {
    pub path: PathBuf,
    directory: PathBuf,
    temporary: Option<tempfile::TempDir>,
    received: bool,
}
impl ShelfPreview {
    pub fn checked_path(&self) -> Result<PathBuf> {
        if self.temporary.is_none() { return Err(error(409, "Cette copie d’aperçu est en cours de fermeture.")); }
        let parent = &self.directory;
        let parent_meta = std::fs::symlink_metadata(parent).map_err(storage_error)?;
        let metadata = std::fs::symlink_metadata(&self.path).map_err(storage_error)?;
        let actual = std::fs::canonicalize(&self.path).map_err(storage_error)?;
        if !parent_meta.is_dir() || reparse(&parent_meta) || !metadata.is_file()
            || reparse(&metadata) || !canonical_equal(&actual, &self.path)
        { return Err(error(409, "La copie de l’aperçu a changé.")); }
        #[cfg(windows)]
        if self.received {
            use std::io::Read;
            let mut bytes = Vec::new();
            let marked = std::fs::File::open(origin_stream(&self.path)).is_ok_and(|file| {
                file.take(RECEIVED_ZONE.len() as u64 + 1).read_to_end(&mut bytes).is_ok()
                    && bytes == RECEIVED_ZONE
            });
            if !marked { return Err(error(415, "La protection Windows de cet aperçu reçu est indisponible.")); }
        }
        Ok(self.path.clone())
    }
    /// Keep this lease after an error and retry later. TempDir::close consumes
    /// its guard even when Windows refuses to delete a file held by a viewer.
    pub fn try_cleanup(&mut self) -> std::io::Result<()> {
        match std::fs::symlink_metadata(&self.directory) {
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => { self.temporary.take(); return Ok(()); }
            Err(cause) => return Err(cause),
            Ok(metadata) => {
                let actual = std::fs::canonicalize(&self.directory)?;
                if !metadata.is_dir() || reparse(&metadata) || !canonical_equal(&actual, &self.directory) {
                    return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "Preview directory changed"));
                }
            }
        }
        if let Some(temporary) = self.temporary.take() { temporary.close() }
        else { std::fs::remove_dir_all(&self.directory) }
    }
}
#[derive(Clone, Debug)]
pub struct SharedFile {
    pub path: PathBuf,
    pub item: Value,
}

struct UploadCleanup {
    temporary: PathBuf,
    destination: PathBuf,
    committed: bool,
}
struct ExportCleanup { path: PathBuf, committed: bool }
impl Drop for ExportCleanup {
    fn drop(&mut self) { if !self.committed {let _ = std::fs::remove_file(&self.path);} }
}
fn export_name(name: &str, attempt: usize) -> String {
    if attempt == 0 { return name.into(); }
    let path = Path::new(name);
    let extension = path.extension().and_then(|part| part.to_str()).filter(|part| part.len() <= 32);
    let (mut stem, ending) = match extension {
        Some(extension) => (path.file_stem().unwrap().to_string_lossy().into_owned(), format!(".{extension}")),
        None => (name.to_owned(), String::new()),
    };
    let suffix = format!(" ({attempt}){ending}");
    while stem.len() + suffix.len() > 255 {stem.pop();}
    format!("{stem}{suffix}")
}
impl Drop for UploadCleanup {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_file(&self.temporary);
            let _ = std::fs::remove_file(&self.destination);
        }
    }
}

impl Shelf {
    pub async fn prepare_preview(&self, id: &str, directory: &Path) -> Result<ShelfPreview> {
        let opened = self.open(id, false).await?;
        let name = opened.item["name"].as_str().filter(|name| valid_name(name))
            .ok_or_else(|| error(400, "Nom de fichier invalide."))?;
        let received = opened.item["received"] == true;
        // QuickLook treats this suffix as a request to install a plugin, rather
        // than a read-only preview. This also covers the hidden .qlplugin name.
        if extension(name) == "qlplugin" {
            return Err(error(415, "Les extensions QuickLook doivent être installées depuis QuickLook."));
        }
        drop(opened);
        check_directory(directory, true).await?;
        let temporary = tempfile::Builder::new().prefix("shelf-preview-").tempdir_in(directory)
            .map_err(storage_error)?;
        // The existing export path validates the owned source handle and marks
        // received bytes before copying, preserving Windows origin protection.
        let path = self.export_copy(id, temporary.path()).await?;
        Ok(ShelfPreview { path, directory: temporary.path().to_path_buf(), temporary: Some(temporary), received })
    }

    /// Stream a user-requested copy into the native download directory without
    /// overwriting an existing file or losing received-file origin metadata.
    pub async fn export_copy(&self, id: &str, directory: &Path) -> Result<PathBuf> {
        let mut opened = self.open(id, false).await?;
        let name = opened.item["name"].as_str().filter(|name| valid_name(name))
            .ok_or_else(|| error(400, "Nom de fichier invalide."))?;
        check_directory(directory, true).await?;
        for attempt in 0..10_000 {
            let target = directory.join(export_name(name, attempt));
            let mut output = match fs::OpenOptions::new().write(true).create_new(true).open(&target).await {
                Ok(file) => file,
                Err(cause) if cause.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(cause) => return Err(storage_error(cause)),
            };
            let mut cleanup = ExportCleanup {path: target.clone(), committed: false};
            // Protect the empty destination before any received bytes become
            // visible in Downloads, then verify the marker again after writing.
            protect_open_copy(&target, opened.item["received"] == true).await?;
            tokio::io::copy(&mut opened.file, &mut output).await.map_err(storage_error)?;
            output.sync_all().await.map_err(storage_error)?;
            drop(output);
            protect_open_copy(&target, opened.item["received"] == true).await?;
            cleanup.committed = true;
            return Ok(target);
        }
        Err(error(409, "Trop de copies portent déjà ce nom dans Téléchargements."))
    }

    pub async fn new(directory: PathBuf) -> anyhow::Result<Self> {
        let directory = if directory.is_absolute() {
            directory
        } else {
            std::env::current_dir()?.join(directory)
        };
        let service = Self {
            directory: Arc::new(directory),
            state: Arc::new(Mutex::new(State {
                entries: Vec::new(),
                revision: 0,
            })),
            pending: Arc::new(Semaphore::new(8)),
        };
        service
            .load()
            .await
            .map_err(|_| anyhow::anyhow!("Le registre de l’étagère est indisponible."))?;
        Ok(service)
    }

    async fn load(&self) -> Result<()> {
        if !self.directory.exists() {
            return Ok(());
        }
        check_directory(&self.directory, false).await?;
        let path = self.directory.join("manifest.json");
        let mut state = self.state.lock().await;
        if path.exists() {
            let meta = fs::symlink_metadata(&path).await.map_err(storage_error)?;
            if !meta.is_file() || reparse(&meta) || meta.len() > 65536 {
                return Err(error(503, "Le registre de l’étagère est indisponible."));
            }
            let bytes = fs::read(&path).await.map_err(storage_error)?;
            let manifest: Manifest = serde_json::from_slice(&bytes)
                .map_err(|_| error(503, "Le registre de l’étagère est indisponible."))?;
            if manifest.version != 1
                || manifest.items.len() > MAX_FILES
                || manifest.revision > 9_007_199_254_740_991
            {
                return Err(error(503, "Le registre de l’étagère est indisponible."));
            }
            let mut ids = std::collections::HashSet::new();
            for entry in &manifest.items {
                if !valid_id(&entry.id)
                    || !valid_name(&entry.name)
                    || entry.added_at > 9_007_199_254_740_991
                    || !ids.insert(&entry.id)
                {
                    return Err(error(503, "Le registre de l’étagère est indisponible."));
                }
            }
            state.entries = manifest.items;
            state.revision = manifest.revision;
        }
        for entry in &mut state.entries {
            let deleted = self.directory.join(format!("{}.deleted", entry.id));
            if deleted.exists() {
                fs::rename(deleted, self.directory.join(&entry.id))
                    .await
                    .map_err(storage_error)?;
            }
            if let Ok(mut opened) = self.open_entry(entry).await {
                entry.origin_marked = entry.received && origin_is_marked(&self.directory.join(&entry.id)).await;
                let mut bytes = [0; 12];
                if let Ok(size) = opened.read(&mut bytes).await {
                    entry.preview_mime = if entry.size <= MAX_PREVIEW_SIZE {
                        preview_type(&entry.name, &bytes[..size]).map(str::to_string)
                    } else {
                        None
                    };
                }
            }
        }
        let mut entries = fs::read_dir(self.directory.as_ref())
            .await
            .map_err(storage_error)?;
        while let Some(entry) = entries.next_entry().await.map_err(storage_error)? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stale_entry = valid_id(&name) && !state.entries.iter().any(|e| e.id == name);
            let stale_part = name
                .strip_suffix(".part")
                .or_else(|| name.strip_suffix(".deleted"))
                .map(valid_id)
                .unwrap_or(false);
            let stale_manifest = name
                .strip_prefix(".manifest-")
                .and_then(|x| x.strip_suffix(".tmp"))
                .map(valid_id)
                .unwrap_or(false);
            if stale_entry || stale_part || stale_manifest {
                let _ = fs::remove_file(entry.path()).await;
            }
        }
        Ok(())
    }

    async fn open_entry(&self, entry: &Entry) -> Result<fs::File> {
        let path = self.directory.join(&entry.id);
        let before = fs::symlink_metadata(&path)
            .await
            .map_err(|_| error(404, "Fichier indisponible."))?;
        if !before.is_file() || reparse(&before) || before.len() != entry.size {
            return Err(error(404, "Fichier indisponible."));
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x00200000);
        }
        let opened = options
            .open(&path)
            .map_err(|_| error(404, "Fichier indisponible."))?;
        let after = opened
            .metadata()
            .map_err(|_| error(404, "Fichier indisponible."))?;
        if !after.is_file() || reparse(&after) || after.len() != entry.size {
            return Err(error(404, "Fichier indisponible."));
        }
        Ok(fs::File::from_std(opened))
    }

    async fn persist(&self, entries: &[Entry], revision: u64) -> Result<()> {
        let temporary = self.directory.join(format!(".manifest-{}.tmp", token()));
        let manifest = Manifest {
            version: 1,
            revision,
            items: entries.to_vec(),
        };
        let bytes = serde_json::to_vec(&manifest).map_err(storage_error)?;
        let outcome = async {
            let mut handle = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .await
                .map_err(storage_error)?;
            handle.write_all(&bytes).await.map_err(storage_error)?;
            handle.sync_all().await.map_err(storage_error)?;
            drop(handle);
            fs::rename(&temporary, self.directory.join("manifest.json"))
                .await
                .map_err(storage_error)
        }
        .await;
        let _ = fs::remove_file(temporary).await;
        outcome
    }

    pub async fn list(&self) -> Result<Value> {
        Ok(self.state.lock().await.snapshot())
    }

    pub async fn add_stream<S, E>(
        &self,
        name: &str,
        source: S,
        declared_size: Option<u64>,
    ) -> Result<Value>
    where
        S: Stream<Item = std::result::Result<Bytes, E>> + Send,
        E: std::fmt::Display + Send,
    {
        self.add_stream_with_origin(name, source, declared_size, false).await
    }

    // Search imports copy the selected bytes and keep conservative origin protection.
    pub async fn add_search_stream<S, E>(&self, name: &str, source: S, size: Option<u64>) -> Result<Value>
    where S: Stream<Item = std::result::Result<Bytes, E>> + Send, E: std::fmt::Display + Send {
        self.add_stream_with_origin(name, source, size, true).await
    }

    async fn add_stream_with_origin<S, E>(
        &self,
        name: &str,
        source: S,
        declared_size: Option<u64>,
        received: bool,
    ) -> Result<Value>
    where
        S: Stream<Item = std::result::Result<Bytes, E>> + Send,
        E: std::fmt::Display + Send,
    {
        if !valid_name(name) {
            return Err(error(400, "Nom de fichier invalide."));
        }
        let _permit = self
            .pending
            .try_acquire()
            .map_err(|_| error(429, "Un ajout est déjà en cours. Réessaie dans un moment."))?;
        let mut state = self.state.lock().await;
        if state.entries.len() >= MAX_FILES {
            return Err(error(409, "L’étagère contient au maximum 20 fichiers."));
        }
        check_directory(&self.directory, true).await?;
        let id = token();
        let mut cleanup = UploadCleanup {
            temporary: self.directory.join(format!("{id}.part")),
            destination: self.directory.join(&id),
            committed: false,
        };
        let mut handle = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&cleanup.temporary)
            .await
            .map_err(storage_error)?;
        let mut source = Box::pin(source);
        let mut size = 0u64;
        let mut head = Vec::with_capacity(12);
        while let Some(chunk) = source.next().await {
            let chunk = chunk.map_err(|_| error(400, "Envoi interrompu."))?;
            size = size.checked_add(chunk.len() as u64).ok_or_else(|| {
                error(400, "La taille reçue ne correspond pas au fichier annoncé.")
            })?;
            if declared_size.is_some_and(|expected| size > expected) {
                return Err(error(
                    400,
                    "La taille reçue ne correspond pas au fichier annoncé.",
                ));
            }
            head.extend_from_slice(&chunk[..chunk.len().min(12 - head.len())]);
            handle.write_all(&chunk).await.map_err(storage_error)?;
        }
        if declared_size.is_some_and(|expected| expected != size) {
            return Err(error(400, "Envoi interrompu."));
        }
        handle.sync_all().await.map_err(storage_error)?;
        drop(handle);
        fs::rename(&cleanup.temporary, &cleanup.destination)
            .await
            .map_err(storage_error)?;
        let entry = Entry {
            id,
            name: name.to_string(),
            size,
            added_at: now_ms(),
            received,
            origin_marked: received && mark_received_origin(&cleanup.destination).await.is_ok(),
            preview_mime: if size <= MAX_PREVIEW_SIZE {
                preview_type(name, &head).map(str::to_string)
            } else {
                None
            },
        };
        let mut next = state.entries.clone();
        next.push(entry.clone());
        let revision = state
            .revision
            .checked_add(1)
            .ok_or_else(|| storage_error("revision"))?;
        self.persist(&next, revision).await?;
        state.entries = next;
        state.revision = revision;
        cleanup.committed = true;
        let mut snapshot = state.snapshot();
        snapshot["ok"] = json!(true);
        snapshot["item"] = entry.record();
        Ok(snapshot)
    }

    pub async fn add_bytes(&self, name: &str, bytes: Vec<u8>) -> Result<Value> {
        let size = bytes.len() as u64;
        self.add_stream(
            name,
            futures_util::stream::once(async { Ok::<_, std::io::Error>(Bytes::from(bytes)) }),
            Some(size),
        )
        .await
    }

    pub async fn add_path(&self, name: &str, path: &Path, size: u64) -> Result<Value> {
        self.add_path_with_origin(name, path, size, false).await
    }

    async fn add_path_with_origin(&self, name: &str, path: &Path, size: u64, received: bool) -> Result<Value> {
        let meta = fs::symlink_metadata(path)
            .await
            .map_err(|_| error(404, "Fichier indisponible."))?;
        if !meta.is_file() || reparse(&meta) || meta.len() != size {
            return Err(error(404, "Fichier indisponible."));
        }
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x00200000);
        }
        let opened = options
            .open(path)
            .map_err(|_| error(404, "Fichier indisponible."))?;
        let after = opened
            .metadata()
            .map_err(|_| error(404, "Fichier indisponible."))?;
        if !after.is_file()
            || reparse(&after)
            || after.len() != meta.len()
            || after.modified().ok() != meta.modified().ok()
        {
            return Err(error(404, "Fichier indisponible."));
        }
        let file = fs::File::from_std(opened);
        let stream = futures_util::stream::try_unfold(file, |mut file| async {
            let mut chunk = vec![0; 64 * 1024];
            let size = file.read(&mut chunk).await?;
            chunk.truncate(size);
            Ok::<_, std::io::Error>(if size == 0 {
                None
            } else {
                Some((Bytes::from(chunk), file))
            })
        });
        self.add_stream_with_origin(name, stream, Some(size), received).await
    }

    // Only LocalSend's verified private staging files use adoption; user files remain copied.
    pub async fn adopt_path(&self, name: &str, path: &Path, size: u64) -> Result<Value> {
        if !valid_name(name) {
            return Err(error(400, "Nom de fichier invalide."));
        }
        let _permit = self
            .pending
            .try_acquire()
            .map_err(|_| error(429, "Un ajout est déjà en cours. Réessaie dans un moment."))?;
        let mut state = self.state.lock().await;
        if state.entries.len() >= MAX_FILES {
            return Err(error(409, "L’étagère contient au maximum 20 fichiers."));
        }
        check_directory(&self.directory, true).await?;
        let source = fs::symlink_metadata(path)
            .await
            .map_err(|_| error(404, "Fichier indisponible."))?;
        if !source.is_file() || reparse(&source) || source.len() != size {
            return Err(error(404, "Fichier indisponible."));
        }
        let id = token();
        let mut cleanup = UploadCleanup {
            temporary: self.directory.join(format!("{id}.part")),
            destination: self.directory.join(&id),
            committed: false,
        };
        if let Err(failure) = fs::hard_link(path, &cleanup.destination).await {
            if failure.kind() == std::io::ErrorKind::CrossesDevices
                || matches!(failure.raw_os_error(), Some(17 | 18))
            {
                drop(state);
                drop(_permit);
                return self.add_path_with_origin(name, path, size, true).await;
            }
            return Err(storage_error(failure));
        }
        let mut entry = Entry {
            id,
            name: name.to_string(),
            size,
            added_at: now_ms(),
            received: true,
            origin_marked: false,
            preview_mime: None,
        };
        let mut opened = self.open_entry(&entry).await?;
        let metadata = opened.metadata().await.map_err(storage_error)?;
        if metadata.modified().ok() != source.modified().ok() {
            return Err(error(404, "Le fichier a changé pendant sa réception."));
        }
        if size <= MAX_PREVIEW_SIZE {
            let mut bytes = [0; 12];
            let count = opened.read(&mut bytes).await.map_err(storage_error)?;
            entry.preview_mime = preview_type(name, &bytes[..count]).map(str::to_string);
        }
        drop(opened);
        // Keep received bytes even on filesystems without ADS; native opening fails closed.
        entry.origin_marked = mark_received_origin(&cleanup.destination).await.is_ok();
        let mut next = state.entries.clone();
        next.push(entry.clone());
        let revision = state
            .revision
            .checked_add(1)
            .ok_or_else(|| storage_error("revision"))?;
        self.persist(&next, revision).await?;
        state.entries = next;
        state.revision = revision;
        cleanup.committed = true;
        let mut snapshot = state.snapshot();
        snapshot["ok"] = json!(true);
        snapshot["item"] = entry.record();
        Ok(snapshot)
    }

    pub async fn remove(&self, id: &str) -> Result<Value> {
        if !valid_id(id) {
            return Err(error(400, "Identifiant invalide."));
        }
        let mut state = self.state.lock().await;
        if !state.entries.iter().any(|entry| entry.id == id) {
            return Err(error(404, "Ce fichier n’est plus dans l’étagère."));
        }
        check_directory(&self.directory, false).await?;
        let original = self.directory.join(id);
        let deleted = self.directory.join(format!("{id}.deleted"));
        let staged = match fs::rename(&original, &deleted).await {
            Ok(()) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(storage_error(e)),
        };
        let next: Vec<_> = state
            .entries
            .iter()
            .filter(|entry| entry.id != id)
            .cloned()
            .collect();
        let revision = state
            .revision
            .checked_add(1)
            .ok_or_else(|| storage_error("revision"))?;
        if let Err(e) = self.persist(&next, revision).await {
            if staged {
                let _ = fs::rename(&deleted, &original).await;
            }
            return Err(e);
        }
        state.entries = next;
        state.revision = revision;
        if staged {
            let _ = fs::remove_file(deleted).await;
        }
        let mut snapshot = state.snapshot();
        snapshot["ok"] = json!(true);
        Ok(snapshot)
    }

    pub async fn open(&self, id: &str, preview: bool) -> Result<ShelfFile> {
        if !valid_id(id) {
            return Err(error(400, "Identifiant invalide."));
        }
        let state = self.state.lock().await;
        let entry = state
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| error(404, "Ce fichier n’est plus dans l’étagère."))?;
        check_directory(&self.directory, false).await?;
        let mut file = self.open_entry(entry).await?;
        let mime = if preview {
            if entry.size > MAX_PREVIEW_SIZE {
                return Err(error(415, "Aperçu indisponible."));
            }
            let mut bytes = [0; 12];
            let size = file
                .read(&mut bytes)
                .await
                .map_err(|_| error(404, "Fichier indisponible."))?;
            use tokio::io::AsyncSeekExt;
            file.rewind()
                .await
                .map_err(|_| error(404, "Fichier indisponible."))?;
            preview_type(&entry.name, &bytes[..size])
                .ok_or_else(|| error(415, "Aperçu indisponible."))?
                .to_string()
        } else {
            "application/octet-stream".to_string()
        };
        Ok(ShelfFile {
            file,
            item: entry.record(),
            mime,
            path: self.directory.join(id),
        })
    }

    pub async fn share_entries(&self, ids: &[String]) -> Result<Vec<SharedFile>> {
        if ids.is_empty()
            || ids.len() > MAX_FILES
            || ids.iter().any(|id| !valid_id(id))
            || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
        {
            return Err(error(400, "Sélection de fichiers invalide."));
        }
        let state = self.state.lock().await;
        check_directory(&self.directory, false).await?;
        let mut selected = Vec::new();
        for id in ids {
            let entry = state
                .entries
                .iter()
                .find(|entry| &entry.id == id)
                .ok_or_else(|| error(404, "Ce fichier n’est plus dans l’étagère."))?;
            let file = self.open_entry(entry).await?;
            let metadata = file
                .metadata()
                .await
                .map_err(|_| error(404, "Fichier indisponible."))?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|x| x.as_millis() as u64);
            selected.push(SharedFile { path: self.directory.join(id), item: json!({"id":entry.id,"name":entry.name,"size":entry.size,"modifiedAt":modified,"kind":kind(&entry.name),"extension":extension(&entry.name)}) });
        }
        Ok(selected)
    }

    pub async fn copy_for_open(&self, id: &str, directory: &Path) -> Result<PathBuf> {
        let mut opened = self.open(id, false).await?;
        let received = opened.item["received"] == true;
        let name = opened.item["name"]
            .as_str()
            .ok_or_else(|| error(400, "Nom de fichier invalide."))?;
        if !valid_name(name) {
            return Err(error(400, "Nom de fichier invalide."));
        }
        check_directory(directory, true).await?;
        let folder = directory.join(id);
        check_directory(&folder, true).await?;
        let target = folder.join(name);
        if let Ok(meta) = fs::symlink_metadata(&target).await {
            if !meta.is_file() || reparse(&meta) {
                return Err(error(503, "La copie est indisponible."));
            }
            protect_open_copy(&target, received).await?;
            return Ok(target);
        }
        let temporary = folder.join(format!("{}.part", token()));
        let mut destination = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(storage_error)?;
        if let Err(e) = tokio::io::copy(&mut opened.file, &mut destination).await {
            drop(destination);
            let _ = fs::remove_file(&temporary).await;
            return Err(storage_error(e));
        }
        destination.sync_all().await.map_err(storage_error)?;
        drop(destination);
        if let Err(e) = fs::hard_link(&temporary, &target).await {
            let _ = fs::remove_file(&temporary).await;
            return Err(storage_error(e));
        }
        let _ = fs::remove_file(temporary).await;
        protect_open_copy(&target, received).await?;
        if !self
            .state
            .lock()
            .await
            .entries
            .iter()
            .any(|entry| entry.id == id)
        {
            return Err(error(404, "Ce fichier n’est plus dans l’étagère."));
        }
        Ok(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn quicklook_uses_a_disposable_detached_copy_and_never_edits_the_shelf_original() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let value = shelf.add_bytes("Résumé original.txt", b"original bytes".to_vec()).await.unwrap();
        let id = value["item"]["id"].as_str().unwrap();
        let snapshot = shelf.list().await.unwrap();
        let prepared = shelf.prepare_preview(id, &temporary.path().join("quicklook")).await.unwrap();
        assert_eq!(prepared.path.file_name().unwrap(), "Résumé original.txt");
        assert_eq!(prepared.checked_path().unwrap(), prepared.path);
        assert_eq!(fs::read(&prepared.path).await.unwrap(), b"original bytes");
        fs::write(&prepared.path, b"edited preview").await.unwrap();
        let mut owner = shelf.open(id, false).await.unwrap();
        let mut bytes = Vec::new(); owner.file.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(bytes, b"original bytes");
        assert_eq!(shelf.list().await.unwrap(), snapshot);
        let second = shelf.prepare_preview(id, &temporary.path().join("quicklook")).await.unwrap();
        assert_ne!(prepared.path, second.path);
        assert_eq!(fs::read(&second.path).await.unwrap(), b"original bytes");
        let old_path = prepared.path.clone(); drop(prepared);
        assert!(!old_path.exists(), "The session lease removes only its own detached preview copy");
        assert!(shelf.open(id, false).await.is_ok());
    }

    #[tokio::test]
    async fn quicklook_refuses_a_cached_snapshot_replaced_by_a_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let value = shelf.add_bytes("notes.txt", b"safe original".to_vec()).await.unwrap();
        let id = value["item"]["id"].as_str().unwrap();
        let prepared = shelf.prepare_preview(id, &temporary.path().join("quicklook")).await.unwrap();
        fs::remove_file(&prepared.path).await.unwrap();fs::create_dir(&prepared.path).await.unwrap();
        assert_eq!(prepared.checked_path().unwrap_err().status, 409);
        assert!(shelf.open(id, false).await.is_ok());
    }

    #[tokio::test]
    async fn quicklook_rejects_plugin_installers_missing_items_and_nonopaque_ids_before_copying() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let directory = temporary.path().join("previews");
        for name in ["plugin.qlplugin", "plugin.QLPLUGIN", ".qlplugin"] {
            let value = shelf.add_bytes(name, b"inert plugin fixture".to_vec()).await.unwrap();
            let id = value["item"]["id"].as_str().unwrap();
            assert_eq!(shelf.prepare_preview(id, &directory).await.err().unwrap().status, 415);
        }
        for id in ["../outside.txt", "C:\\outside.txt", "", &"A".repeat(32)] {
            assert_eq!(shelf.prepare_preview(id, &directory).await.err().unwrap().status, 400);
        }
        assert_eq!(shelf.prepare_preview(&"a".repeat(32), &directory).await.err().unwrap().status, 404);
        assert!(!directory.exists(), "Rejected requests create no preview directory");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn quicklook_received_snapshot_retains_windows_origin_protection() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let source = temporary.path().join("received.txt");
        fs::write(&source, b"inert received preview").await.unwrap();
        let value = shelf.adopt_path("received.txt", &source, 22).await.unwrap();
        let id = value["item"]["id"].as_str().unwrap();
        let prepared = shelf.prepare_preview(id, &temporary.path().join("quicklook")).await.unwrap();
        assert!(origin_is_marked(&prepared.path).await);
        assert!(prepared.checked_path().is_ok());
        assert!(origin_is_marked(&shelf.directory.join(id)).await);
        assert_eq!(fs::read(&prepared.path).await.unwrap(), b"inert received preview");
        fs::remove_file(origin_stream(&prepared.path)).await.unwrap();
        assert_eq!(prepared.checked_path().unwrap_err().status, 415);
        assert!(origin_is_marked(&shelf.directory.join(id)).await);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn quicklook_cleanup_can_retry_a_snapshot_locked_by_an_external_application() {
        use std::os::windows::fs::OpenOptionsExt;
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let value = shelf.add_bytes("locked.txt", b"untouched original".to_vec()).await.unwrap();
        let id = value["item"]["id"].as_str().unwrap();
        let mut prepared = shelf.prepare_preview(id, &temporary.path().join("quicklook")).await.unwrap();
        let external = std::fs::OpenOptions::new().read(true).share_mode(0).open(&prepared.path).unwrap();
        assert!(prepared.try_cleanup().is_err(), "Windows retains the viewer's locked copy");
        assert!(prepared.path.exists());
        drop(external);
        prepared.try_cleanup().unwrap();
        assert!(!prepared.path.exists(), "The retained lease retries the same owned directory successfully");
        let mut owner = shelf.open(id, false).await.unwrap();
        let mut bytes = Vec::new();owner.file.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(bytes, b"untouched original");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn received_files_keep_origin_metadata_through_adoption_copy_and_reload() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("shelf");
        let shelf = Shelf::new(directory.clone()).await.unwrap();
        let source = temporary.path().join("incoming-inert.txt");
        let bytes = b"inert received text";
        fs::write(&source, bytes).await.unwrap();
        for adopt in [true, false] {
            let added = if adopt {
                shelf.adopt_path("received.txt", &source, bytes.len() as u64).await.unwrap()
            } else {
                // The same streaming path is used when adoption crosses volumes.
                shelf.add_path_with_origin("received.txt", &source, bytes.len() as u64, true).await.unwrap()
            };
            let id = added["item"]["id"].as_str().unwrap();
            assert_eq!(added["item"]["received"], true);
            assert_eq!(added["item"]["originProtected"], true);
            let stored = directory.join(id);
            assert_eq!(fs::read(&stored).await.unwrap(), bytes);
            assert_eq!(fs::metadata(&stored).await.unwrap().len(), bytes.len() as u64);
            assert_eq!(fs::read(origin_stream(&stored)).await.unwrap(), RECEIVED_ZONE);
            let opened = shelf.copy_for_open(id, &temporary.path().join("opened")).await.unwrap();
            assert_eq!(fs::read(&opened).await.unwrap(), bytes);
            assert_eq!(fs::read(origin_stream(&opened)).await.unwrap(), RECEIVED_ZONE);
            fs::remove_file(origin_stream(&opened)).await.unwrap();
            let cached = shelf.copy_for_open(id, &temporary.path().join("opened")).await.unwrap();
            assert_eq!(cached, opened);
            assert!(origin_is_marked(&cached).await);
        }
        let reopened = Shelf::new(directory).await.unwrap();
        for item in reopened.list().await.unwrap()["items"].as_array().unwrap() {
            assert_eq!(item["received"], true);
            assert_eq!(item["originProtected"], true);
        }
        let local = shelf.add_bytes("local.txt", b"inert local text".to_vec()).await.unwrap();
        let id = local["item"]["id"].as_str().unwrap();
        assert_eq!(local["item"]["received"], false);
        assert!(local["item"]["originProtected"].is_null());
        assert!(!origin_is_marked(&shelf.directory.join(id)).await);
        let opened = shelf.copy_for_open(id, &temporary.path().join("opened")).await.unwrap();
        assert!(!origin_is_marked(&opened).await);
    }

    #[tokio::test]
    async fn unavailable_origin_protection_blocks_opening_without_creating_a_file() {
        let temporary = tempfile::tempdir().unwrap();
        let missing = temporary.path().join("missing.txt");
        let failure = protect_open_copy(&missing, true).await.unwrap_err();
        assert_eq!(failure.status, 415);
        assert!(!missing.exists());
        protect_open_copy(&missing, false).await.unwrap();
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn unsupported_origin_marking_keeps_received_bytes_without_claiming_protection() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let source = temporary.path().join("incoming-inert.txt");
        let bytes = b"inert received text";
        fs::write(&source, bytes).await.unwrap();
        let added = shelf.adopt_path("received.txt", &source, bytes.len() as u64).await.unwrap();
        let id = added["item"]["id"].as_str().unwrap();
        assert_eq!(added["item"]["received"], true);
        assert_eq!(added["item"]["originProtected"], false);
        let stored = shelf.directory.join(id);
        assert_eq!(fs::read(&stored).await.unwrap(), bytes);
        assert!(!stored.with_file_name(format!("{id}:Zone.Identifier")).exists());
        assert_eq!(shelf.copy_for_open(id, &temporary.path().join("opened")).await.unwrap_err().status, 415);
        assert_eq!(fs::read(&stored).await.unwrap(), bytes);
    }

    #[test]
    fn names_and_ids_are_bounded() {
        for name in [
            "",
            "../photo.png",
            "NUL.txt",
            "com1",
            "photo.png ",
            "a:b",
            "x\0y",
            "a\\b",
        ] {
            assert!(!valid_name(name));
        }
        assert!(valid_name("Été photo.png"));
        assert!(valid_id(&"a".repeat(32)));
        assert!(!valid_id(&"A".repeat(32)));
    }

    #[tokio::test]
    async fn persists_previews_and_removals_with_existing_format() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("shelf");
        let shelf = Shelf::new(directory.clone()).await.unwrap();
        let added = shelf
            .add_bytes(
                "photo.png",
                vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0],
            )
            .await
            .unwrap();
        let id = added["item"]["id"].as_str().unwrap();
        assert_eq!(shelf.open(id, true).await.unwrap().mime, "image/png");
        let reopened = Shelf::new(directory.clone()).await.unwrap();
        assert_eq!(reopened.list().await.unwrap()["revision"], 1);
        reopened.remove(id).await.unwrap();
        assert_eq!(
            Shelf::new(directory).await.unwrap().list().await.unwrap()["items"],
            json!([])
        );
    }

    #[tokio::test]
    async fn interrupted_upload_never_commits() {
        let temp = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temp.path().to_path_buf()).await.unwrap();
        let result = shelf
            .add_stream(
                "a.txt",
                futures_util::stream::iter(vec![
                    Ok(Bytes::from_static(b"abc")),
                    Err(std::io::Error::other("aborted")),
                ]),
                None,
            )
            .await;
        assert!(result.is_err());
        assert_eq!(shelf.list().await.unwrap()["items"], json!([]));
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn declared_sizes_and_capacity_remain_enforced() {
        let temp = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temp.path().to_path_buf()).await.unwrap();
        assert!(shelf
            .add_stream(
                "a",
                futures_util::stream::once(async {
                    Ok::<_, std::io::Error>(Bytes::from_static(b"x"))
                }),
                Some(2)
            )
            .await
            .is_err());
        for n in 0..20 {
            shelf.add_bytes(&format!("{n}.txt"), vec![]).await.unwrap();
        }
        assert!(shelf.add_bytes("extra.txt", vec![]).await.is_err());
        assert!(shelf.share_entries(&["../bad".to_string()]).await.is_err());
    }

    #[tokio::test]
    async fn rollback_recovers_manifest_owned_file() {
        let temp = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temp.path().to_path_buf()).await.unwrap();
        let value = shelf.add_bytes("a.txt", vec![1]).await.unwrap();
        let id = value["item"]["id"].as_str().unwrap();
        fs::rename(
            temp.path().join(id),
            temp.path().join(format!("{id}.deleted")),
        )
        .await
        .unwrap();
        let reopened = Shelf::new(temp.path().to_path_buf()).await.unwrap();
        assert!(reopened.open(id, false).await.is_ok());
    }

    #[tokio::test]
    async fn malformed_manifest_cannot_escape_storage() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("manifest.json"),serde_json::to_vec(&json!({"version":1,"revision":0,"items":[{"id":"../outside","name":"a.txt","size":1,"addedAt":1}]})).unwrap()).await.unwrap();
        assert!(Shelf::new(temp.path().to_path_buf()).await.is_err());
        fs::write(temp.path().join("manifest.json"), vec![b' '; 65537])
            .await
            .unwrap();
        assert!(Shelf::new(temp.path().to_path_buf()).await.is_err());
    }

    #[tokio::test]
    async fn preview_must_match_file_signature() {
        let temp = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temp.path().to_path_buf()).await.unwrap();
        let added = shelf
            .add_bytes("fake.png", b"<html>active</html>".to_vec())
            .await
            .unwrap();
        assert!(added["item"]["thumbnail"].is_null());
        assert!(shelf
            .open(added["item"]["id"].as_str().unwrap(), true)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn large_private_files_adopt_without_artificial_size_quota() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("shelf");
        let source = temp.path().join("incoming-private");
        let size = 128 * 1024 * 1024 + 1;
        std::fs::File::create(&source)
            .unwrap()
            .set_len(size)
            .unwrap();
        let shelf = Shelf::new(directory.clone()).await.unwrap();
        let added = shelf.adopt_path("large.bin", &source, size).await.unwrap();
        assert_eq!(added["item"]["size"], size);
        let id = added["item"]["id"].as_str().unwrap();
        fs::remove_file(&source).await.unwrap();
        assert_eq!(
            shelf
                .open(id, false)
                .await
                .unwrap()
                .file
                .metadata()
                .await
                .unwrap()
                .len(),
            size
        );
        assert_eq!(
            Shelf::new(directory).await.unwrap().list().await.unwrap()["items"][0]["size"],
            size
        );
        shelf.remove(id).await.unwrap();
    }

    #[tokio::test]
    async fn adoption_rolls_back_only_its_link_on_manifest_failure() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("shelf");
        let source = temporary.path().join("incoming-private");
        fs::write(&source, b"keep source").await.unwrap();
        let shelf = Shelf::new(directory.clone()).await.unwrap();
        fs::create_dir_all(directory.join("manifest.json"))
            .await
            .unwrap();
        assert!(shelf.adopt_path("a.txt", &source, 11).await.is_err());
        assert_eq!(fs::read(&source).await.unwrap(), b"keep source");
        assert_eq!(shelf.list().await.unwrap()["items"], json!([]));
        assert_eq!(std::fs::read_dir(directory).unwrap().count(), 1);
    }

    #[test]
    fn disk_full_is_a_physical_error_not_a_file_quota() {
        let failure = storage_error(std::io::Error::new(
            std::io::ErrorKind::StorageFull,
            "disk full",
        ));
        assert_eq!(failure.status, 507);
        assert!(failure.message.contains("disque"));
    }

    #[tokio::test]
    async fn export_streams_exact_bytes_keeps_the_shelf_and_never_overwrites() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let bytes = vec![0x52; 200_000];
        let added = shelf.add_stream("rapport.pdf", futures_util::stream::iter([Ok::<_,std::io::Error>(Bytes::from(bytes.clone()))]), Some(bytes.len() as u64)).await.unwrap();
        let id = added["item"]["id"].as_str().unwrap();
        let directory = temporary.path().join("downloads");
        fs::create_dir(&directory).await.unwrap();
        fs::write(directory.join("rapport.pdf"), b"existing user file").await.unwrap();
        let first = shelf.export_copy(id, &directory).await.unwrap();
        let second = shelf.export_copy(id, &directory).await.unwrap();
        assert_eq!(first.file_name().unwrap(), "rapport (1).pdf");
        assert_eq!(second.file_name().unwrap(), "rapport (2).pdf");
        assert_eq!(fs::read(&first).await.unwrap(), bytes);
        assert_eq!(fs::read(&second).await.unwrap(), bytes);
        assert_eq!(fs::read(directory.join("rapport.pdf")).await.unwrap(), b"existing user file");
        assert_eq!(shelf.list().await.unwrap()["items"].as_array().unwrap().len(), 1);
        assert!(shelf.export_copy("../secret", &directory).await.is_err());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 3);
    }

    #[tokio::test]
    async fn export_rejects_a_file_instead_of_the_download_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let added = shelf.add_stream("notes.txt", futures_util::stream::iter([Ok::<_,std::io::Error>(Bytes::from_static(b"hello"))]), Some(5)).await.unwrap();
        let directory = temporary.path().join("not-a-directory");
        fs::write(&directory,b"keep").await.unwrap();
        assert!(shelf.export_copy(added["item"]["id"].as_str().unwrap(), &directory).await.is_err());
        assert_eq!(fs::read(&directory).await.unwrap(),b"keep");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn exports_of_received_files_preserve_verified_zone_metadata() {
        let temporary = tempfile::tempdir().unwrap();
        let shelf = Shelf::new(temporary.path().join("shelf")).await.unwrap();
        let source = temporary.path().join("received");
        fs::write(&source,b"received content").await.unwrap();
        let added = shelf.adopt_path("received.txt", &source,16).await.unwrap();
        let copy = shelf.export_copy(added["item"]["id"].as_str().unwrap(),&temporary.path().join("downloads")).await.unwrap();
        assert_eq!(fs::read(&copy).await.unwrap(),b"received content");
        assert!(origin_is_marked(&copy).await);
    }

    #[test]
    fn duplicate_export_names_keep_unicode_and_extension_within_windows_bounds() {
        let name = format!("{}.pdf","é".repeat(125));
        assert!(valid_name(&name));
        let renamed = export_name(&name,9999);
        assert!(valid_name(&renamed));
        assert!(renamed.ends_with(" (9999).pdf"));
        assert_eq!(export_name("rapport.pdf",0),"rapport.pdf");
    }
}
