//! Private, filename-only local search. The caller supplies this app instance's data root.
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File, Metadata};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const QUERY_CHAR_LIMIT: usize = 256;
const RESULT_LIMIT: usize = 20;
const WRITE_BATCH: usize = 128;
const EVENT_QUEUE: usize = 128;
const PENDING_LIMIT: usize = 2048;
const RECONCILE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const EXCLUDED: &[&str] = &[
    "appdata",
    "$recycle.bin",
    "system volume information",
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "target",
    "vendor",
    "dist",
    "build",
    ".cache",
    ".codex",
    ".ssh",
    ".aws",
    ".azure",
    ".gnupg",
    ".kube",
    ".config",
    ".local",
    ".npm",
    ".yarn",
    ".venv",
    "venv",
    "__pycache__",
];
// The shelf uses the same document/media policy; active shell formats require Explorer.
const OPENABLE_FORMATS: &str = "pdf epub txt md csv json yaml yml log rtf docx xlsx pptx odt ods odp png jpg jpeg webp gif bmp tif tiff ico avif heic mp3 m4a wav flac ogg aac mp4 webm mkv avi mov zip";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub extension: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    pub files: usize,
    pub indexing: bool,
    pub updated_at: u64,
    pub roots: Vec<String>,
    pub last_error: Option<String>,
}

pub struct SearchService {
    database: PathBuf,
    roots: Vec<PathBuf>,
    private_root: PathBuf,
    status: Mutex<SearchStatus>,
    rescan: Arc<AtomicBool>,
    started: AtomicBool,
    stopped: AtomicBool,
}

#[derive(Debug)]
struct Snapshot {
    path: String,
    name: String,
    kind: String,
    ext: String,
    mtime: i64,
    size: i64,
    identity: String,
}

struct CheckedPath {
    path: PathBuf,
    // Keep the attribute-only handle open through launch; Windows cannot rename/replace it.
    _guard: File,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn modified(metadata: &Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_owned()
}

fn path_key(path: &Path) -> String {
    let text = display_path(path);
    #[cfg(windows)]
    {
        text.replace('/', "\\").to_lowercase()
    }
    #[cfg(not(windows))]
    {
        text
    }
}

fn within(path: &Path, root: &Path) -> bool {
    let path = path_key(path);
    let root = path_key(root);
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|tail| tail.starts_with(std::path::MAIN_SEPARATOR))
}

fn excluded_name(path: &Path) -> bool {
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        EXCLUDED.contains(&name.as_str())
            || name == ".env"
            || name.starts_with(".env.")
            || matches!(
                name.as_str(),
                "credentials" | "credentials.json" | "id_rsa" | "id_ed25519"
            )
    }) || path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "pem" | "key" | "p12" | "pfx" | "kdbx" | "keystore"
            )
        })
}

fn unsafe_metadata(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Reparse points and cloud placeholders must never be followed or hydrated.
        metadata.file_attributes() & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn visible_under_root(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN;
        // Only library descendants are checked: the AppData store may itself be hidden.
        let visible = |path: &Path| {
            fs::symlink_metadata(path).is_ok_and(|metadata| {
                metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN == 0
                    && !unsafe_metadata(&metadata)
            })
        };
        let mut current = root.to_path_buf();
        if !visible(&current) {
            return false;
        }
        for component in path.components().skip(root.components().count()) {
            current.push(component.as_os_str());
            if !visible(&current) {
                return false;
            }
        }
        true
    }
    #[cfg(not(windows))]
    {
        let _ = (path, root);
        true
    }
}

fn local_path(path: &Path) -> bool {
    if !path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
    {
        return false;
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
        let Some(Component::Prefix(prefix)) = path.components().next() else {
            return false;
        };
        let drive = match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => return false,
        };
        let root = [drive as u16, b':' as u16, b'\\' as u16, 0];
        matches!(unsafe { GetDriveTypeW(root.as_ptr()) }, 2 | 3 | 6)
    }
    #[cfg(not(windows))]
    {
        !path.to_string_lossy().starts_with("//")
    }
}

fn checked_ancestors(path: &Path) -> Result<(), String> {
    if !local_path(path) {
        return Err("Only local folders are searchable.".into());
    }
    for ancestor in path.ancestors() {
        let metadata =
            fs::symlink_metadata(ancestor).map_err(|_| "A local search path is unavailable.")?;
        if unsafe_metadata(&metadata) {
            return Err("Linked or offline search paths are unavailable.".into());
        }
    }
    Ok(())
}

fn checked_storage_parent(path: &Path) -> Result<(), String> {
    if !local_path(path) {
        return Err("Search storage must be local.".into());
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if unsafe_metadata(&metadata) => {
                return Err("Linked or offline search storage is unavailable.".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Search storage is unavailable.".into()),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn attribute_handle(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .access_mode(0x80)
        .share_mode(3)
        .custom_flags(0x02000000 | 0x00200000)
        .open(path)
}

#[cfg(not(windows))]
fn attribute_handle(path: &Path) -> std::io::Result<File> {
    File::open(path)
}

#[cfg(windows)]
fn file_identity(file: &File, metadata: &Metadata) -> Result<String, String> {
    use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } == 0 {
        return Err("The search item identity is unavailable.".into());
    }
    if information.dwFileAttributes & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0 {
        return Err("Linked or offline search items are unavailable.".into());
    }
    Ok(format!(
        "{:x}:{:x}:{:x}:{:x}",
        information.dwVolumeSerialNumber,
        information.nFileIndexHigh,
        information.nFileIndexLow,
        metadata.creation_time()
    ))
}

#[cfg(unix)]
fn file_identity(_: &File, metadata: &Metadata) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(not(any(windows, unix)))]
fn file_identity(_: &File, metadata: &Metadata) -> Result<String, String> {
    Ok(format!("{:?}:{}", metadata.created(), metadata.len()))
}

/// User libraries only; never an entire drive, user profile, AppData, or cloud provider.
#[cfg(not(windows))]
pub fn default_roots() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) else {
        return Vec::new();
    };
    let home = PathBuf::from(home);
    [
        "Desktop",
        "Documents",
        "Downloads",
        "Music",
        "Pictures",
        "Videos",
    ]
    .iter()
    .map(|name| home.join(name))
    .filter(|path| path.is_dir())
    .collect()
}

#[cfg(windows)]
pub fn default_roots() -> Vec<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::{
        System::Com::{
            CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
            COINIT_DISABLE_OLE1DDE,
        },
        UI::Shell::{
            FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Music,
            FOLDERID_Pictures, FOLDERID_Videos, SHGetKnownFolderPath,
        },
    };
    std::thread::spawn(|| unsafe {
        if CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        ) < 0
        {
            return Vec::new();
        }
        let mut roots = Vec::new();
        for folder in [
            FOLDERID_Desktop,
            FOLDERID_Documents,
            FOLDERID_Downloads,
            FOLDERID_Music,
            FOLDERID_Pictures,
            FOLDERID_Videos,
        ] {
            let mut pointer = std::ptr::null_mut();
            // DONT_VERIFY obtains the configured path without creating or contacting a remote folder.
            let result = SHGetKnownFolderPath(&folder, 0x4000, std::ptr::null_mut(), &mut pointer);
            if result >= 0 && !pointer.is_null() {
                let mut length = 0;
                while length < 32768 && *pointer.add(length) != 0 {
                    length += 1;
                }
                if length < 32768 {
                    roots.push(PathBuf::from(OsString::from_wide(
                        std::slice::from_raw_parts(pointer, length),
                    )));
                }
            }
            if !pointer.is_null() {
                CoTaskMemFree(pointer.cast());
            }
        }
        CoUninitialize();
        roots
    })
    .join()
    .unwrap_or_default()
}

fn open_database(path: &Path, writable: bool) -> Result<Connection, String> {
    checked_ancestors(path.parent().ok_or("The search index is unavailable.")?)?;
    if path.exists() {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| "The search index is unavailable.")?;
        if unsafe_metadata(&metadata) || !metadata.is_file() {
            return Err("The search index is unavailable.".into());
        }
    }
    let flags = if writable {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    let connection = Connection::open_with_flags(path, flags | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|_| "The search index is unavailable.")?;
    connection
        .busy_timeout(Duration::from_millis(500))
        .map_err(|_| "The search index is busy.")?;
    if writable {
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS entries (
               id TEXT NOT NULL UNIQUE, path TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
               kind TEXT NOT NULL, ext TEXT NOT NULL, mtime INTEGER NOT NULL,
               size INTEGER NOT NULL, identity TEXT NOT NULL,
               launches INTEGER NOT NULL DEFAULT 0, last_open INTEGER NOT NULL DEFAULT 0,
               generation INTEGER NOT NULL);
             CREATE INDEX IF NOT EXISTS search_names ON entries(name COLLATE NOCASE);
             CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
               name, path, content='entries', content_rowid='rowid', tokenize='trigram');
             CREATE TRIGGER IF NOT EXISTS search_insert AFTER INSERT ON entries BEGIN
               INSERT INTO entries_fts(rowid,name,path) VALUES(new.rowid,new.name,new.path); END;
             CREATE TRIGGER IF NOT EXISTS search_delete AFTER DELETE ON entries BEGIN
               INSERT INTO entries_fts(entries_fts,rowid,name,path) VALUES('delete',old.rowid,old.name,old.path); END;
             CREATE TRIGGER IF NOT EXISTS search_update AFTER UPDATE OF name,path ON entries
               WHEN old.name<>new.name OR old.path<>new.path BEGIN
               INSERT INTO entries_fts(entries_fts,rowid,name,path) VALUES('delete',old.rowid,old.name,old.path);
               INSERT INTO entries_fts(rowid,name,path) VALUES(new.rowid,new.name,new.path); END;
             CREATE TABLE IF NOT EXISTS index_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);")
            .map_err(|_| "The local search index could not be prepared.")?;
    }
    Ok(connection)
}

impl SearchService {
    pub fn new(data_root: &Path, requested_roots: Vec<PathBuf>) -> Result<Arc<Self>, String> {
        checked_storage_parent(data_root)?;
        fs::create_dir_all(data_root).map_err(|_| "Search storage is unavailable.")?;
        checked_ancestors(data_root)?;
        let private_root =
            fs::canonicalize(data_root).map_err(|_| "Search storage is unavailable.")?;
        let directory = private_root.join("search");
        if directory.exists() {
            checked_ancestors(&directory)?;
        }
        fs::create_dir_all(&directory).map_err(|_| "Search storage is unavailable.")?;
        checked_ancestors(&directory)?;
        let mut roots: Vec<PathBuf> = Vec::new();
        for root in requested_roots {
            if excluded_name(&root) || checked_ancestors(&root).is_err() || !root.is_dir() {
                continue;
            }
            let Ok(root) = fs::canonicalize(root) else {
                continue;
            };
            if root.parent().is_none() || within(&root, &private_root) {
                continue;
            }
            if roots.iter().any(|existing| within(&root, existing)) {
                continue;
            }
            roots.retain(|existing| !within(existing, &root));
            roots.push(root);
        }
        let database = directory.join("index.sqlite3");
        let connection = open_database(&database, true)?;
        let files = entry_count(&connection)?;
        let updated_at = connection
            .query_row(
                "SELECT value FROM index_state WHERE key='updated_at'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|_| "The search index is unavailable.")?
            .unwrap_or(0)
            .max(0) as u64;
        let service = Arc::new(Self {
            database,
            private_root,
            status: Mutex::new(SearchStatus {
                files,
                indexing: false,
                updated_at,
                roots: roots.iter().map(|path| display_path(path)).collect(),
                last_error: None,
            }),
            roots,
            rescan: Arc::new(AtomicBool::new(false)),
            started: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
        });
        service.prune_untrusted(&connection)?;
        service.refresh_status(&connection, None, false);
        Ok(service)
    }

    fn in_scope(&self, path: &Path) -> bool {
        local_path(path)
            && !excluded_name(path)
            && !within(path, &self.private_root)
            && self.roots.iter().any(|root| {
                within(path, root)
                    && !path
                        .components()
                        .skip(root.components().count())
                        .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
            })
    }

    fn allowed(&self, path: &Path) -> bool {
        self.in_scope(path)
            && self
                .roots
                .iter()
                .find(|root| within(path, root))
                .is_some_and(|root| visible_under_root(path, root))
    }

    fn snapshot(&self, path: &Path) -> Result<Snapshot, String> {
        if !self.allowed(path) {
            return Err("This item is outside the search libraries.".into());
        }
        checked_ancestors(path)?;
        let actual = fs::canonicalize(path).map_err(|_| "The search item no longer exists.")?;
        if path_key(path) != path_key(&actual) || !self.allowed(&actual) {
            return Err("The search item changed location.".into());
        }
        let metadata =
            fs::symlink_metadata(&actual).map_err(|_| "The search item no longer exists.")?;
        if unsafe_metadata(&metadata) || !(metadata.is_file() || metadata.is_dir()) {
            return Err("This search item is unavailable.".into());
        }
        let file =
            attribute_handle(&actual).map_err(|_| "The search item identity is unavailable.")?;
        let identity = file_identity(&file, &metadata)?;
        let name = actual
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty() && !name.chars().any(char::is_control))
            .ok_or("The search item name is unavailable.")?
            .to_owned();
        let ext = actual
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = if metadata.is_dir() { "folder" } else { "file" }.to_owned();
        Ok(Snapshot {
            path: display_path(&actual),
            name,
            kind,
            ext,
            mtime: modified(&metadata),
            size: metadata.len().min(i64::MAX as u64) as i64,
            identity,
        })
    }

    fn prune_untrusted(&self, connection: &Connection) -> Result<(), String> {
        let mut cursor = 0_i64;
        loop {
            let mut statement = connection
                .prepare("SELECT rowid,path FROM entries WHERE rowid>?1 ORDER BY rowid LIMIT ?2")
                .map_err(|_| "The search index is unavailable.")?;
            let batch: Vec<(i64, String)> = statement
                .query_map(params![cursor, WRITE_BATCH as i64], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|_| "The search index is unavailable.")?
                .collect::<rusqlite::Result<_>>()
                .map_err(|_| "The search index is unavailable.")?;
            drop(statement);
            if batch.is_empty() {
                return Ok(());
            }
            let transaction = connection
                .unchecked_transaction()
                .map_err(|_| "The search index is busy.")?;
            for (rowid, path) in batch {
                cursor = rowid;
                if !self.in_scope(Path::new(&path)) {
                    transaction
                        .execute("DELETE FROM entries WHERE rowid=?1", [rowid])
                        .map_err(|_| "The search index is unavailable.")?;
                }
            }
            transaction
                .commit()
                .map_err(|_| "The search index is unavailable.")?;
        }
    }

    pub fn status(&self) -> SearchStatus {
        self.status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn refresh_status(&self, connection: &Connection, error: Option<String>, indexing: bool) {
        let count = entry_count(connection);
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Ok(files) = count {
            status.files = files;
        }
        status.indexing = indexing || self.rescan.load(Ordering::Acquire);
        status.last_error = error.or_else(|| count.err());
    }

    pub fn request_reindex(&self) {
        let mut status = self
            .status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        status.indexing = true;
        self.rescan.store(true, Ordering::Release);
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }

    pub fn start_worker(self: &Arc<Self>) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let weak = Arc::downgrade(self);
        let overflow = self.rescan.clone();
        std::thread::spawn(move || {
            let Some(service) = weak.upgrade() else {
                return;
            };
            let connection = match open_database(&service.database, true) {
                Ok(connection) => connection,
                Err(error) => {
                    service
                        .status
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .last_error = Some(error);
                    return;
                }
            };
            let (sender, receiver) = sync_channel(EVENT_QUEUE);
            let event_service = Arc::downgrade(&service);
            let watcher_result =
                notify::recommended_watcher(move |mut event: notify::Result<Event>| {
                    if let Ok(event) = &mut event {
                        if matches!(event.kind, notify::EventKind::Access(_)) {
                            return;
                        }
                        let Some(service) = event_service.upgrade() else {
                            return;
                        };
                        event.paths.retain(|path| service.in_scope(path));
                        if event.paths.is_empty() && !event.need_rescan() {
                            return;
                        }
                    }
                    if let Err(TrySendError::Full(_)) = sender.try_send(event) {
                        overflow.store(true, Ordering::Release);
                    }
                });
            let mut watcher: Option<RecommendedWatcher> = match watcher_result {
                Ok(watcher) => Some(watcher),
                Err(_) => None,
            };
            let mut watch_error = None;
            if let Some(watcher) = watcher.as_mut() {
                for root in &service.roots {
                    if watcher.watch(root, RecursiveMode::Recursive).is_err() {
                        watch_error = Some("Some libraries cannot be watched; periodic reconciliation remains active.".to_owned());
                    }
                }
            } else {
                watch_error = Some(
                    "Live indexing is unavailable; periodic reconciliation remains active."
                        .to_owned(),
                );
            }
            service.reconcile(&connection, watch_error.clone());
            drop(service);
            let mut last_reconcile = Instant::now();
            let mut pending = HashSet::new();
            loop {
                let event = receiver.recv_timeout(Duration::from_millis(300));
                let Some(service) = weak.upgrade() else {
                    break;
                };
                if service.stopped.load(Ordering::Acquire) {
                    break;
                }
                match event {
                    Ok(Ok(event)) => {
                        if event.need_rescan() {
                            service.request_reindex();
                        }
                        collect_event_paths(&service, event, &mut pending);
                        if pending.len() > PENDING_LIMIT {
                            pending.clear();
                            service.request_reindex();
                        }
                    }
                    Ok(Err(_)) => {
                        service.request_reindex();
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        watch_error = Some(
                            "Live indexing is unavailable; periodic reconciliation remains active."
                                .to_owned(),
                        );
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                }
                for event in receiver.try_iter().take(EVENT_QUEUE) {
                    match event {
                        Ok(event) => {
                            if event.need_rescan() {
                                service.request_reindex();
                            }
                            collect_event_paths(&service, event, &mut pending);
                            if pending.len() > PENDING_LIMIT {
                                pending.clear();
                                service.request_reindex();
                                break;
                            }
                        }
                        Err(_) => service.request_reindex(),
                    }
                }
                if service.rescan.swap(false, Ordering::AcqRel)
                    || last_reconcile.elapsed() >= RECONCILE_INTERVAL
                {
                    pending.clear();
                    service.reconcile(&connection, watch_error.clone());
                    last_reconcile = Instant::now();
                } else if !pending.is_empty() {
                    let paths: Vec<PathBuf> = pending.drain().collect();
                    if let Err(error) = service.apply_changes(&connection, &paths) {
                        service.refresh_status(&connection, Some(error), false);
                        service.request_reindex();
                    } else {
                        service.refresh_status(&connection, watch_error.clone(), false);
                    }
                }
                drop(service);
                // A failed watcher disconnects its channel; do not spin while waiting for the timer.
                if watcher.is_none() {
                    std::thread::sleep(Duration::from_millis(300));
                }
            }
        });
    }

    fn collect_tree(
        &self,
        root: &Path,
        mut insert: impl FnMut(Snapshot) -> Result<(), String>,
    ) -> Result<(), String> {
        let private_root = self.private_root.clone();
        let walker = ignore::WalkBuilder::new(root)
            .hidden(true)
            .follow_links(false)
            .max_depth(Some(64))
            .parents(false)
            .ignore(false)
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .require_git(false)
            .filter_entry(move |entry| {
                !excluded_name(entry.path())
                    && !within(entry.path(), &private_root)
                    && fs::symlink_metadata(entry.path())
                        .is_ok_and(|metadata| !unsafe_metadata(&metadata))
            })
            .build();
        let mut error = None;
        for entry in walker {
            if self.stopped.load(Ordering::Acquire) {
                return Err("Local indexing was stopped.".into());
            }
            match entry {
                Ok(entry) if entry.depth() > 0 => {
                    match self.snapshot(entry.path()) {
                        Ok(snapshot) => insert(snapshot)?,
                        Err(_) => {
                            // A concurrently removed item is normal. Other inaccessible items are not "up to date".
                            if entry.path().exists() {
                                error = Some("Some local items could not be indexed.".to_owned());
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => error = Some("Some local folders could not be indexed.".to_owned()),
            }
        }
        error.map_or(Ok(()), Err)
    }

    fn reconcile(&self, connection: &Connection, watch_error: Option<String>) {
        self.refresh_status(connection, watch_error.clone(), true);
        let generation = now_millis().min(i64::MAX as u64) as i64;
        let result = (|| {
            let mut error = None;
            for root in &self.roots {
                if checked_ancestors(root).is_err() || !root.is_dir() {
                    remove_tree(connection, root)?;
                    error = Some("Some configured local libraries are unavailable.".to_owned());
                    continue;
                }
                let mut batch = Vec::with_capacity(WRITE_BATCH);
                let scan = self.collect_tree(root, |snapshot| {
                    batch.push(snapshot);
                    if batch.len() >= WRITE_BATCH {
                        write_snapshots(connection, &batch, generation)?;
                        batch.clear();
                        self.refresh_status(connection, watch_error.clone(), true);
                    }
                    Ok(())
                });
                write_snapshots(connection, &batch, generation)?;
                match scan {
                    Ok(()) => {
                        let key = display_path(root);
                        let prefix = format!("{}{}", key, std::path::MAIN_SEPARATOR);
                        connection.execute("DELETE FROM entries WHERE generation<>?1 AND (path=?2 COLLATE NOCASE OR substr(path,1,length(?3))=?3 COLLATE NOCASE)",
                            params![generation, key, prefix]).map_err(|_| "The search index could not be reconciled.")?;
                    }
                    Err(problem) => error = Some(problem),
                }
            }
            if let Some(error) = error {
                return Err(error);
            }
            let updated = now_millis();
            connection.execute("INSERT INTO index_state(key,value) VALUES('updated_at',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [updated.min(i64::MAX as u64) as i64]).map_err(|_| "The search index could not be reconciled.")?;
            self.status
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .updated_at = updated;
            Ok(())
        })();
        self.refresh_status(connection, result.err().or(watch_error), false);
    }

    fn apply_changes(&self, connection: &Connection, paths: &[PathBuf]) -> Result<(), String> {
        let generation = now_millis().min(i64::MAX as u64) as i64;
        for path in paths {
            if !self.in_scope(path) {
                continue;
            }
            if !path.exists() {
                remove_tree(connection, path)?;
            } else if let Ok(snapshot) = self.snapshot(path) {
                let directory = snapshot.kind == "folder";
                write_snapshots(connection, &[snapshot], generation)?;
                if directory {
                    let mut batch = Vec::with_capacity(WRITE_BATCH);
                    self.collect_tree(path, |snapshot| {
                        batch.push(snapshot);
                        if batch.len() >= WRITE_BATCH {
                            write_snapshots(connection, &batch, generation)?;
                            batch.clear();
                        }
                        Ok(())
                    })?;
                    write_snapshots(connection, &batch, generation)?;
                }
            } else {
                // A normal file replaced by a link/offline placeholder must leave the index too.
                remove_tree(connection, path)?;
            }
        }
        let updated = now_millis();
        connection.execute("INSERT INTO index_state(key,value) VALUES('updated_at',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [updated.min(i64::MAX as u64) as i64]).map_err(|_| "The search index could not be updated.")?;
        self.status
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .updated_at = updated;
        Ok(())
    }

    pub fn query(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let query = query.trim();
        if query.chars().count() > QUERY_CHAR_LIMIT
            || query.len() > QUERY_CHAR_LIMIT * 4
            || query.chars().any(char::is_control)
        {
            return Err("The search query is invalid.".into());
        }
        if query.chars().count() < 2 {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, RESULT_LIMIT);
        let connection = open_database(&self.database, false)?;
        let prefix = format!("{}%", escape_like(query));
        let candidates = if query.chars().count() < 3 {
            let mut statement = connection.prepare(
                "SELECT id,name,path,kind,ext FROM entries WHERE name LIKE ?1 ESCAPE '\\'
                 ORDER BY name LIKE ?2 ESCAPE '\\' DESC,launches DESC,last_open DESC,name COLLATE NOCASE LIMIT ?3")
                .map_err(|_| "The local search is unavailable.")?;
            let pattern = format!("%{}%", escape_like(query));
            read_hits(&mut statement, params![pattern, prefix, (limit * 4) as i64])?
        } else {
            let phrase = format!("\"{}\"", query.replace('"', "\"\""));
            let mut statement = connection.prepare(
                "SELECT e.id,e.name,e.path,e.kind,e.ext FROM entries_fts JOIN entries e ON e.rowid=entries_fts.rowid
                 WHERE entries_fts MATCH ?1
                 ORDER BY e.name LIKE ?2 ESCAPE '\\' DESC,
                   instr(lower(e.name),lower(?3))>0 DESC, e.launches DESC,e.last_open DESC,
                   bm25(entries_fts,10.0,1.0),e.name COLLATE NOCASE LIMIT ?4")
                .map_err(|_| "The local search is unavailable.")?;
            read_hits(
                &mut statement,
                params![phrase, prefix, query, (limit * 4) as i64],
            )?
        };
        Ok(candidates
            .into_iter()
            .filter(|hit| self.allowed(Path::new(&hit.path)))
            .take(limit)
            .map(|mut hit| {
                hit.path = display_path(Path::new(&hit.path));
                hit
            })
            .collect())
    }

    fn checked_item(&self, id: &str) -> Result<CheckedPath, String> {
        if !crate::shelf::valid_id(id) {
            return Err("The search result is invalid.".into());
        }
        let connection = open_database(&self.database, false)?;
        let row: Option<(String, String, i64, i64)> = connection
            .query_row(
                "SELECT path,identity,mtime,size FROM entries WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| "The search index is unavailable.")?;
        let Some((path, identity, mtime, size)) = row else {
            return Err("This search result is no longer available.".into());
        };
        let path = PathBuf::from(path);
        let snapshot = self.snapshot(&path)?;
        let directory = snapshot.kind == "folder";
        if snapshot.identity != identity
            || !directory && (snapshot.mtime != mtime || snapshot.size != size)
        {
            self.request_reindex();
            return Err("This item changed. Refresh the search and try again.".into());
        }
        let guard = attribute_handle(&path).map_err(|_| "The search item is unavailable.")?;
        let metadata = guard
            .metadata()
            .map_err(|_| "The search item is unavailable.")?;
        if file_identity(&guard, &metadata)? != identity
            || metadata.is_dir() != directory
            || !directory && (modified(&metadata) != mtime || metadata.len() != size as u64)
        {
            return Err("The search item changed before it could be opened.".into());
        }
        checked_ancestors(&path)?;
        if fs::canonicalize(&path)
            .map(|actual| path_key(&actual) != path_key(&path))
            .unwrap_or(true)
        {
            return Err("The search item changed location.".into());
        }
        Ok(CheckedPath {
            path,
            _guard: guard,
        })
    }

    /// The shelf receives an identity-checked handle, never a path to reopen later.
    pub fn share_source(&self, id: &str) -> Result<(String, File, u64), String> {
        let checked = self.checked_item(id)?;
        let before = checked
            ._guard
            .metadata()
            .map_err(|_| "The search item is unavailable.")?;
        if !before.is_file() || unsafe_metadata(&before) {
            return Err("Only local files can be added to the shelf.".into());
        }
        #[cfg(windows)]
        let reader = {
            use std::os::windows::fs::OpenOptionsExt;
            // The copy cannot race with source deletion or writing; never follow a replacement link.
            fs::OpenOptions::new()
                .read(true)
                .share_mode(1)
                .custom_flags(0x00200000)
                .open(&checked.path)
        };
        #[cfg(not(windows))]
        let reader = File::open(&checked.path);
        let reader = reader.map_err(|_| "The local file is currently unavailable.")?;
        let after = reader
            .metadata()
            .map_err(|_| "The local file is currently unavailable.")?;
        if !after.is_file()
            || unsafe_metadata(&after)
            || file_identity(&reader, &after)? != file_identity(&checked._guard, &before)?
            || modified(&after) != modified(&before)
            || after.len() != before.len()
        {
            return Err("The local file changed before it could be copied.".into());
        }
        checked_ancestors(&checked.path)?;
        let name = checked
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("The local filename is unavailable.")?
            .to_owned();
        Ok((name, reader, after.len()))
    }

    pub fn open(&self, id: &str) -> Result<(), String> {
        let checked = self.checked_item(id)?;
        let metadata = checked
            ._guard
            .metadata()
            .map_err(|_| "The search item is unavailable.")?;
        if !metadata.is_dir() && !openable_format(&checked.path) {
            return Err("Reveal this format in Explorer to open it deliberately.".into());
        }
        launch(&checked.path, false)?;
        let remembered = open_database(&self.database, true).and_then(|connection| {
            connection
                .execute(
                    "UPDATE entries SET launches=launches+1,last_open=?1 WHERE id=?2",
                    params![now_millis().min(i64::MAX as u64) as i64, id],
                )
                .map(|_| ())
                .map_err(|_| "The search history could not be saved.".to_owned())
        });
        if let Err(error) = remembered {
            self.status
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .last_error = Some(error);
        }
        Ok(())
    }

    pub fn reveal(&self, id: &str) -> Result<(), String> {
        let checked = self.checked_item(id)?;
        launch(&checked.path, true)
    }

    pub fn preview(&self, id: &str) -> Result<(), String> {
        self.preview_with(id, crate::quicklook::preview)
    }

    fn preview_with(&self, id: &str, launch: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
        let checked = self.checked_item(id)?;
        if checked.path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| extension.eq_ignore_ascii_case("qlplugin")) {
            return Err("QuickLook plugins must be installed deliberately from QuickLook.".into());
        }
        // QuickLook is a viewer, not the item's default handler. Never ShellExecute the result.
        launch(Path::new(&display_path(&checked.path)))
    }
}

fn openable_format(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            OPENABLE_FORMATS
                .split_whitespace()
                .any(|format| format.eq_ignore_ascii_case(extension))
        })
}

fn collect_event_paths(service: &SearchService, event: Event, pending: &mut HashSet<PathBuf>) {
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return;
    }
    for path in event.paths {
        if service.in_scope(&path) {
            pending.insert(path);
        }
    }
}

fn entry_count(connection: &Connection) -> Result<usize, String> {
    connection
        .query_row("SELECT count(*) FROM entries", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|count| count.max(0) as usize)
        .map_err(|_| "The search index is unavailable.".into())
}

fn write_snapshots(
    connection: &Connection,
    snapshots: &[Snapshot],
    generation: i64,
) -> Result<(), String> {
    if snapshots.is_empty() {
        return Ok(());
    }
    let transaction = connection
        .unchecked_transaction()
        .map_err(|_| "The search index is busy.")?;
    for item in snapshots {
        transaction.execute(
            "INSERT INTO entries(id,path,name,kind,ext,mtime,size,identity,generation) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(path) DO UPDATE SET path=excluded.path,name=excluded.name,kind=excluded.kind,ext=excluded.ext,
               mtime=excluded.mtime,size=excluded.size,identity=excluded.identity,generation=excluded.generation,
               id=CASE WHEN entries.identity=excluded.identity THEN entries.id ELSE excluded.id END,
               launches=CASE WHEN entries.identity=excluded.identity THEN entries.launches ELSE 0 END,
               last_open=CASE WHEN entries.identity=excluded.identity THEN entries.last_open ELSE 0 END",
            params![uuid::Uuid::new_v4().simple().to_string(), item.path, item.name, item.kind, item.ext,
                item.mtime, item.size, item.identity, generation])
            .map_err(|_| "A search index update could not be saved.")?;
    }
    transaction
        .commit()
        .map_err(|_| "A search index update could not be saved.".into())
}

fn remove_tree(connection: &Connection, path: &Path) -> Result<(), String> {
    let key = display_path(path);
    let prefix = format!("{}{}", key, std::path::MAIN_SEPARATOR);
    connection
        .execute(
        "DELETE FROM entries WHERE path=?1 COLLATE NOCASE OR substr(path,1,length(?2))=?2 COLLATE NOCASE",
            params![key, prefix],
        )
        .map(|_| ())
        .map_err(|_| "A removed search item could not be reconciled.".into())
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn read_hits<P: rusqlite::Params>(
    statement: &mut rusqlite::Statement<'_>,
    parameters: P,
) -> Result<Vec<SearchHit>, String> {
    statement
        .query_map(parameters, |row| {
            Ok(SearchHit {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                kind: row.get(3)?,
                extension: row.get(4)?,
            })
        })
        .map_err(|_| "The local search is unavailable.")?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| "The local search is unavailable.".into())
}

#[cfg(windows)]
fn launch(path: &Path, reveal: bool) -> Result<(), String> {
    use windows_sys::Win32::{
        System::Com::{
            CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
            COINIT_DISABLE_OLE1DDE,
        },
        UI::{
            Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName, ShellExecuteW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    };
    let wide: Vec<u16> = display_path(path).encode_utf16().chain(Some(0)).collect();
    std::thread::scope(|scope| {
        scope
            .spawn(move || unsafe {
                if CoInitializeEx(
                    std::ptr::null(),
                    (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
                ) < 0
                {
                    return Err("Explorer is unavailable.".into());
                }
                let result = if reveal {
                    let mut item = std::ptr::null_mut();
                    let parsed = SHParseDisplayName(
                        wide.as_ptr(),
                        std::ptr::null_mut(),
                        &mut item,
                        0,
                        std::ptr::null_mut(),
                    );
                    if parsed < 0 || item.is_null() {
                        Err("This item cannot be revealed in Explorer.".into())
                    } else {
                        let opened = SHOpenFolderAndSelectItems(item, 0, std::ptr::null(), 0);
                        CoTaskMemFree(item.cast());
                        if opened >= 0 {
                            Ok(())
                        } else {
                            Err("This item cannot be revealed in Explorer.".into())
                        }
                    }
                } else {
                    let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
                    let opened = ShellExecuteW(
                        std::ptr::null_mut(),
                        operation.as_ptr(),
                        wide.as_ptr(),
                        std::ptr::null(),
                        std::ptr::null(),
                        SW_SHOWNORMAL,
                    ) as isize;
                    if opened > 32 {
                        Ok(())
                    } else {
                        Err("No application could open this item.".into())
                    }
                };
                CoUninitialize();
                result
            })
            .join()
            .unwrap_or_else(|_| Err("Explorer is unavailable.".into()))
    })
}

#[cfg(not(windows))]
fn launch(_: &Path, _: bool) -> Result<(), String> {
    Err("Opening local search results requires Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        _directory: tempfile::TempDir,
        root: PathBuf,
        service: Arc<SearchService>,
    }
    impl Fixture {
        fn new() -> Self {
            // Windows' normal temp directory is inside excluded AppData, so keep fixtures local to this checkout.
            let directory = tempfile::tempdir_in(std::env::current_dir().unwrap()).unwrap();
            let root = directory.path().join("Documents");
            fs::create_dir(&root).unwrap();
            let service =
                SearchService::new(&directory.path().join("profile"), vec![root.clone()]).unwrap();
            Self {
                _directory: directory,
                root,
                service,
            }
        }
        fn index(&self) {
            let connection = open_database(&self.service.database, true).unwrap();
            self.service.reconcile(&connection, None);
            assert!(
                self.service.status().last_error.is_none(),
                "{:?}",
                self.service.status()
            );
        }
        fn file(&self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"fixture content is never indexed").unwrap();
            path
        }
    }

    #[test]
    fn substring_queries_are_literal_bounded_and_never_index_contents() {
        let fixture = Fixture::new();
        fixture.file("rapport.pdf");
        fixture.file("100%_final.txt");
        for index in 0..28 {
            fixture.file(&format!("rapport-{index}.txt"));
        }
        fixture.index();
        assert_eq!(fixture.service.query("port", 8).unwrap().len(), 8);
        assert_eq!(
            fixture.service.query("rapport", usize::MAX).unwrap().len(),
            RESULT_LIMIT
        );
        assert_eq!(fixture.service.query("%_", 8).unwrap().len(), 1);
        assert!(fixture
            .service
            .query("fixture content", 8)
            .unwrap()
            .is_empty());
        assert!(fixture.service.query("x\" OR *", 8).unwrap().is_empty());
        assert!(fixture.service.query("x", 8).unwrap().is_empty());
        assert!(fixture
            .service
            .query(&"x".repeat(QUERY_CHAR_LIMIT + 1), 8)
            .is_err());
        assert!(fixture.service.query("hello\nworld", 8).is_err());
    }

    #[test]
    fn refresh_preserves_ids_and_popularity_but_removes_stale_files() {
        let fixture = Fixture::new();
        let path = fixture.file("rapport.pdf");
        fixture.index();
        let hit = fixture.service.query("rapport", 8).unwrap().remove(0);
        let connection = open_database(&fixture.service.database, true).unwrap();
        connection
            .execute(
                "UPDATE entries SET launches=9,last_open=42 WHERE id=?1",
                [&hit.id],
            )
            .unwrap();
        fs::write(&path, b"the same local file has newer contents").unwrap();
        std::thread::sleep(Duration::from_millis(2));
        fixture.index();
        assert_eq!(fixture.service.query("rapport", 8).unwrap()[0].id, hit.id);
        assert_eq!(
            connection
                .query_row(
                    "SELECT launches FROM entries WHERE id=?1",
                    [&hit.id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            9
        );
        fs::remove_file(path).unwrap();
        std::thread::sleep(Duration::from_millis(2));
        fixture.index();
        assert!(fixture.service.query("rapport", 8).unwrap().is_empty());
        assert_eq!(fixture.service.status().files, 0);
    }

    #[test]
    fn changed_identity_invalidates_opaque_actions_and_resets_popularity() {
        let fixture = Fixture::new();
        let path = fixture.file("rapport.pdf");
        fixture.index();
        let hit = fixture.service.query("rapport", 8).unwrap().remove(0);
        assert!(fixture.service.checked_item(&hit.id).is_ok());
        assert!(fixture
            .service
            .checked_item(&path.to_string_lossy())
            .is_err());
        assert!(fixture.service.checked_item(&"a".repeat(32)).is_err());
        fs::rename(&path, fixture.root.join("old.pdf")).unwrap();
        fs::write(&path, b"replacement").unwrap();
        assert!(fixture.service.checked_item(&hit.id).is_err());
        fixture.index();
        assert_ne!(fixture.service.query("rapport", 8).unwrap()[0].id, hit.id);
    }

    #[test]
    fn rename_and_delete_reconcile_all_folder_descendants_without_like_wildcards() {
        let fixture = Fixture::new();
        fixture.file("folder%_/rapport.pdf");
        fixture.file("folderABC/sibling.txt");
        fixture.index();
        let original = fixture.root.join("folder%_");
        let renamed = fixture.root.join("renamed");
        fs::rename(&original, &renamed).unwrap();
        let connection = open_database(&fixture.service.database, true).unwrap();
        fixture
            .service
            .apply_changes(&connection, &[original, renamed.clone()])
            .unwrap();
        assert!(fixture.service.query("folder%_", 8).unwrap().is_empty());
        assert_eq!(fixture.service.query("rapport", 8).unwrap().len(), 1);
        fs::remove_dir_all(&renamed).unwrap();
        fixture
            .service
            .apply_changes(&connection, &[renamed])
            .unwrap();
        assert!(fixture.service.query("rapport", 8).unwrap().is_empty());
        assert_eq!(fixture.service.query("sibling", 8).unwrap().len(), 1);
    }

    #[test]
    fn sensitive_paths_private_storage_and_nested_roots_are_excluded() {
        let fixture = Fixture::new();
        fixture.file("public/notes.txt");
        fixture.file("node_modules/private.js");
        fixture.file(".ssh/secret.txt");
        fixture.file(".codex/token.txt");
        fixture.file("public/.private/hidden-secret.txt");
        fixture.file("AppData/private.txt");
        fixture.file("keys/private.pem");
        fixture.file(".env");
        fixture.index();
        assert_eq!(fixture.service.query("notes", 8).unwrap().len(), 1);
        for query in ["private", "secret", "token", ".env"] {
            assert!(fixture.service.query(query, 20).unwrap().is_empty());
        }
        assert!(!fixture
            .service
            .allowed(&fixture.service.private_root.join("token.txt")));
        assert!(!fixture
            .service
            .allowed(&fixture.root.join("../outside.txt")));
        assert!(!fixture
            .service
            .allowed(&fixture.root.join("public/.private/new-secret.txt")));
        let service = SearchService::new(
            &fixture._directory.path().join("second-profile"),
            vec![fixture.root.join("public"), fixture.root.clone()],
        )
        .unwrap();
        assert_eq!(service.roots.len(), 1);
    }

    #[test]
    fn stored_status_survives_restart_and_has_actual_completed_timestamp() {
        let fixture = Fixture::new();
        fixture.file("rapport.pdf");
        assert_eq!(fixture.service.status().updated_at, 0);
        fixture.index();
        let status = fixture.service.status();
        assert!(status.updated_at > 0);
        assert_eq!(status.files, 1);
        assert!(!status.indexing);
        std::thread::sleep(Duration::from_millis(2));
        assert_eq!(fixture.service.status().updated_at, status.updated_at);
        let restarted =
            SearchService::new(&fixture.service.private_root, vec![fixture.root.clone()]).unwrap();
        assert_eq!(restarted.status().updated_at, status.updated_at);
        assert_eq!(restarted.status().files, 1);
    }

    #[test]
    fn queued_reindex_is_visible_immediately_and_survives_an_incremental_status_refresh() {
        let fixture = Fixture::new();
        fixture.file("queued-report.pdf");
        fixture.index();
        let before = fixture.service.status();
        let connection = open_database(&fixture.service.database, true).unwrap();
        fixture.service.request_reindex();
        let queued = fixture.service.status();
        assert!(queued.indexing);
        assert!(fixture.service.rescan.load(Ordering::Acquire));
        assert_eq!(queued.files, before.files);
        assert_eq!(queued.updated_at, before.updated_at);
        fixture.service.refresh_status(&connection, None, false);
        assert!(fixture.service.status().indexing);
        assert!(fixture.service.rescan.swap(false, Ordering::AcqRel));
        fixture.service.reconcile(&connection, None);
        assert!(!fixture.service.status().indexing);
    }

    #[test]
    fn unavailable_library_clears_stale_results_and_reports_incomplete_reconciliation() {
        let fixture = Fixture::new();
        fixture.file("rapport.pdf");
        fixture.index();
        let completed = fixture.service.status().updated_at;
        fs::remove_dir_all(&fixture.root).unwrap();
        let connection = open_database(&fixture.service.database, true).unwrap();
        fixture.service.reconcile(&connection, None);
        assert!(fixture.service.query("rapport", 8).unwrap().is_empty());
        let status = fixture.service.status();
        assert_eq!(status.files, 0);
        assert_eq!(status.updated_at, completed);
        assert!(status.last_error.is_some());
        assert!(!status.indexing);
    }

    #[test]
    fn excluded_roots_are_not_registered_and_executables_do_not_launch() {
        let fixture = Fixture::new();
        fixture.file("dangerous.cmd");
        fixture.index();
        let hit = fixture.service.query("dangerous", 8).unwrap().remove(0);
        assert!(fixture
            .service
            .open(&hit.id)
            .unwrap_err()
            .contains("Explorer"));
        let private = fixture.root.join("AppData");
        fs::create_dir_all(&private).unwrap();
        let service =
            SearchService::new(&fixture._directory.path().join("isolated"), vec![private]).unwrap();
        assert!(service.roots.is_empty());
    }

    #[test]
    fn only_documents_and_media_open_directly_not_active_or_unknown_shell_formats() {
        for name in [
            "report.PDF",
            "notes.txt",
            "cover.png",
            "music.flac",
            "video.mp4",
        ] {
            assert!(openable_format(Path::new(name)));
        }
        for name in [
            "program.exe",
            "script.py",
            "sandbox.wsb",
            "remote.library-ms",
            "remote.search-ms",
            "link.url",
            "unknown.custom",
            "no-extension",
        ] {
            assert!(!openable_format(Path::new(name)));
        }
    }

    #[test]
    fn previews_recheck_files_and_folders_and_never_launch_missing_changed_or_plugin_items() {
        let fixture = Fixture::new();
        let file = fixture.file("reports/résumé & draft.pdf");
        fixture.file("viewer.QLPLUGIN");
        fixture.index();
        let file_hit = fixture.service.query("résumé", 8).unwrap().remove(0);
        let folder_hit = fixture.service.query("reports", 8).unwrap().into_iter().find(|hit| hit.kind == "folder").unwrap();
        for (id, expected) in [(&file_hit.id, &file), (&folder_hit.id, &fixture.root.join("reports"))] {
            fixture.service.preview_with(id, |path| {
                assert_eq!(path_key(path), path_key(expected)); Ok(())
            }).unwrap();
        }
        let never = |_: &Path| -> Result<(), String> { panic!("An invalid preview reached the viewer") };
        let plugin = fixture.service.query("QLPLUGIN", 8).unwrap().remove(0);
        assert!(fixture.service.preview_with(&plugin.id, never).is_err());
        assert!(fixture.service.preview_with("not-an-indexed-id", never).is_err());
        fs::write(&file, b"different contents and length").unwrap();
        assert!(fixture.service.preview_with(&file_hit.id, never).is_err());
        fs::remove_file(file).unwrap();
        assert!(fixture.service.preview_with(&file_hit.id, never).is_err());
    }

    #[test]
    fn sharing_returns_a_verified_file_handle_and_rejects_folders() {
        use std::io::Read;
        let fixture = Fixture::new();
        fixture.file("reports/rapport.pdf");
        fixture.index();
        let hit = fixture.service.query("rapport", 8).unwrap().remove(0);
        let (name, mut reader, size) = fixture.service.share_source(&hit.id).unwrap();
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).unwrap();
        assert_eq!(name, "rapport.pdf");
        assert_eq!(size, bytes.len() as u64);
        assert_eq!(bytes, b"fixture content is never indexed");
        let folder = fixture
            .service
            .query("reports", 8)
            .unwrap()
            .into_iter()
            .find(|hit| hit.kind == "folder")
            .unwrap();
        assert!(fixture.service.share_source(&folder.id).is_err());
    }

    #[test]
    fn folder_actions_allow_child_changes_but_files_require_a_fresh_snapshot() {
        let fixture = Fixture::new();
        let file = fixture.file("reports/rapport.pdf");
        fixture.index();
        let folder = fixture
            .service
            .query("reports", 8)
            .unwrap()
            .into_iter()
            .find(|hit| hit.kind == "folder")
            .unwrap();
        let document = fixture.service.query("rapport", 8).unwrap().remove(0);
        fixture.file("reports/new-file.txt");
        assert!(fixture.service.checked_item(&folder.id).is_ok());
        fs::write(file, b"different document contents").unwrap();
        assert!(fixture.service.checked_item(&document.id).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn offline_placeholders_and_network_paths_are_skipped_without_reading_them() {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW};
        let fixture = Fixture::new();
        let path = fixture.file("offline-report.pdf");
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let attributes = unsafe { GetFileAttributesW(wide.as_ptr()) };
        assert_ne!(attributes, u32::MAX);
        assert_ne!(
            unsafe { SetFileAttributesW(wide.as_ptr(), attributes | 0x1000) },
            0
        );
        fixture.index();
        assert!(fixture.service.query("offline", 8).unwrap().is_empty());
        assert_ne!(unsafe { SetFileAttributesW(wide.as_ptr(), attributes) }, 0);
        assert!(!local_path(Path::new("\\\\server\\share\\report.pdf")));
        assert!(!local_path(Path::new(
            "\\\\?\\UNC\\server\\share\\report.pdf"
        )));
    }

    #[cfg(windows)]
    #[test]
    fn windows_hidden_items_leave_live_results_and_actions_without_hiding_appdata_storage() {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN,
        };
        struct RestoreAttributes(Vec<(PathBuf, u32)>);
        impl RestoreAttributes {
            fn hide(&mut self, path: &Path) {
                let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                let attributes = unsafe { GetFileAttributesW(wide.as_ptr()) };
                assert_ne!(attributes, u32::MAX);
                self.0.push((path.to_path_buf(), attributes));
                assert_ne!(
                    unsafe {
                        SetFileAttributesW(wide.as_ptr(), attributes | FILE_ATTRIBUTE_HIDDEN)
                    },
                    0
                );
            }
        }
        impl Drop for RestoreAttributes {
            fn drop(&mut self) {
                for (path, attributes) in self.0.iter().rev() {
                    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                    unsafe {
                        SetFileAttributesW(wide.as_ptr(), *attributes);
                    }
                }
            }
        }
        let fixture = Fixture::new();
        fixture.file("keeper-report.txt");
        let changed = fixture.file("visible-secret.txt");
        let child = fixture.file("private-folder/child-secret.txt");
        let folder = fixture.root.join("private-folder");
        fixture.index();
        let old_ids: Vec<String> = fixture
            .service
            .query("secret", 8)
            .unwrap()
            .into_iter()
            .map(|hit| hit.id)
            .collect();
        assert_eq!(old_ids.len(), 2);
        let mut restore = RestoreAttributes(Vec::new());
        restore.hide(&changed);
        restore.hide(&folder);
        // Cached rows must become inaccessible before the watcher gets its next event.
        assert!(fixture.service.query("secret", 8).unwrap().is_empty());
        for id in &old_ids {
            assert!(fixture.service.checked_item(id).is_err());
            assert!(fixture.service.share_source(id).is_err());
        }
        let connection = open_database(&fixture.service.database, true).unwrap();
        fixture
            .service
            .apply_changes(&connection, &[changed, folder, child])
            .unwrap();
        assert_eq!(entry_count(&connection).unwrap(), 1);
        let new_file = fixture.file("new-secret.txt");
        let new_child = fixture.file("live-hidden-folder/live-secret.txt");
        let new_folder = fixture.root.join("live-hidden-folder");
        restore.hide(&new_file);
        restore.hide(&new_folder);
        fixture
            .service
            .apply_changes(&connection, &[new_file, new_folder, new_child])
            .unwrap();
        assert!(fixture.service.query("secret", 8).unwrap().is_empty());
        assert_eq!(entry_count(&connection).unwrap(), 1);
        // AppData-like storage can be hidden; its flags are outside every search library.
        restore.hide(&fixture.service.private_root);
        assert_eq!(fixture.service.query("keeper", 8).unwrap().len(), 1);
        let restarted =
            SearchService::new(&fixture.service.private_root, vec![fixture.root.clone()]).unwrap();
        assert_eq!(restarted.query("keeper", 8).unwrap().len(), 1);
        assert_eq!(restarted.status().files, 1);
    }

    #[cfg(windows)]
    #[test]
    fn shared_read_handle_prevents_source_writes_and_replacement_until_copy_finishes() {
        let fixture = Fixture::new();
        let path = fixture.file("locked-report.pdf");
        fixture.index();
        let hit = fixture.service.query("locked-report", 8).unwrap().remove(0);
        let (_, reader, _) = fixture.service.share_source(&hit.id).unwrap();
        assert!(fs::rename(&path, fixture.root.join("renamed-report.pdf")).is_err());
        assert!(fs::write(&path, b"changed while copying").is_err());
        drop(reader);
        fs::write(&path, b"copy has finished").unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_outside_root_is_neither_indexed_nor_opened() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = fixture._directory.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.pdf"), b"secret").unwrap();
        symlink(&outside, fixture.root.join("linked")).unwrap();
        fixture.index();
        assert!(fixture.service.query("secret", 8).unwrap().is_empty());
        let path = fixture.file("allowed.pdf");
        fixture.index();
        let hit = fixture.service.query("allowed", 8).unwrap().remove(0);
        fs::remove_file(&path).unwrap();
        symlink(outside.join("secret.pdf"), path).unwrap();
        assert!(fixture.service.checked_item(&hit.id).is_err());
    }
}
