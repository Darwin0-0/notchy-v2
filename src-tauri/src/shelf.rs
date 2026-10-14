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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    id: String,
    name: String,
    size: u64,
    added_at: u64,
    #[serde(skip)]
    preview_mime: Option<String>,
}

impl Entry {
    fn record(&self) -> Value {
        json!({"id":self.id,"name":self.name,"size":self.size,"kind":kind(&self.name),
            "addedAt":self.added_at,"thumbnail":self.preview_mime.as_ref().map(|_| format!("/api/shelf/{}?preview=1",self.id))})
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
impl Drop for UploadCleanup {
    fn drop(&mut self) {
        if !self.committed {
            let _ = std::fs::remove_file(&self.temporary);
            let _ = std::fs::remove_file(&self.destination);
        }
    }
}

impl Shelf {
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
        self.add_stream(name, stream, Some(size)).await
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
                return self.add_path(name, path, size).await;
            }
            return Err(storage_error(failure));
        }
        let mut entry = Entry {
            id,
            name: name.to_string(),
            size,
            added_at: now_ms(),
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
}
