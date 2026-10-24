//! Optional Market download. Only the pinned upstream engine and corresponding source are accepted.
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, fs, io::{Read, Seek, Write}, path::{Component, Path, PathBuf}, sync::{Arc, Mutex}, time::Duration};
use tokio::io::AsyncWriteExt;

const VERSION: &str = "4.5.0";
const ENGINE_URL: &str = "https://github.com/QL-Win/QuickLook/releases/download/4.5.0/QuickLook-4.5.0.zip";
const ENGINE_SIZE: u64 = 122_534_056;
const ENGINE_SHA: &str = "852d8bcccd984e416fc8491ccedb848f0c3472e930ee0d292188b2ea3df524e0";
const SOURCE_COMMIT: &str = "b13df028f3cce1f84792f7043b57bf5cea3a3e4c";
const SOURCE_URL: &str = "https://codeload.github.com/QL-Win/QuickLook/zip/b13df028f3cce1f84792f7043b57bf5cea3a3e4c";
const SOURCE_SIZE: u64 = 17_633_654;
const SOURCE_SHA: &str = "bfa2d2bfa00ff9ea0a44a989cacc1d9f0b5241d7ad59126d305dc45cca56616a";
const OFFICE_VERSION: &str = "6";
const OFFICE_URL: &str = "https://github.com/QL-Win/QuickLook.Plugin.OfficeViewer/releases/download/6/QuickLook.Plugin.OfficeViewer.qlplugin";
const OFFICE_SIZE: u64 = 15_314_985;
const OFFICE_SHA: &str = "9ea7b49d293f00180fc6e502890a58d51872e3e2c8ff3e739b92ca98468ba4f5";
const OFFICE_SOURCE_COMMIT: &str = "fa994a6800b3f73b0a327ff1d6de4fed04ca5b71";
const OFFICE_SOURCE_URL: &str = "https://codeload.github.com/QL-Win/QuickLook.Plugin.OfficeViewer/zip/fa994a6800b3f73b0a327ff1d6de4fed04ca5b71";
const OFFICE_SOURCE_SIZE: u64 = 87_067;
const OFFICE_SOURCE_SHA: &str = "95159ae1e329c82278b69a8cbb25e702021e536d1ff9eddfc75dbcf2635b444e";
const OFFICE_TOTAL: u64 = OFFICE_SIZE + OFFICE_SOURCE_SIZE;
const TOTAL: u64 = ENGINE_SIZE + SOURCE_SIZE + OFFICE_TOTAL;
const OFFICE_FOLDER: &str = "QuickLook.Plugin.OfficeViewer";
const PDF_COMPAT_VERSION: &str = "2";
const PDF_COMPAT_PACKAGE: &str = "QuickLookPdfCompatibility.zip";
const PDF_COMPAT_SIZE: u64 = 42_833;
const PDF_COMPAT_SHA: &str = "d3ba0de0700a58417f984ef30a4b4d2e631c21d8a17143af6d268f37d80611dc";
const PDF_COMPAT_DLL_SHA: &str = "806f1d841ebbf9522a5777db3d1aa3f0acb07956c80b2a10453fcc07a1ba37d2";
const PDF_COMPAT_LEGACY_SHA: &str = "b478f82fd45951fbd82c016f38dc28ed14c2c4f655566ae67696c652b8cf8c2a";
const PDF_COMPAT_LEGACY_DLL_SHA: &str = "7af4b19ae447859d2465b7b639030284767528de556fe4b6e31d5ff8b6be773e";
const PDF_ORIGINAL_SHA: &str = "56431688ad61680e9d59bab0315bdf03868a1041d389e87ab7dbeca4b2e4e631";
const PDF_COMPAT_FILES: &[&str] = &["QuickLook.Plugin.PDFViewer.dll", "PdfViewerControl.xaml.cs.patch", "Build-PdfCompatibility.ps1", "README.md", "LICENSE-GPL.txt", "manifest.json", "CompactHtmlPlugin.cs", "Test-CompactHtml.ps1"];
pub(crate) const OFFICE_FILES: &[(&str, u64)] = &[
    ("QuickLook.Plugin.Metadata.config", 244), ("QuickLook.Plugin.OfficeViewer.dll", 13_312),
    ("Syncfusion.Compression.Base.dll", 765_952), ("Syncfusion.DocIO.Base.dll", 6_393_856),
    ("Syncfusion.ExcelChartToImageConverter.Wpf.dll", 233_472), ("Syncfusion.Licensing.dll", 478_720),
    ("Syncfusion.Markdown.dll", 57_344), ("Syncfusion.OfficeChart.Base.dll", 2_742_784),
    ("Syncfusion.OfficeChartToImageConverter.Wpf.dll", 208_896), ("Syncfusion.Pdf.Base.dll", 8_155_648),
    ("Syncfusion.Presentation.Base.dll", 2_412_032), ("Syncfusion.PresentationToPdfConverter.Base.dll", 199_168),
    ("Syncfusion.SfCellGrid.WPF.dll", 1_052_672), ("Syncfusion.SfChart.WPF.dll", 2_073_088),
    ("Syncfusion.SfGridCommon.WPF.dll", 156_160), ("Syncfusion.SfRichTextBoxAdv.WPF.dll", 2_476_544),
    ("Syncfusion.SfSpreadsheet.WPF.dll", 1_973_248), ("Syncfusion.SfSpreadsheetHelper.WPF.dll", 11_776),
    ("Syncfusion.Shared.WPF.dll", 3_223_040), ("Syncfusion.Tools.WPF.dll", 6_223_872),
    ("Syncfusion.XlsIO.Base.dll", 6_430_720),
];
const META: &str = ".notchy-module";
const MAX_FILES: usize = 20_000;
const MAX_TOTAL: u64 = 512 * 1024 * 1024;
const MAX_FILE: u64 = 128 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct Status {
    pub supported: bool,
    pub installed: bool,
    pub removable: bool,
    pub phase: String,
    pub version: Option<String>,
    #[serde(rename = "officeInstalled")]
    pub office_installed: bool,
    #[serde(rename = "officeVersion")]
    pub office_version: Option<String>,
    pub downloaded: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Manifest { id: String, version: String, engine_sha256: String, source_sha256: String, source_commit: String }
#[derive(Serialize, Deserialize)]
struct OfficeManifest { id: String, version: String, archive_sha256: String, source_sha256: String, source_commit: String }
#[derive(Serialize, Deserialize)]
struct PdfCompatManifest { id: String, version: String, archive_sha256: String, original_sha256: String, patched_sha256: String, source_commit: String }

pub struct Module {
    data: PathBuf,
    directory: PathBuf,
    operation: Arc<tokio::sync::Mutex<()>>,
    state: Mutex<Status>,
}
impl Module {
    pub fn new(data: &Path) -> Result<Self, String> {
        check_directory(data)?;
        let directory = data.join(".desktop-profile").join("modules").join("quicklook");
        let installed = installed(&directory); let removable = owned(&directory); let office_installed = office_installed(&directory);
        let total = pending_download_size(&directory);
        Ok(Self { data: data.to_path_buf(), directory, operation: Arc::new(tokio::sync::Mutex::new(())), state: Mutex::new(Status {
            supported: cfg!(windows), installed, removable, phase: if installed { "installed" } else { "idle" }.into(), version: installed.then(|| VERSION.into()),
            office_installed, office_version: office_installed.then(|| OFFICE_VERSION.into()), downloaded: 0, total, error: None,
        }) })
    }
    pub fn directory(&self) -> &Path { &self.directory }
    pub fn status(&self) -> Status {
        let mut status = self.state.lock().unwrap().clone();
        status.installed = installed(&self.directory); status.removable = owned(&self.directory);
        status.office_installed = office_installed(&self.directory); status.office_version = status.office_installed.then(|| OFFICE_VERSION.into());
        if status.removable && !status.installed && !matches!(status.phase.as_str(), "downloading" | "verifying" | "extracting" | "removing") { status.phase = "error".into(); status.error = Some("Installation QuickLook incomplète. Retire le module puis réessaie.".into()); }
        status.version = status.installed.then(|| VERSION.into());
        status
    }
    fn phase(&self, phase: &str) { let mut state = self.state.lock().unwrap(); state.phase = phase.into(); state.error = None; }
    fn result(&self, result: &Result<(), String>) -> Status {
        let present = installed(&self.directory);
        let mut state = self.state.lock().unwrap();
        state.installed = present; state.removable = owned(&self.directory); state.version = present.then(|| VERSION.into());
        state.office_installed = office_installed(&self.directory); state.office_version = state.office_installed.then(|| OFFICE_VERSION.into());
        state.phase = if result.is_err() { "error" } else if present { "installed" } else { "idle" }.into();
        state.error = result.as_ref().err().cloned(); state.clone()
    }
    fn start_install(&self) -> Result<bool, String> {
        if !cfg!(windows) { return Err("QuickLook nécessite Windows.".into()); }
        if installed(&self.directory) && office_installed(&self.directory) { return Ok(false); }
        let mut state = self.state.lock().unwrap();
        state.total = pending_download_size(&self.directory); state.phase = if state.total == 0 { "verifying" } else { "downloading" }.into(); state.downloaded = 0; state.error = None;
        Ok(true)
    }
    pub fn begin_install(self: &Arc<Self>) -> Result<Status, String> {
        let operation = self.operation.clone().try_lock_owned().map_err(|_| "Une opération QuickLook est déjà en cours.")?;
        if !self.start_install()? { return Ok(self.status()); }
        let accepted = self.status();
        let module = self.clone();
        tokio::spawn(async move { let _operation = operation; let result = module.install_locked().await; module.result(&result); });
        Ok(accepted)
    }
    pub async fn install(&self) -> Result<Status, String> {
        let _operation = self.operation.try_lock().map_err(|_| "Une opération QuickLook est déjà en cours.")?;
        if !self.start_install()? { return Ok(self.status()); }
        let result = self.install_locked().await; let status = self.result(&result); result.map(|_| status)
    }
    async fn install_locked(&self) -> Result<(), String> {
        let _guards = self.storage(true)?;
        let compatibility = compatibility_package()?;
        verified_archive(&compatibility, PDF_COMPAT_SIZE, PDF_COMPAT_SHA)?;
        let engine_present = installed(&self.directory);
        let office_present = engine_present && office_package_installed(&office_directory(&self.directory));
        if self.directory.exists() && !engine_present { return Err("Le dossier QuickLook existant doit être retiré avant de réessayer.".into()); }
        if engine_present { check_office_target(&self.directory)?; }
        let parent = self.directory.parent().unwrap();
        let staging = tempfile::Builder::new().prefix("quicklook-install-").tempdir_in(parent).map_err(|_| "Préparation du téléchargement impossible.")?;
        let engine = staging.path().join("engine.zip"); let source = staging.path().join("source.zip");
        let office = staging.path().join("office.qlplugin"); let office_source = staging.path().join("office-source.zip");
        let client = reqwest::Client::builder().https_only(true).connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(1800)).read_timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || !official_url(attempt.url()) { attempt.stop() } else { attempt.follow() }
            })).user_agent("Notchy-QuickLook-Module/1").build().map_err(|_| "Téléchargement indisponible.")?;
        let offset = if engine_present { 0 } else {
            self.download(&client, ENGINE_URL, &engine, ENGINE_SIZE, ENGINE_SHA, 0).await?;
            self.download(&client, SOURCE_URL, &source, SOURCE_SIZE, SOURCE_SHA, ENGINE_SIZE).await?;
            ENGINE_SIZE + SOURCE_SIZE
        };
        if !office_present {
            self.download(&client, OFFICE_URL, &office, OFFICE_SIZE, OFFICE_SHA, offset).await?;
            self.download(&client, OFFICE_SOURCE_URL, &office_source, OFFICE_SOURCE_SIZE, OFFICE_SOURCE_SHA, offset + OFFICE_SIZE).await?;
        }
        self.phase("verifying");
        let destination = self.directory.clone(); let stage = staging.path().to_path_buf();
        self.phase("extracting");
        tokio::task::spawn_blocking(move || {
            if !engine_present { install_archives(&engine, &source, &stage, &destination)?; }
            // QuickLook loads its extensions once; stop only the owned engine before upgrading.
            crate::quicklook::stop_managed(&destination)?;
            if !office_present { install_office_archives(&office, &office_source, &stage, &destination)?; }
            install_pdf_compatibility(&compatibility, &stage, &destination)
        }).await.map_err(|_| "Installation QuickLook interrompue.")??;
        Ok(())
    }
    async fn download(&self, client: &reqwest::Client, url: &str, target: &Path, expected_size: u64, expected_sha: &str, offset: u64) -> Result<(), String> {
        let response = client.get(url).send().await.map_err(|_| "Impossible de télécharger QuickLook. Réessaie lorsque la connexion est disponible.")?;
        if !response.status().is_success() || !official_url(response.url()) || response.content_length().is_some_and(|size| size != expected_size) { return Err("Le téléchargement QuickLook ne correspond pas à la version attendue.".into()); }
        let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(target).await.map_err(|_| "Stockage du téléchargement indisponible.")?;
        let mut stream = response.bytes_stream(); let mut size = 0u64; let mut sha = Sha256::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Le téléchargement QuickLook a été interrompu.")?;
            size = size.checked_add(chunk.len() as u64).ok_or("Téléchargement trop volumineux.")?;
            if size > expected_size { return Err("Téléchargement trop volumineux.".into()); }
            file.write_all(&chunk).await.map_err(|_| "Écriture du téléchargement impossible.")?; sha.update(&chunk);
            self.state.lock().unwrap().downloaded = offset + size;
        }
        file.flush().await.map_err(|_| "Écriture du téléchargement impossible.")?; file.sync_all().await.map_err(|_| "Écriture du téléchargement impossible.")?;
        if size != expected_size || hex::encode(sha.finalize()) != expected_sha { return Err("La vérification du téléchargement QuickLook a échoué.".into()); }
        Ok(())
    }
    pub async fn remove(&self) -> Result<Status, String> {
        let _operation = self.operation.try_lock().map_err(|_| "Une opération QuickLook est déjà en cours.")?;
        self.phase("removing");
        let result = async {
            let _guards = self.storage(false)?;
            if !self.directory.exists() { return Ok(()); }
            let directory = self.directory.clone();
            tokio::task::spawn_blocking(move || {
                crate::quicklook::stop_managed(&directory)?;
                remove_owned(&directory)
            }).await.map_err(|_| "Retrait QuickLook interrompu.")?
        }.await;
        let status = self.result(&result); result.map(|_| status)
    }
    fn storage(&self, create: bool) -> Result<Vec<fs::File>, String> {
        let mut guards = vec![guard_directory(&self.data)?];
        let mut current = self.data.clone();
        for part in [".desktop-profile", "modules"] {
            current.push(part);
            if create && !current.exists() { fs::create_dir(&current).map_err(|_| "Création du stockage QuickLook impossible.")?; }
            guards.push(guard_directory(&current)?);
        }
        Ok(guards)
    }
}

fn official_url(url: &url::Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none() && url.port_or_known_default() == Some(443)
        && matches!(url.host_str(), Some("github.com" | "release-assets.githubusercontent.com" | "objects.githubusercontent.com" | "codeload.github.com"))
}
fn reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() { return true; }
    #[cfg(windows)] { use std::os::windows::fs::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return true; } }
    false
}
fn equal_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)] { return left.to_string_lossy().trim_start_matches(r"\\?\").eq_ignore_ascii_case(right.to_string_lossy().trim_start_matches(r"\\?\")); }
    #[cfg(not(windows))] { left == right }
}
fn check_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)) { return Err("Chemin de module invalide.".into()); }
    let metadata = fs::symlink_metadata(path).map_err(|_| "Le stockage QuickLook est indisponible.")?;
    let actual = fs::canonicalize(path).map_err(|_| "Le stockage QuickLook est indisponible.")?;
    if !metadata.is_dir() || reparse(&metadata) || !equal_path(&actual, path) { return Err("Le stockage QuickLook a été redirigé.".into()); }
    Ok(())
}
fn guard_directory(path: &Path) -> Result<fs::File, String> {
    check_directory(path)?;
    let mut options = fs::OpenOptions::new(); options.read(true);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(3).custom_flags(0x02200000); }
    let handle = options.open(path).map_err(|_| "Le stockage QuickLook ne peut pas être verrouillé.".to_string())?;
    check_directory(path)?; Ok(handle)
}
fn regular(path: &Path) -> bool { fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file() && !reparse(&meta)) }
fn owned(directory: &Path) -> bool {
    if check_directory(directory).is_err() || check_directory(&directory.join(META)).is_err() { return false; }
    let manifest = directory.join(META).join("manifest.json");
    if !regular(&manifest) || fs::metadata(&manifest).map_or(true, |meta| meta.len() > 4096) { return false; }
    let Some(marker) = fs::read(&manifest).ok().and_then(|bytes| serde_json::from_slice::<Manifest>(&bytes).ok()) else { return false; };
    marker.id == "quicklook" && marker.version == VERSION && marker.engine_sha256 == ENGINE_SHA && marker.source_sha256 == SOURCE_SHA && marker.source_commit == SOURCE_COMMIT
}
pub(crate) fn installed(directory: &Path) -> bool {
    owned(directory) && regular(&directory.join("QuickLook.exe")) && regular(&directory.join("portable.lock")) && regular(&directory.join(META).join("LICENSE-GPL.txt"))
        && regular(&directory.join(META).join("source.zip")) && fs::metadata(directory.join(META).join("source.zip")).is_ok_and(|meta| meta.len() == SOURCE_SIZE)
        && check_directory(&directory.join("UserData")).is_ok() && regular(&directory.join("UserData").join("QuickLook.config"))
}
fn office_directory(directory: &Path) -> PathBuf { directory.join("UserData").join("QuickLook.Plugin").join(OFFICE_FOLDER) }
fn pending_download_size(directory: &Path) -> u64 {
    if !installed(directory) { TOTAL } else if office_package_installed(&office_directory(directory)) { 0 } else { OFFICE_TOTAL }
}
fn office_owned(directory: &Path) -> bool {
    if check_directory(directory).is_err() || check_directory(&directory.join(META)).is_err() { return false; }
    let path = directory.join(META).join("manifest.json");
    if !regular(&path) || fs::metadata(&path).map_or(true, |meta| meta.len() > 4096) { return false; }
    let Some(marker) = fs::read(path).ok().and_then(|bytes| serde_json::from_slice::<OfficeManifest>(&bytes).ok()) else { return false; };
    marker.id == "quicklook-officeviewer" && marker.version == OFFICE_VERSION && marker.archive_sha256 == OFFICE_SHA
        && marker.source_sha256 == OFFICE_SOURCE_SHA && marker.source_commit == OFFICE_SOURCE_COMMIT
}
fn office_package_installed(directory: &Path) -> bool {
    office_owned(directory) && OFFICE_FILES.iter().all(|(name, size)| {
        let path = directory.join(name); regular(&path) && fs::metadata(path).is_ok_and(|meta| meta.len() == *size)
    }) && ["LICENSE.txt", "README.md", "source.zip"].iter().all(|name| regular(&directory.join(META).join(name)))
        && fs::metadata(directory.join(META).join("source.zip")).is_ok_and(|meta| meta.len() == OFFICE_SOURCE_SIZE)
}
pub(crate) fn office_installed(directory: &Path) -> bool {
    installed(directory) && check_directory(&directory.join("UserData").join("QuickLook.Plugin")).is_ok()
        && office_package_installed(&office_directory(directory)) && pdf_compatibility_installed(directory)
}
fn pdf_viewer_directory(directory: &Path) -> PathBuf { directory.join("QuickLook.Plugin").join("QuickLook.Plugin.PDFViewer") }
fn pdf_compatibility_metadata(directory: &Path) -> PathBuf { directory.join(META).join("pdf-compat") }
fn compatibility_package() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|_| "Ressources de compatibilité QuickLook indisponibles.")?;
    let native = executable.parent().ok_or("Ressources QuickLook indisponibles.")?.join("native");
    check_directory(&native).map_err(|_| "Le correctif PDF QuickLook est absent des ressources Notchy. Réinstalle ou recompile cette version.".to_string())?;
    let path = native.join(PDF_COMPAT_PACKAGE);
    if !regular(&path) { return Err("Le correctif PDF QuickLook est absent des ressources Notchy.".into()); }
    Ok(path)
}
fn file_sha256(path: &Path) -> Result<String, String> {
    if !regular(path) || fs::metadata(path).map_or(true, |meta| meta.len() > MAX_FILE) { return Err("Fichier QuickLook invalide ou redirigé.".into()); }
    let mut file = fs::File::open(path).map_err(|_| "Fichier QuickLook indisponible.".to_string())?;
    let mut sha = Sha256::new(); let mut buffer = [0u8; 65536]; let mut total = 0;
    loop { let count = file.read(&mut buffer).map_err(|_| "Fichier QuickLook illisible.")?; if count == 0 { break; } total += count as u64; if total > MAX_FILE { return Err("Fichier QuickLook trop volumineux.".into()); } sha.update(&buffer[..count]); }
    Ok(hex::encode(sha.finalize()))
}
fn pdf_compatibility_owned(directory: &Path) -> bool {
    let metadata = pdf_compatibility_metadata(directory);
    if check_directory(&metadata).is_err() { return false; }
    let path = metadata.join("ownership.json");
    if !regular(&path) || fs::metadata(&path).map_or(true, |meta| meta.len() > 4096) { return false; }
    let Some(marker) = fs::read(path).ok().and_then(|bytes| serde_json::from_slice::<PdfCompatManifest>(&bytes).ok()) else { return false; };
    marker.id == "quicklook-pdf-compat" && marker.original_sha256 == PDF_ORIGINAL_SHA && marker.source_commit == SOURCE_COMMIT
        && ((marker.version == PDF_COMPAT_VERSION && marker.archive_sha256 == PDF_COMPAT_SHA && marker.patched_sha256 == PDF_COMPAT_DLL_SHA)
            || (marker.version == "1" && marker.archive_sha256 == PDF_COMPAT_LEGACY_SHA && marker.patched_sha256 == PDF_COMPAT_LEGACY_DLL_SHA))
}
fn pdf_compatibility_installed(directory: &Path) -> bool {
    let parent = pdf_viewer_directory(directory); let metadata = pdf_compatibility_metadata(directory);
    pdf_compatibility_owned(directory) && check_directory(&directory.join("QuickLook.Plugin")).is_ok() && check_directory(&parent).is_ok()
        && file_sha256(&parent.join("QuickLook.Plugin.PDFViewer.dll")).is_ok_and(|sha| sha == PDF_COMPAT_DLL_SHA)
        && file_sha256(&metadata.join("original.dll")).is_ok_and(|sha| sha == PDF_ORIGINAL_SHA)
        && PDF_COMPAT_FILES.iter().all(|name| regular(&metadata.join(name)))
}
fn check_office_target(directory: &Path) -> Result<(), String> {
    check_directory(directory)?; check_directory(&directory.join("UserData"))?;
    let plugins = directory.join("UserData").join("QuickLook.Plugin");
    if fs::symlink_metadata(&plugins).is_ok() { check_directory(&plugins)?; }
    let target = office_directory(directory);
    if fs::symlink_metadata(&target).is_ok() && !office_owned(&target) {
        return Err("Une extension OfficeViewer indépendante existe déjà dans ce module. Aucun fichier n’a été remplacé.".into());
    }
    Ok(())
}
fn safe_name(name: &str) -> Result<(PathBuf, String), String> {
    if name.is_empty() || name.len() > 2048 || name.chars().any(|c| c.is_control()) { return Err("Chemin ZIP invalide.".into()); }
    let normalized = name.replace('\\', "/");
    let trimmed = normalized.strip_suffix('/').unwrap_or(&normalized);
    let mut path = PathBuf::new(); let mut keys = Vec::new();
    for part in trimmed.split('/') {
        let upper = part.split('.').next().unwrap_or("").to_uppercase();
        if part.is_empty() || matches!(part, "." | "..") || part.len() > 255 || part.contains(':') || (part.ends_with('.') || part.ends_with(' '))
            || matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") || (upper.len() == 4 && (upper.starts_with("COM") || upper.starts_with("LPT")) && matches!(upper.as_bytes()[3], b'1'..=b'9'))
        { return Err("Chemin ZIP non sûr.".into()); }
        path.push(part); keys.push(part.to_lowercase());
    }
    if !path.components().all(|part| matches!(part, Component::Normal(_))) { return Err("Chemin ZIP non relatif.".into()); }
    Ok((path, keys.join("/")))
}
struct Inventory { entries: usize, bytes: u64 }
fn inventory<R: Read + std::io::Seek>(archive: &mut zip::ZipArchive<R>) -> Result<Inventory, String> {
    if archive.len() > MAX_FILES { return Err("Archive ZIP trop volumineuse.".into()); }
    let mut names = BTreeSet::new(); let mut kinds = BTreeMap::new(); let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| "Archive ZIP illisible.")?;
        let (_, key) = safe_name(entry.name())?;
        if !names.insert(key.clone()) { return Err("Entrée ZIP dupliquée.".into()); }
        let mode = entry.unix_mode().unwrap_or(0) & 0o170000;
        if !matches!(mode, 0 | 0o100000 | 0o040000) || mode == 0o040000 && !entry.is_dir() || !matches!(entry.compression(), zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated) { return Err("Liens et fichiers spéciaux ZIP interdits.".into()); }
        if entry.size() > MAX_FILE || entry.size() > entry.compressed_size().saturating_mul(1000).saturating_add(4096) { return Err("Expansion ZIP excessive.".into()); }
        total = total.checked_add(entry.size()).ok_or("Archive ZIP trop volumineuse.")?;
        if total > MAX_TOTAL { return Err("Archive ZIP trop volumineuse.".into()); }
        let mut prefix = String::new(); let parts: Vec<_> = key.split('/').collect();
        for part in &parts[..parts.len()-1] { if !prefix.is_empty() { prefix.push('/'); } prefix.push_str(part); if kinds.get(&prefix) == Some(&false) { return Err("Collision de chemins ZIP.".into()); } kinds.entry(prefix.clone()).or_insert(true); }
        let directory = entry.is_dir();
        if kinds.get(&key).is_some_and(|previous| *previous != directory) { return Err("Collision fichier/dossier ZIP.".into()); }
        kinds.insert(key, directory);
    }
    Ok(Inventory { entries: archive.len(), bytes: total })
}
fn verified_archive(path: &Path, size: u64, expected: &str) -> Result<fs::File, String> {
    if !regular(path) || fs::metadata(path).map_or(true, |meta| meta.len() != size) { return Err("Taille d’archive QuickLook incorrecte.".into()); }
    let mut options = fs::OpenOptions::new(); options.read(true);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(1).custom_flags(0x00200000); }
    let mut file = options.open(path).map_err(|_| "Archive QuickLook indisponible.")?;
    let metadata = file.metadata().map_err(|_| "Archive QuickLook indisponible.")?;
    if !metadata.is_file() || reparse(&metadata) || metadata.len() != size { return Err("Archive QuickLook redirigée ou modifiée.".into()); }
    let mut sha = Sha256::new(); let mut buffer = [0u8; 65536];
    loop { let count = file.read(&mut buffer).map_err(|_| "Archive QuickLook illisible.")?; if count == 0 { break; } sha.update(&buffer[..count]); }
    if hex::encode(sha.finalize()) != expected { return Err("Empreinte d’archive QuickLook incorrecte.".into()); } file.rewind().map_err(|_| "Archive QuickLook illisible.")?; Ok(file)
}
fn install_archives(engine: &Path, source: &Path, staging: &Path, destination: &Path) -> Result<(), String> {
    let engine_file = verified_archive(engine, ENGINE_SIZE, ENGINE_SHA)?; let source_file = verified_archive(source, SOURCE_SIZE, SOURCE_SHA)?;
    check_directory(staging)?;
    if destination.exists() { return Err("Un module existe déjà à cet emplacement.".into()); }
    let mut source_zip = zip::ZipArchive::new(source_file).map_err(|_| "Sources ZIP invalides.")?;
    inventory(&mut source_zip)?;
    let license_name = format!("QuickLook-{SOURCE_COMMIT}/LICENSE-GPL.txt");
    let license_entry = source_zip.by_name(&license_name).map_err(|_| "Licence GPL absente des sources officielles.")?;
    let license_size = license_entry.size();
    if license_size > 128 * 1024 { return Err("Licence GPL invalide.".into()); }
    let mut license = Vec::new(); license_entry.take(license_size + 1).read_to_end(&mut license).map_err(|_| "Licence GPL illisible.")?;
    if license.len() as u64 != license_size { return Err("Taille de licence GPL incorrecte.".into()); }
    if !String::from_utf8_lossy(&license).contains("GNU GENERAL PUBLIC LICENSE") { return Err("Licence GPL invalide.".into()); }
    let mut archive = zip::ZipArchive::new(engine_file).map_err(|_| "Archive QuickLook invalide.")?;
    let contents = inventory(&mut archive)?;
    if contents.entries != 1343 || contents.bytes != 279_855_980 { return Err("Le contenu portable QuickLook est inattendu.".into()); }
    let prepared = staging.join("quicklook"); fs::create_dir(&prepared).map_err(|_| "Préparation du module impossible.")?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| "Entrée QuickLook illisible.")?;
        let (relative, key) = safe_name(entry.name())?;
        if key == META || key.starts_with(&format!("{META}/")) { return Err("Métadonnées QuickLook en conflit.".into()); }
        let target = prepared.join(relative); let parent = target.parent().ok_or("Chemin QuickLook invalide.")?;
        create_tree(&prepared, parent)?;
        if entry.is_dir() { if !target.exists() { fs::create_dir(&target).map_err(|_| "Extraction QuickLook impossible.")?; } check_directory(&target)?; }
        else { let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|_| "Fichier QuickLook en conflit.")?;
            let expected = entry.size(); let copied = std::io::copy(&mut entry.by_ref().take(expected + 1), &mut output).map_err(|_| "Extraction QuickLook interrompue.")?;
            if copied != expected { return Err("Taille extraite QuickLook incorrecte.".into()); } output.sync_all().map_err(|_| "Écriture QuickLook impossible.")?;
        }
    }
    if !regular(&prepared.join("QuickLook.exe")) || !regular(&prepared.join("portable.lock")) { return Err("Le portable QuickLook est incomplet.".into()); }
    let metadata = prepared.join(META); fs::create_dir(&metadata).map_err(|_| "Métadonnées QuickLook indisponibles.")?;
    write_new(&metadata.join("LICENSE-GPL.txt"), &license)?;
    let mut source_input = fs::File::open(source).map_err(|_| "Sources QuickLook indisponibles.")?;
    let mut source_output = fs::OpenOptions::new().write(true).create_new(true).open(metadata.join("source.zip")).map_err(|_| "Copie des sources impossible.")?;
    std::io::copy(&mut source_input, &mut source_output).map_err(|_| "Copie des sources impossible.")?; source_output.sync_all().map_err(|_| "Copie des sources impossible.")?;
    drop(source_output);
    let settings = prepared.join("UserData"); if !settings.exists() { fs::create_dir(&settings).map_err(|_| "Réglages QuickLook indisponibles.")?; } check_directory(&settings)?;
    write_new(&settings.join("QuickLook.config"), b"<?xml version=\"1.0\" encoding=\"utf-8\"?><Settings><DisableAutoUpdateCheck>True</DisableAutoUpdateCheck><ShowTrayIcon>False</ShowTrayIcon></Settings>")?;
    let manifest = Manifest { id: "quicklook".into(), version: VERSION.into(), engine_sha256: ENGINE_SHA.into(), source_sha256: SOURCE_SHA.into(), source_commit: SOURCE_COMMIT.into() };
    write_new(&metadata.join("manifest.json"), &serde_json::to_vec(&manifest).map_err(|_| "Métadonnées QuickLook invalides.")?)?;
    if !installed(&prepared) { return Err("Le module QuickLook préparé est incomplet.".into()); }
    check_directory(destination.parent().unwrap())?;
    fs::rename(&prepared, destination).map_err(|_| "Publication atomique du module QuickLook impossible.")?; Ok(())
}
// This accepts only the pinned upstream package and a verified Notchy-owned engine, never a renderer-supplied target.
pub(crate) fn install_office_archives(package: &Path, source: &Path, staging: &Path, directory: &Path) -> Result<(), String> {
    if !installed(directory) { return Err("Le moteur QuickLook géré doit être installé avant son extension Office.".into()); }
    check_office_target(directory)?; check_directory(staging)?;
    let package_file = verified_archive(package, OFFICE_SIZE, OFFICE_SHA)?;
    let source_file = verified_archive(source, OFFICE_SOURCE_SIZE, OFFICE_SOURCE_SHA)?;
    let mut archive = zip::ZipArchive::new(package_file).map_err(|_| "Extension OfficeViewer illisible.")?;
    let contents = inventory(&mut archive)?;
    if contents.entries != OFFICE_FILES.len() || contents.bytes != 45_282_548 { return Err("Le contenu OfficeViewer officiel est inattendu.".into()); }
    for (name, size) in OFFICE_FILES {
        if archive.by_name(name).map_or(true, |entry| entry.is_dir() || entry.size() != *size) { return Err("L’extension OfficeViewer est incomplète.".into()); }
    }
    let mut source_zip = zip::ZipArchive::new(source_file).map_err(|_| "Sources OfficeViewer illisibles.")?;
    inventory(&mut source_zip)?;
    let prepared = staging.join("office"); fs::create_dir(&prepared).map_err(|_| "Préparation OfficeViewer impossible.")?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| "Extension OfficeViewer illisible.")?;
        let (relative, _) = safe_name(entry.name())?;
        if relative.components().count() != 1 { return Err("Chemin OfficeViewer inattendu.".into()); }
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(prepared.join(relative)).map_err(|_| "Fichier OfficeViewer en conflit.")?;
        let expected = entry.size(); let copied = std::io::copy(&mut entry.by_ref().take(expected + 1), &mut output).map_err(|_| "Extraction OfficeViewer interrompue.")?;
        if copied != expected { return Err("Taille extraite OfficeViewer incorrecte.".into()); } output.sync_all().map_err(|_| "Écriture OfficeViewer impossible.")?;
    }
    let metadata = prepared.join(META); fs::create_dir(&metadata).map_err(|_| "Métadonnées OfficeViewer indisponibles.")?;
    for name in ["LICENSE.txt", "README.md"] {
        let entry = source_zip.by_name(&format!("QuickLook.Plugin.OfficeViewer-{OFFICE_SOURCE_COMMIT}/{name}")).map_err(|_| "Notice OfficeViewer absente des sources officielles.")?;
        let size = entry.size(); if size > 128 * 1024 { return Err("Notice OfficeViewer trop volumineuse.".into()); }
        let mut bytes = Vec::new(); entry.take(size + 1).read_to_end(&mut bytes).map_err(|_| "Notice OfficeViewer illisible.")?;
        if bytes.len() as u64 != size { return Err("Notice OfficeViewer incomplète.".into()); } write_new(&metadata.join(name), &bytes)?;
    }
    let mut source_input = source_zip.into_inner(); source_input.rewind().map_err(|_| "Sources OfficeViewer illisibles.")?;
    let mut source_output = fs::OpenOptions::new().write(true).create_new(true).open(metadata.join("source.zip")).map_err(|_| "Copie des sources OfficeViewer impossible.")?;
    std::io::copy(&mut source_input, &mut source_output).map_err(|_| "Copie des sources OfficeViewer impossible.")?; source_output.sync_all().map_err(|_| "Copie des sources OfficeViewer impossible.")?; drop(source_output);
    let marker = OfficeManifest { id: "quicklook-officeviewer".into(), version: OFFICE_VERSION.into(), archive_sha256: OFFICE_SHA.into(), source_sha256: OFFICE_SOURCE_SHA.into(), source_commit: OFFICE_SOURCE_COMMIT.into() };
    write_new(&metadata.join("manifest.json"), &serde_json::to_vec(&marker).map_err(|_| "Métadonnées OfficeViewer invalides.")?)?;
    if !office_package_installed(&prepared) { return Err("L’extension OfficeViewer préparée est incomplète.".into()); }
    publish_office(&prepared, directory)
}
fn publish_office(prepared: &Path, directory: &Path) -> Result<(), String> {
    check_office_target(directory)?;
    let _engine_guard = guard_directory(directory)?; let _settings_guard = guard_directory(&directory.join("UserData"))?;
    let plugins = directory.join("UserData").join("QuickLook.Plugin");
    if !plugins.exists() { fs::create_dir(&plugins).map_err(|_| "Dossier des extensions QuickLook indisponible.")?; }
    let _plugins_guard = guard_directory(&plugins)?;
    let target = office_directory(directory);
    let retirement = tempfile::Builder::new().prefix("quicklook-office-retired-").tempdir_in(directory.parent().ok_or("Stockage QuickLook invalide.")?).map_err(|_| "Préparation de la mise à jour OfficeViewer impossible.")?;
    let retired = retirement.path().join("office-previous");
    let previous = target.exists();
    if previous {
        if !office_owned(&target) { return Err("Extension OfficeViewer indépendante : remplacement refusé.".into()); }
        let mut files = Vec::new(); let mut bytes = 0; let mut entries = 0;
        removal_files(&target, &mut files, &mut bytes, &mut entries)?;
        fs::rename(&target, &retired).map_err(|_| "L’extension OfficeViewer est utilisée. Redémarre QuickLook avant de réessayer.".to_string())?;
    }
    if fs::rename(prepared, &target).is_err() {
        if previous && fs::rename(&retired, &target).is_err() {
            let recovery = retirement.keep();
            return Err(format!("Publication OfficeViewer interrompue ; fichiers précédents conservés : {}", recovery.display()));
        }
        return Err("Publication atomique OfficeViewer impossible.".into());
    }
    Ok(())
}
pub(crate) fn install_pdf_compatibility(package: &Path, staging: &Path, directory: &Path) -> Result<(), String> {
    if !installed(directory) { return Err("Le moteur QuickLook géré doit être installé avant son correctif PDF.".into()); }
    check_directory(staging)?; check_directory(&directory.join("QuickLook.Plugin"))?;
    let viewer_parent = pdf_viewer_directory(directory); check_directory(&viewer_parent)?;
    let viewer = viewer_parent.join("QuickLook.Plugin.PDFViewer.dll"); let metadata = pdf_compatibility_metadata(directory);
    let ours = pdf_compatibility_owned(directory);
    if fs::symlink_metadata(&metadata).is_ok() && !ours { return Err("Métadonnées PDF QuickLook indépendantes : remplacement refusé.".into()); }
    let current = if regular(&viewer) { Some(file_sha256(&viewer)?) } else if fs::symlink_metadata(&viewer).is_ok() { return Err("Le lecteur PDF QuickLook a été redirigé.".into()); } else { None };
    if !matches!(current.as_deref(), Some(PDF_ORIGINAL_SHA)) && !(ours && matches!(current.as_deref(), None | Some(PDF_COMPAT_DLL_SHA) | Some(PDF_COMPAT_LEGACY_DLL_SHA))) {
        return Err("Le lecteur PDF QuickLook a été modifié indépendamment. Aucun fichier n’a été remplacé.".into());
    }
    let input = verified_archive(package, PDF_COMPAT_SIZE, PDF_COMPAT_SHA)?;
    let mut archive = zip::ZipArchive::new(input).map_err(|_| "Correctif PDF QuickLook illisible.")?;
    let contents = inventory(&mut archive)?;
    if contents.entries != PDF_COMPAT_FILES.len() || contents.bytes > 2 * 1024 * 1024 { return Err("Contenu du correctif PDF QuickLook inattendu.".into()); }
    for name in PDF_COMPAT_FILES { if archive.by_name(name).map_or(true, |entry| entry.is_dir()) { return Err("Correctif PDF QuickLook incomplet.".into()); } }
    let prepared = staging.join("pdf-compat"); fs::create_dir(&prepared).map_err(|_| "Préparation du correctif PDF impossible.")?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| "Correctif PDF QuickLook illisible.")?;
        if !PDF_COMPAT_FILES.contains(&entry.name()) { return Err("Fichier du correctif PDF QuickLook inattendu.".into()); }
        let expected = entry.size(); let mut bytes = Vec::new(); entry.by_ref().take(expected + 1).read_to_end(&mut bytes).map_err(|_| "Correctif PDF QuickLook illisible.")?;
        if bytes.len() as u64 != expected { return Err("Correctif PDF QuickLook incomplet.".into()); } write_new(&prepared.join(entry.name()), &bytes)?;
    }
    if file_sha256(&prepared.join("QuickLook.Plugin.PDFViewer.dll"))? != PDF_COMPAT_DLL_SHA { return Err("Empreinte du lecteur PDF corrigé incorrecte.".into()); }
    let original = if current.as_deref() == Some(PDF_ORIGINAL_SHA) { viewer.clone() } else { metadata.join("original.dll") };
    let mut original_input = verified_archive(&original, 34_304, PDF_ORIGINAL_SHA)?;
    let mut backup = fs::OpenOptions::new().write(true).create_new(true).open(prepared.join("original.dll")).map_err(|_| "Sauvegarde du lecteur PDF impossible.")?;
    std::io::copy(&mut original_input, &mut backup).map_err(|_| "Sauvegarde du lecteur PDF impossible.")?; backup.sync_all().map_err(|_| "Sauvegarde du lecteur PDF impossible.")?; drop(backup); drop(original_input);
    let marker = PdfCompatManifest { id: "quicklook-pdf-compat".into(), version: PDF_COMPAT_VERSION.into(), archive_sha256: PDF_COMPAT_SHA.into(), original_sha256: PDF_ORIGINAL_SHA.into(), patched_sha256: PDF_COMPAT_DLL_SHA.into(), source_commit: SOURCE_COMMIT.into() };
    write_new(&prepared.join("ownership.json"), &serde_json::to_vec(&marker).map_err(|_| "Métadonnées PDF QuickLook invalides.")?)?;
    let _engine_guard = guard_directory(directory)?; let _plugins_guard = guard_directory(&directory.join("QuickLook.Plugin"))?;
    let _viewer_guard = guard_directory(&viewer_parent)?; let _metadata_guard = guard_directory(&directory.join(META))?;
    let retirement = tempfile::Builder::new().prefix("quicklook-pdf-retired-").tempdir_in(directory.parent().ok_or("Stockage QuickLook invalide.")?).map_err(|_| "Préparation du correctif PDF impossible.")?;
    let old_metadata = retirement.path().join("metadata");
    if ours {
        let mut files = Vec::new(); let mut bytes = 0; let mut entries = 0; removal_files(&metadata, &mut files, &mut bytes, &mut entries)?;
        fs::rename(&metadata, &old_metadata).map_err(|_| "Les métadonnées du correctif PDF sont utilisées.".to_string())?;
    }
    if fs::rename(&prepared, &metadata).is_err() {
        if ours && fs::rename(&old_metadata, &metadata).is_err() { let recovery = retirement.keep(); return Err(format!("Métadonnées PDF précédentes conservées : {}", recovery.display())); }
        return Err("Publication du correctif PDF impossible.".into());
    }
    let replacement = staging.join("pdf-viewer-new.dll");
    write_new(&replacement, &fs::read(metadata.join("QuickLook.Plugin.PDFViewer.dll")).map_err(|_| "Lecteur PDF corrigé indisponible.")?)?;
    replace_pdf_viewer(&replacement, &viewer, retirement, current.is_some())?;
    if !pdf_compatibility_installed(directory) { return Err("Le correctif PDF QuickLook est incomplet.".into()); }
    Ok(())
}
fn replace_pdf_viewer(replacement: &Path, viewer: &Path, retirement: tempfile::TempDir, previous_exists: bool) -> Result<(), String> {
    let previous = retirement.path().join("previous.dll");
    if previous_exists { fs::rename(viewer, &previous).map_err(|_| "Le lecteur PDF QuickLook est utilisé. Ferme son aperçu puis réessaie.".to_string())?; }
    if fs::rename(replacement, viewer).is_err() {
        if previous_exists && fs::rename(&previous, viewer).is_err() { let recovery = retirement.keep(); return Err(format!("Lecteur PDF précédent conservé : {}", recovery.display())); }
        return Err("Publication du lecteur PDF corrigé impossible.".into());
    }
    Ok(())
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| "Écriture QuickLook en conflit.")?;
    file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|_| "Écriture QuickLook impossible.".into())
}
fn create_tree(root: &Path, directory: &Path) -> Result<(), String> {
    let relative = directory.strip_prefix(root).map_err(|_| "Extraction hors du module interdite.")?;
    let mut current = root.to_path_buf(); check_directory(&current)?;
    for part in relative.components() { let Component::Normal(part) = part else { return Err("Chemin d’extraction invalide.".into()); }; current.push(part); if !current.exists() { fs::create_dir(&current).map_err(|_| "Création du dossier extrait impossible.")?; } check_directory(&current)?; }
    Ok(())
}
fn removal_files(directory: &Path, files: &mut Vec<PathBuf>, bytes: &mut u64, entries: &mut usize) -> Result<(), String> {
    check_directory(directory)?;
    for entry in fs::read_dir(directory).map_err(|_| "Le module QuickLook ne peut pas être inspecté.")? {
        let path = entry.map_err(|_| "Entrée QuickLook illisible.")?.path(); let meta = fs::symlink_metadata(&path).map_err(|_| "Fichier QuickLook indisponible.")?;
        *entries += 1; if *entries > MAX_FILES { return Err("Le module QuickLook contient trop de fichiers.".into()); }
        if reparse(&meta) { return Err("Un fichier QuickLook a été redirigé. Retrait refusé.".into()); }
        if meta.is_dir() { removal_files(&path, files, bytes, entries)?; }
        else if meta.is_file() { *bytes = bytes.checked_add(meta.len()).ok_or("Module QuickLook trop volumineux.")?; files.push(path); }
        else { return Err("Fichier spécial QuickLook interdit.".into()); }
        if files.len() > MAX_FILES || *bytes > MAX_TOTAL { return Err("Le module QuickLook dépasse les limites de retrait.".into()); }
    }
    Ok(())
}
fn remove_owned(directory: &Path) -> Result<(), String> {
    if !owned(directory) { return Err("Le dossier ne possède pas les métadonnées du module QuickLook. Retrait refusé.".into()); }
    let mut files = Vec::new(); let mut bytes = 0; let mut entries = 0; removal_files(directory, &mut files, &mut bytes, &mut entries)?;
    #[cfg(windows)] let _handles: Vec<fs::File> = {
        use std::os::windows::fs::OpenOptionsExt;
        files.iter().map(|path| fs::OpenOptions::new().access_mode(0x10000).share_mode(7).custom_flags(0x00200000).open(path).map_err(|_| "QuickLook utilise encore ses fichiers. Ferme son aperçu puis réessaie.".to_string())).collect::<Result<_, _>>()?
    };
    // Windows also refuses a parent rename while descendant DELETE handles remain open.
    // These handles only preflight locks; release all of them before retiring the tree.
    #[cfg(windows)] drop(_handles);
    let retired = tempfile::Builder::new().prefix("quicklook-remove-").tempdir_in(directory.parent().unwrap()).map_err(|_| "Préparation du retrait impossible.")?;
    let target = retired.path().join("quicklook");
    fs::rename(directory, &target).map_err(|_| "Le module QuickLook est encore utilisé. Retrait annulé.".to_string())?;
    fs::remove_dir_all(&target).map_err(|_| "QuickLook a été retiré mais certains fichiers temporaires restent verrouillés.".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn archive(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        { let mut zip = zip::ZipWriter::new(file.as_file_mut()); for (name, bytes) in entries { zip.start_file(*name, zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)).unwrap(); zip.write_all(bytes).unwrap(); } zip.finish().unwrap(); }
        file
    }
    #[test]
    fn only_official_https_download_redirects_are_accepted() {
        for value in [ENGINE_URL, SOURCE_URL, OFFICE_URL, OFFICE_SOURCE_URL, "https://release-assets.githubusercontent.com/asset"] { assert!(official_url(&url::Url::parse(value).unwrap())); }
        for value in ["http://github.com/asset", "https://evil.example/asset", "https://github.com.evil.example/asset", "https://user@github.com/asset", "https://github.com:444/asset"] { assert!(!official_url(&url::Url::parse(value).unwrap())); }
    }
    #[test]
    fn archive_paths_reject_windows_aliases_and_traversal() {
        for value in ["../outside", "/absolute", "C:/drive", "a//b", "a/./b", "a/../b", "a:stream", "AUX.txt", "con", "COM1.dll", "folder/name.", "folder/name ", "a\0b"] { assert!(safe_name(value).is_err(), "{value}"); }
        assert_eq!(safe_name("QuickLook.Plugin/file.dll").unwrap().1, "quicklook.plugin/file.dll");
        assert_eq!(safe_name(r"QuickLook.Plugin\file.dll").unwrap().1, "quicklook.plugin/file.dll");
    }
    #[test]
    fn archive_inventory_rejects_case_duplicates_and_file_parent_collisions() {
        for entries in [&[("a.txt", b"one".as_slice()), ("A.TXT", b"two".as_slice())][..], &[("a/b.txt", b"one".as_slice()), (r"A\B.TXT", b"two".as_slice())][..], &[("parent", b"one".as_slice()), ("parent/child", b"two".as_slice())][..], &[("parent/child", b"one".as_slice()), ("parent", b"two".as_slice())][..]] {
            let file=archive(entries); let mut zip=zip::ZipArchive::new(fs::File::open(file.path()).unwrap()).unwrap();assert!(inventory(&mut zip).is_err());
        }
    }
    #[test]
    fn size_and_hash_are_checked_before_extraction_and_no_phantom_install_is_created() {
        let root=tempfile::tempdir().unwrap();let module=Module::new(root.path()).unwrap();assert!(!module.status().installed);
        let file=archive(&[("QuickLook.exe",b"not executable")]).into_temp_path();let path: &Path=file.as_ref();assert!(verified_archive(path,1,ENGINE_SHA).is_err());
        let size=fs::metadata(path).unwrap().len();assert!(verified_archive(path,size,ENGINE_SHA).is_err());assert!(!module.directory().exists());
        assert!(verified_archive(path,size,&hex::encode(Sha256::digest(fs::read(path).unwrap()))).is_ok());
    }
    #[test]
    fn new_does_not_create_module_directories_or_delete_an_external_viewer() {
        let root=tempfile::tempdir().unwrap();let module=Module::new(root.path()).unwrap();assert!(!module.directory().exists());
        let external=root.path().join("QuickLook.exe");fs::write(&external,b"external").unwrap();assert!(remove_owned(root.path()).is_err());assert_eq!(fs::read(external).unwrap(),b"external");
    }
    fn owned_fixture(directory: &Path) {
        fs::create_dir_all(directory.join(META)).unwrap();
        let marker=Manifest{id:"quicklook".into(),version:VERSION.into(),engine_sha256:ENGINE_SHA.into(),source_sha256:SOURCE_SHA.into(),source_commit:SOURCE_COMMIT.into()};
        fs::write(directory.join(META).join("manifest.json"),serde_json::to_vec(&marker).unwrap()).unwrap();
    }
    fn engine_fixture(directory: &Path) {
        owned_fixture(directory);
        for (name, bytes) in [("QuickLook.exe", b"original engine".as_slice()), ("portable.lock", b"".as_slice()), (".notchy-module/LICENSE-GPL.txt", b"GPL".as_slice())] { fs::write(directory.join(name), bytes).unwrap(); }
        fs::File::create(directory.join(META).join("source.zip")).unwrap().set_len(SOURCE_SIZE).unwrap();
        fs::create_dir_all(directory.join("UserData")).unwrap(); fs::write(directory.join("UserData").join("QuickLook.config"), b"original settings").unwrap();
    }
    #[test]
    fn a_previous_engine_reports_office_missing_and_can_download_only_the_extension() {
        let root = tempfile::tempdir().unwrap(); let module = Module::new(root.path()).unwrap();
        let _guards = module.storage(true).unwrap(); engine_fixture(module.directory());
        let status = module.status(); assert!(status.installed && status.removable); assert!(!status.office_installed); assert_eq!(status.office_version, None);
        assert_eq!(status.version.as_deref(), Some(VERSION));
        #[cfg(windows)] { assert!(module.start_install().unwrap()); assert_eq!(module.status().total, OFFICE_TOTAL); }
        let serialized = serde_json::to_value(module.status()).unwrap(); assert_eq!(serialized["officeInstalled"], false); assert!(serialized["officeVersion"].is_null());
    }
    #[test]
    fn an_independent_office_extension_and_redirected_parent_are_never_replaced() {
        let root = tempfile::tempdir().unwrap(); let module = Module::new(root.path()).unwrap();
        let _guards = module.storage(true).unwrap(); engine_fixture(module.directory());
        let target = office_directory(module.directory()); fs::create_dir_all(&target).unwrap();
        let external = target.join("QuickLook.Plugin.OfficeViewer.dll"); fs::write(&external, b"independent plugin").unwrap();
        assert!(check_office_target(module.directory()).is_err()); assert!(!module.status().office_installed);
        let staging = tempfile::tempdir().unwrap(); let prepared = staging.path().join("office"); fs::create_dir(&prepared).unwrap();
        assert!(publish_office(&prepared, module.directory()).is_err()); assert_eq!(fs::read(&external).unwrap(), b"independent plugin"); assert!(prepared.exists());
        fs::remove_file(&external).unwrap(); fs::remove_dir(&target).unwrap(); fs::remove_dir(target.parent().unwrap()).unwrap();
        fs::write(target.parent().unwrap(), b"not a directory").unwrap(); assert!(check_office_target(module.directory()).is_err());
        assert_eq!(fs::read(target.parent().unwrap()).unwrap(), b"not a directory");
    }
    #[test]
    fn an_unverified_office_archive_does_not_publish_a_plugin_or_modify_the_engine() {
        let root = tempfile::tempdir().unwrap(); let module = Module::new(root.path()).unwrap();
        let _guards = module.storage(true).unwrap(); engine_fixture(module.directory());
        let package = archive(&[("QuickLook.Plugin.OfficeViewer.dll", b"unverified")]); let staging = tempfile::tempdir().unwrap();
        assert!(install_office_archives(package.path(), package.path(), staging.path(), module.directory()).is_err());
        assert!(!office_directory(module.directory()).exists()); assert_eq!(fs::read(module.directory().join("QuickLook.exe")).unwrap(), b"original engine");
        assert_eq!(fs::read(module.directory().join("UserData").join("QuickLook.config")).unwrap(), b"original settings");
    }
    #[test]
    fn a_compatibility_marker_cannot_authorize_replacing_a_foreign_pdf_viewer() {
        let root = tempfile::tempdir().unwrap(); let module = Module::new(root.path()).unwrap();
        let _guards = module.storage(true).unwrap(); engine_fixture(module.directory());
        let viewer_parent = pdf_viewer_directory(module.directory()); fs::create_dir_all(&viewer_parent).unwrap();
        let viewer = viewer_parent.join("QuickLook.Plugin.PDFViewer.dll"); fs::write(&viewer, b"independent PDF viewer").unwrap();
        let metadata = pdf_compatibility_metadata(module.directory()); fs::create_dir(&metadata).unwrap();
        let marker = PdfCompatManifest { id: "quicklook-pdf-compat".into(), version: PDF_COMPAT_VERSION.into(), archive_sha256: PDF_COMPAT_SHA.into(), original_sha256: PDF_ORIGINAL_SHA.into(), patched_sha256: PDF_COMPAT_DLL_SHA.into(), source_commit: SOURCE_COMMIT.into() };
        fs::write(metadata.join("ownership.json"), serde_json::to_vec(&marker).unwrap()).unwrap();
        let package = archive(&[("QuickLook.Plugin.PDFViewer.dll", b"unverified")]); let staging = tempfile::tempdir().unwrap();
        assert!(pdf_compatibility_owned(module.directory())); assert!(!pdf_compatibility_installed(module.directory()));
        assert!(install_pdf_compatibility(package.path(), staging.path(), module.directory()).is_err());
        assert_eq!(fs::read(viewer).unwrap(), b"independent PDF viewer");
    }
    #[test]
    fn the_pinned_previous_compatibility_marker_is_upgradeable_but_unknown_variants_are_not_owned() {
        let root = tempfile::tempdir().unwrap(); let module = Module::new(root.path()).unwrap();
        let _guards = module.storage(true).unwrap(); engine_fixture(module.directory());
        let metadata = pdf_compatibility_metadata(module.directory()); fs::create_dir(&metadata).unwrap();
        let mut marker = PdfCompatManifest { id: "quicklook-pdf-compat".into(), version: "1".into(), archive_sha256: PDF_COMPAT_LEGACY_SHA.into(), original_sha256: PDF_ORIGINAL_SHA.into(), patched_sha256: PDF_COMPAT_LEGACY_DLL_SHA.into(), source_commit: SOURCE_COMMIT.into() };
        let path = metadata.join("ownership.json");
        fs::write(&path, serde_json::to_vec(&marker).unwrap()).unwrap();
        assert!(pdf_compatibility_owned(module.directory())); assert!(!pdf_compatibility_installed(module.directory()));
        marker.patched_sha256 = "0".repeat(64);
        fs::write(&path, serde_json::to_vec(&marker).unwrap()).unwrap(); assert!(!pdf_compatibility_owned(module.directory()));
        marker.patched_sha256 = PDF_COMPAT_LEGACY_DLL_SHA.into(); marker.version = "independent".into();
        fs::write(&path, serde_json::to_vec(&marker).unwrap()).unwrap(); assert!(!pdf_compatibility_owned(module.directory()));
    }
    #[test]
    fn a_failed_pdf_publication_restores_the_previous_viewer() {
        let root = tempfile::tempdir().unwrap(); let viewer = root.path().join("viewer.dll"); fs::write(&viewer, b"previous viewer").unwrap();
        let retirement = tempfile::tempdir_in(root.path()).unwrap();
        assert!(replace_pdf_viewer(&root.path().join("missing replacement.dll"), &viewer, retirement, true).is_err());
        assert_eq!(fs::read(&viewer).unwrap(), b"previous viewer");
    }
    #[test]
    #[ignore = "Explicit offline QA only: requires the already-downloaded official OfficeViewer package and source; never launches QuickLook"]
    fn offline_official_office_archives_upgrade_and_repair_an_existing_engine() {
        let package = PathBuf::from(std::env::var_os("NOTCHY_QUICKLOOK_QA_OFFICE").expect("official cached OfficeViewer archive"));
        let source = PathBuf::from(std::env::var_os("NOTCHY_QUICKLOOK_QA_OFFICE_SOURCE").expect("official cached OfficeViewer source"));
        let compatibility = PathBuf::from(std::env::var_os("NOTCHY_QUICKLOOK_QA_PDF_COMPAT").expect("built PDF compatibility package"));
        let engine = PathBuf::from(std::env::var_os("NOTCHY_QUICKLOOK_QA_ENGINE").expect("official cached engine archive"));
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().join("outputs");
        for path in [&package, &source, &compatibility, &engine] { assert!(fs::canonicalize(path).unwrap().starts_with(fs::canonicalize(&workspace).unwrap())); }
        let root = tempfile::tempdir().unwrap(); let module = Module::new(root.path()).unwrap();
        let _guards = module.storage(true).unwrap(); engine_fixture(module.directory());
        let mut engine_zip = zip::ZipArchive::new(verified_archive(&engine, ENGINE_SIZE, ENGINE_SHA).unwrap()).unwrap();
        let mut original_pdf = None;
        for index in 0..engine_zip.len() {
            let mut entry = engine_zip.by_index(index).unwrap();
            if entry.name().replace('\\', "/") == "QuickLook.Plugin/QuickLook.Plugin.PDFViewer/QuickLook.Plugin.PDFViewer.dll" {
                assert_eq!(entry.size(), 34_304); let mut bytes = Vec::new(); entry.read_to_end(&mut bytes).unwrap(); original_pdf = Some(bytes); break;
            }
        }
        let pdf_parent = pdf_viewer_directory(module.directory()); fs::create_dir_all(&pdf_parent).unwrap();
        fs::write(pdf_parent.join("QuickLook.Plugin.PDFViewer.dll"), original_pdf.expect("official original PDF viewer")).unwrap();
        let engine_marker = fs::read(module.directory().join(META).join("manifest.json")).unwrap();
        let staging = tempfile::tempdir_in(module.directory.parent().unwrap()).unwrap();
        install_office_archives(&package, &source, staging.path(), module.directory()).unwrap();
        assert!(!module.status().office_installed);
        assert_eq!(pending_download_size(module.directory()), 0, "Adding the local PDF compatibility resource must work without re-downloading OfficeViewer");
        install_pdf_compatibility(&compatibility, staging.path(), module.directory()).unwrap();
        assert!(module.status().installed && module.status().office_installed); assert_eq!(module.status().office_version.as_deref(), Some(OFFICE_VERSION));
        assert_eq!(fs::read(module.directory().join(META).join("manifest.json")).unwrap(), engine_marker);
        assert_eq!(fs::read(module.directory().join("QuickLook.exe")).unwrap(), b"original engine");
        let office = office_directory(module.directory()); fs::remove_file(office.join("Syncfusion.Pdf.Base.dll")).unwrap(); assert!(!module.status().office_installed);
        let repair = tempfile::tempdir_in(module.directory.parent().unwrap()).unwrap(); install_office_archives(&package, &source, repair.path(), module.directory()).unwrap();
        assert!(module.status().office_installed); assert!(regular(&office.join(META).join("LICENSE.txt"))); assert!(regular(&office.join(META).join("README.md")));
        fs::remove_file(pdf_compatibility_metadata(module.directory()).join("README.md")).unwrap(); assert!(!module.status().office_installed);
        let repair = tempfile::tempdir_in(module.directory.parent().unwrap()).unwrap(); install_pdf_compatibility(&compatibility, repair.path(), module.directory()).unwrap(); assert!(module.status().office_installed);
        remove_owned(module.directory()).unwrap(); assert!(!module.status().installed && !module.status().office_installed);
    }
    #[test]
    fn an_owned_incomplete_module_can_be_removed_and_retried_without_touching_external_files() {
        let root=tempfile::tempdir().unwrap();let module=Module::new(root.path()).unwrap();let _guards=module.storage(true).unwrap();owned_fixture(module.directory());
        let external=root.path().join("external.txt");fs::write(&external,b"keep").unwrap();
        let status=module.status();assert!(!status.installed);assert!(status.removable);assert_eq!(status.phase,"error");
        remove_owned(module.directory()).unwrap();let status=module.status();assert!(!status.installed&&!status.removable);assert_eq!(status.phase,"idle");
        assert_eq!(fs::read(external).unwrap(),b"keep");
        #[cfg(windows)] assert!(module.start_install().unwrap());
    }
    #[test]
    fn archive_symlinks_and_excessive_expansion_are_rejected() {
        let mut file=tempfile::NamedTempFile::new().unwrap();
        {let mut writer=zip::ZipWriter::new(file.as_file_mut());writer.add_symlink("link","../outside",zip::write::SimpleFileOptions::default()).unwrap();writer.finish().unwrap();}
        let mut zip=zip::ZipArchive::new(fs::File::open(file.path()).unwrap()).unwrap();assert!(inventory(&mut zip).is_err());
        let mut large=tempfile::NamedTempFile::new().unwrap();
        {let mut writer=zip::ZipWriter::new(large.as_file_mut());writer.start_file("zeros",zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();writer.write_all(&vec![0u8;4*1024*1024]).unwrap();writer.finish().unwrap();}
        let mut zip=zip::ZipArchive::new(fs::File::open(large.path()).unwrap()).unwrap();assert!(inventory(&mut zip).is_err());
    }
    #[tokio::test]
    async fn operation_reservation_blocks_removal_and_another_install_before_any_download() {
        let root=tempfile::tempdir().unwrap();let module=Arc::new(Module::new(root.path()).unwrap());let reservation=module.operation.lock().await;
        assert!(module.begin_install().is_err());assert!(module.remove().await.is_err());assert!(!module.directory().exists());drop(reservation);
    }
    #[cfg(windows)]
    #[test]
    fn a_locked_owned_file_fails_removal_before_renaming_or_deleting_anything() {
        use std::os::windows::fs::OpenOptionsExt;
        let root=tempfile::tempdir().unwrap();let module=Module::new(root.path()).unwrap();let _guards=module.storage(true).unwrap();owned_fixture(module.directory());
        let path=module.directory().join("locked.dll");fs::write(&path,b"lock").unwrap();let handle=fs::OpenOptions::new().read(true).share_mode(0).open(&path).unwrap();
        assert!(remove_owned(module.directory()).is_err());assert!(owned(module.directory()));assert_eq!(fs::read(module.directory().join(META).join("manifest.json")).unwrap().len()>0,true);
        drop(handle);remove_owned(module.directory()).unwrap();assert!(!module.directory().exists());
    }
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "Explicit QA only: pass the two already-downloaded official archives under outputs via environment; never launches QuickLook"]
    async fn offline_official_archives_install_and_remove_in_an_isolated_profile() {
        let engine=PathBuf::from(std::env::var_os("NOTCHY_QUICKLOOK_QA_ENGINE").expect("official cached engine archive"));
        let source=PathBuf::from(std::env::var_os("NOTCHY_QUICKLOOK_QA_SOURCE").expect("official cached source archive"));
        let workspace=PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().join("outputs");
        for path in [&engine,&source] { assert!(fs::canonicalize(path).unwrap().starts_with(fs::canonicalize(&workspace).unwrap())); }
        let root=tempfile::tempdir().unwrap();let module=Module::new(root.path()).unwrap();let _guard=module.storage(true).unwrap();
        let staging=tempfile::tempdir_in(module.directory.parent().unwrap()).unwrap();
        let invalid_source=archive(&[("LICENSE-GPL.txt",b"incomplete")]);
        assert!(install_archives(&engine,invalid_source.path(),staging.path(),module.directory()).is_err());assert!(!module.status().installed&&!module.directory().exists());
        install_archives(&engine,&source,staging.path(),module.directory()).unwrap();assert!(module.status().installed);
        assert_eq!(fs::metadata(module.directory.join(META).join("source.zip")).unwrap().len(),SOURCE_SIZE);
        remove_owned(module.directory()).unwrap();assert!(!module.status().installed);
    }
}
