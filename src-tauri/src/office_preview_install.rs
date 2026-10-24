//! Installs only Notchy's optional GPL proxy/worker; the Office renderer stays external.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::{Cursor, Read, Write}, path::{Path, PathBuf}};

const ARCHIVE_SHA: &str = "a5d4a7346b2dd473801dc4211da3b0e6f6fd8306558040c81457466b5260f78a";
const PROXY_SHA: &str = "97076a444c38f91dd8b739e46d49028ca49503a48c99aa9481fe8ec400025334";
const WORKER_SHA: &str = "42841337e2e19ffe2ffc2d45d2066bd3d9a4ac23edd27e6c88b3743284636f41";
const CONFIG_SHA: &str = "de2fefb9ad6d36b36a9f22cc70e000be6e72439b4e0751ca37fcc1564168f630";
const PROXY: &str = "QuickLook.Plugin.NotchyOfficeIsolation.dll";
const WORKER: &str = "NotchyOfficeWorker.exe";
const CONFIG: &str = "NotchyOfficeWorker.exe.config";
const PACKAGE: &str = "NotchyOfficePreview.zip";
const OWN: &str = ".notchy-office-preview-owned.json";
const BROKER_CONFIG: &str = "NotchyBroker.json";
const RESTART: &str = "quicklook-restart-required";
const RESTART_BYTES: &[u8] = b"notchy-office-reload-v1\n";
const OFFICIAL_OFFICE_SHA: &str = "9097ecd1e06c9e36d4e721df5d3927a9e0dde476f4e38d7b1840c03f4f0ce6af";
const MAX_ARCHIVE: u64 = 2 * 1024 * 1024;
const MAX_ENTRY: u64 = 100 * 1024;
type Result<T> = std::result::Result<T, String>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PackageManifest {
    format: u32,
    version: String,
    license: String,
    quicklook_abi: String,
    sha256: BTreeMap<String, String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Ownership {
    format: u32,
    id: String,
    files: BTreeMap<String, String>,
}

fn linked(metadata: &fs::Metadata) -> bool {
    let value = metadata.file_type().is_symlink();
    #[cfg(windows)] { use std::os::windows::fs::MetadataExt; return value || metadata.file_attributes() & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0; }
    #[cfg(not(windows))] { value }
}

fn plain(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir | std::path::Component::CurDir)) {
        return Err("Le moteur Office exige un chemin local absolu.".into());
    }
    #[cfg(windows)] {
        use std::path::{Component, Prefix};
        if !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))) {
            return Err("Le moteur Office exige un chemin local.".into());
        }
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if linked(&metadata) => return Err("Un chemin du moteur Office a été redirigé.".into()),
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err("Un chemin du moteur Office est inaccessible.".into()),
        }
    }
    Ok(())
}

fn regular(path: &Path) -> Result<()> {
    plain(path)?;
    if !fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file() && !linked(&metadata)) {
        return Err("Un fichier du moteur Office est absent ou redirigé.".into());
    }
    Ok(())
}

fn read_limited(path: &Path, maximum: u64) -> Result<Vec<u8>> {
    regular(path)?;
    let file = fs::File::open(path).map_err(|_| "Lecture du moteur Office impossible.")?;
    if file.metadata().map_err(|_| "Lecture du moteur Office impossible.")?.len() > maximum {
        return Err("Un fichier du moteur Office dépasse la limite prévue.".into());
    }
    let mut bytes = Vec::new();
    file.take(maximum + 1).read_to_end(&mut bytes).map_err(|_| "Lecture du moteur Office impossible.")?;
    if bytes.len() as u64 > maximum { return Err("Un fichier du moteur Office dépasse la limite prévue.".into()); }
    Ok(bytes)
}

fn hash(bytes: &[u8]) -> String { hex::encode(Sha256::digest(bytes)) }

fn checked_office(path: &Path) -> Result<()> {
    if hash(&read_limited(path, MAX_ENTRY)?) != OFFICIAL_OFFICE_SHA {
        return Err("Ce moteur OfficeViewer n’est pas la version officielle 6.".into());
    }
    let directory = path.parent().ok_or("Extension OfficeViewer introuvable.")?;
    for (name, size) in crate::quicklook_module::OFFICE_FILES {
        let dependency = directory.join(name); regular(&dependency)?;
        if fs::metadata(&dependency).map_err(|_| "Extension OfficeViewer incomplète.")?.len() != *size {
            return Err("Une dépendance de l’extension OfficeViewer officielle est absente ou incorrecte.".into());
        }
    }
    Ok(())
}

fn resolve_office(candidates: &[PathBuf]) -> Result<PathBuf> {
    candidates.iter().find(|candidate| checked_office(candidate).is_ok()).cloned()
        .ok_or_else(|| "Le moteur OfficeViewer officiel complet, version 6, est requis. Complète le module QuickLook depuis le Market.".into())
}

fn broker_config(path: &Path) -> Result<()> {
    let value: serde_json::Value = serde_json::from_slice(&read_limited(path, 4096)?).map_err(|_| "Configuration du moteur Office invalide.")?;
    let valid = value.as_object().is_some_and(|value| value.len() == 4)
        && value["version"] == "office-isolation-v1"
        && value["pid"].as_u64().is_some_and(|pid| pid > 0 && pid <= u32::MAX as u64)
        && value["pipe"].as_str().is_some_and(|pipe| pipe.starts_with(r"\\.\pipe\Notchy.OfficePreview.") && pipe.len() <= 240)
        && value["secret"].as_str().is_some_and(|secret| secret.len() == 64 && secret.bytes().all(|byte| byte.is_ascii_hexdigit()));
    if !valid { return Err("Configuration du moteur Office invalide.".into()); }
    Ok(())
}

pub(crate) fn broker_running(path: &Path) -> Result<bool> {
    if !path.exists() { return Ok(false); }
    broker_config(path)?;
    let value: serde_json::Value = serde_json::from_slice(&read_limited(path, 4096)?).map_err(|_| "Configuration du moteur Office invalide.")?;
    let pid = value["pid"].as_u64().unwrap() as u32;
    #[cfg(windows)] unsafe {
        use windows_sys::Win32::{Foundation::{CloseHandle, GetLastError, ERROR_INVALID_PARAMETER}, System::Threading::{OpenProcess, GetExitCodeProcess, PROCESS_QUERY_LIMITED_INFORMATION}};
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() { return Ok(GetLastError() != ERROR_INVALID_PARAMETER); }
        let mut code = 0; let checked = GetExitCodeProcess(process, &mut code); CloseHandle(process);
        Ok(checked == 0 || code == 259)
    }
    #[cfg(not(windows))] { Ok(pid == std::process::id()) }
}

fn allowed_entry(name: &str) -> bool {
    matches!(name, PROXY | WORKER | CONFIG | "manifest.json" | "source/Shared.cs" | "source/Proxy.cs" |
        "source/Worker.cs" | "source/Build-OfficePreview.ps1" | "source/README.md" | "source/LICENSE-GPL.txt")
}

fn verify_package(bytes: &[u8], expected: &str) -> Result<BTreeMap<String, Vec<u8>>> {
    if bytes.len() as u64 > MAX_ARCHIVE || hash(bytes) != expected { return Err("L’intégrité du moteur Office n’a pas pu être vérifiée.".into()); }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Archive Office invalide.")?;
    if archive.len() > 30 { return Err("Archive Office trop volumineuse.".into()); }
    let mut entries = BTreeMap::new(); let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| "Archive Office invalide.")?;
        let name = entry.name().to_owned();
        let mode = entry.unix_mode().unwrap_or(0) & 0o170000;
        if !allowed_entry(&name) || entry.is_dir() || !matches!(mode, 0 | 0o100000) || entries.contains_key(&name) || entry.size() > MAX_ENTRY {
            return Err("L’archive Office contient un fichier inattendu.".into());
        }
        total = total.checked_add(entry.size()).ok_or("Archive Office trop volumineuse.")?;
        if total > MAX_ARCHIVE { return Err("Archive Office trop volumineuse.".into()); }
        let expected_size = entry.size(); let mut content = Vec::new();
        entry.by_ref().take(MAX_ENTRY + 1).read_to_end(&mut content).map_err(|_| "Extraction du moteur Office impossible.")?;
        if content.len() as u64 != expected_size { return Err("Archive Office tronquée.".into()); }
        entries.insert(name, content);
    }
    let manifest: PackageManifest = serde_json::from_slice(entries.get("manifest.json").ok_or("Manifeste Office absent.")?).map_err(|_| "Manifeste Office invalide.")?;
    if manifest.format != 1 || manifest.version != "1.0.0" || manifest.license != "GPL-3.0-or-later" || manifest.quicklook_abi != "4.5.0.0" || manifest.sha256.len() + 1 != entries.len() || entries.len() != 10 {
        return Err("La version du moteur Office n’est pas prise en charge.".into());
    }
    for (name, expected) in &manifest.sha256 {
        if !allowed_entry(name) || name == "manifest.json" || entries.get(name).is_none_or(|bytes| hash(bytes) != *expected) {
            return Err("La vérification d’un fichier Office a échoué.".into());
        }
    }
    for (name, expected) in [(PROXY, PROXY_SHA), (WORKER, WORKER_SHA), (CONFIG, CONFIG_SHA)] {
        if manifest.sha256.get(name).map(String::as_str) != Some(expected) { return Err("Le moteur Office ne correspond pas à cette version de Notchy.".into()); }
    }
    Ok(entries)
}

fn directory(path: &Path) -> Result<()> {
    plain(path)?;
    fs::create_dir_all(path).map_err(|_| "Préparation du moteur Office impossible.")?;
    plain(path)?;
    if !fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir() && !linked(&metadata)) { return Err("Le dossier Office a été redirigé.".into()); }
    Ok(())
}

fn owned_files(path: &Path, allowed: &[&str]) -> Result<BTreeMap<String, String>> {
    plain(path)?;
    let bytes = read_limited(&path.join(OWN), 4096).map_err(|_| "Ce dossier Office n’appartient pas à Notchy ; remplacement refusé.")?;
    let marker: Ownership = serde_json::from_slice(&bytes).map_err(|_| "Le marqueur Office est invalide.")?;
    if marker.format != 1 || marker.id != "notchy-office-preview" || marker.files.len() != allowed.len() || marker.files.keys().any(|name| !allowed.contains(&name.as_str())) {
        return Err("Le dossier Office ne correspond pas à une installation Notchy connue.".into());
    }
    let mut count = 0;
    for entry in fs::read_dir(path).map_err(|_| "Dossier Office inaccessible.")? {
        let entry = entry.map_err(|_| "Dossier Office inaccessible.")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == BROKER_CONFIG && allowed.contains(&PROXY) { broker_config(&entry.path())?; continue; }
        if name != OWN && !marker.files.contains_key(&name) { return Err("Le dossier Office contient un fichier étranger ; remplacement refusé.".into()); }
        regular(&entry.path())?; count += 1;
    }
    if count != marker.files.len() + 1 { return Err("L’installation Office est incomplète ; remplacement refusé.".into()); }
    for (name, expected) in &marker.files {
        if hash(&read_limited(&path.join(name), MAX_ARCHIVE)?) != *expected { return Err("Un fichier Office installé a été modifié ; remplacement refusé.".into()); }
    }
    Ok(marker.files)
}

fn clear_stage(path: &Path, names: &[&str]) {
    if plain(path).is_err() { return; }
    for name in names.iter().copied().chain(Some(OWN)) {
        let file = path.join(name);
        if regular(&file).is_ok() { let _ = fs::remove_file(file); }
    }
    if names.contains(&PROXY) && broker_config(&path.join(BROKER_CONFIG)).is_ok() { let _ = fs::remove_file(path.join(BROKER_CONFIG)); }
    let _ = fs::remove_dir(path);
}

fn install_owned(path: &Path, files: &[(&str, &[u8])]) -> Result<()> {
    let parent = path.parent().ok_or("Dossier Office invalide.")?; directory(parent)?; plain(path)?;
    let names: Vec<&str> = files.iter().map(|entry| entry.0).collect();
    let expected: BTreeMap<String, String> = files.iter().map(|(name, bytes)| ((*name).into(), hash(bytes))).collect();
    if path.exists() && owned_files(path, &names)? == expected { return Ok(()); }
    if names.contains(&PROXY) && broker_running(&path.join(BROKER_CONFIG))? {
        return Err("Une autre instance de Notchy utilise ce moteur Office. Ferme-la avant de mettre à jour les aperçus.".into());
    }
    let stage = parent.join(format!(".office-preview-stage-{}", crate::shelf::token()));
    fs::create_dir(&stage).map_err(|_| "Préparation du moteur Office impossible.")?;
    let result = (|| {
        for (name, bytes) in files {
            let mut output = fs::OpenOptions::new().write(true).create_new(true).open(stage.join(name)).map_err(|_| "Écriture du moteur Office impossible.")?;
            output.write_all(bytes).and_then(|_| output.sync_all()).map_err(|_| "Écriture du moteur Office impossible.")?;
        }
        let marker = Ownership { format: 1, id: "notchy-office-preview".into(), files: expected };
        let bytes = serde_json::to_vec(&marker).map_err(|_| "Métadonnées Office invalides.")?;
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(stage.join(OWN)).map_err(|_| "Écriture du marqueur Office impossible.")?;
        output.write_all(&bytes).and_then(|_| output.sync_all()).map_err(|_| "Écriture du marqueur Office impossible.")?; drop(output);
        let backup = parent.join(format!(".office-preview-old-{}", crate::shelf::token()));
        let existed = path.exists();
        if existed { owned_files(path, &names)?; fs::rename(path, &backup).map_err(|_| "Le moteur Office est utilisé ou inaccessible. Ferme ses aperçus puis réessaie.")?; }
        if fs::rename(&stage, path).is_err() {
            if existed && fs::rename(&backup, path).is_err() { return Err("Restauration du moteur Office impossible ; les fichiers précédents sont conservés dans leur dossier de sauvegarde.".into()); }
            return Err("Installation du moteur Office impossible.".into());
        }
        if existed { clear_stage(&backup, &names); if backup.exists() { return Err("Le moteur Office est installé mais sa sauvegarde n’a pas pu être nettoyée.".into()); } }
        Ok(())
    })();
    if stage.exists() { clear_stage(&stage, &names); }
    result
}

/// Returns the worker, unchanged official Office DLL, proxy, and whether its DLL changed.
/// No process is started or stopped here, and foreign plug-in folders are never overwritten.
pub fn prepare(data: &Path, native: &Path, quicklook_exe: &Path) -> Result<(PathBuf, PathBuf, PathBuf, bool)> {
    regular(quicklook_exe)?;
    let quicklook = quicklook_exe.parent().ok_or("QuickLook est introuvable.")?;
    let portable = quicklook.join("portable.lock");
    let plugin_root = if portable.exists() {
        regular(&portable)?; quicklook.join("UserData/QuickLook.Plugin")
    } else {
        let roaming = std::env::var_os("APPDATA").ok_or("Le dossier des extensions QuickLook est introuvable.")?;
        PathBuf::from(roaming).join("pooi.moe/QuickLook/QuickLook.Plugin")
    };
    plain(&plugin_root)?;
    let office_name = "QuickLook.Plugin.OfficeViewer/QuickLook.Plugin.OfficeViewer.dll";
    let mut office_candidates = vec![plugin_root.join(office_name), quicklook.join("QuickLook.Plugin").join(office_name)];
    // Portable QuickLook may coexist with the official v6 installed in the
    // current user's ordinary plug-ins; its bundled COM stub is not this renderer.
    if let Some(roaming) = std::env::var_os("APPDATA") {
        let candidate = PathBuf::from(roaming).join("pooi.moe/QuickLook/QuickLook.Plugin").join(office_name);
        if !office_candidates.contains(&candidate) { office_candidates.push(candidate); }
    }
    let office = resolve_office(&office_candidates)?;
    let package = read_limited(&native.join(PACKAGE), MAX_ARCHIVE)?;
    let entries = verify_package(&package, ARCHIVE_SHA)?;
    let proxy = plugin_root.join("QuickLook.Plugin.NotchyOfficeIsolation");
    let runtime = data.join(".desktop-profile/office-preview/runtime");
    let proxy_changed = if proxy.exists() { owned_files(&proxy, &[PROXY, PACKAGE])?.get(PROXY) != Some(&hash(&entries[PROXY])) } else { true };
    // Retaining the pinned archive beside the proxy also retains all GPL corresponding sources.
    install_owned(&proxy, &[(PROXY, &entries[PROXY]), (PACKAGE, &package)])?;
    install_owned(&runtime, &[(WORKER, &entries[WORKER]), (CONFIG, &entries[CONFIG])])?;
    Ok((runtime.join(WORKER), office, proxy.join(PROXY), proxy_changed))
}

pub fn restart_pending(data: &Path) -> Result<bool> {
    let marker = data.join(".desktop-profile/office-preview").join(RESTART); plain(&marker)?;
    if !marker.exists() { return Ok(false); }
    if read_limited(&marker, 64)? != RESTART_BYTES { return Err("Le marqueur de redémarrage Office est invalide.".into()); }
    Ok(true)
}

pub fn set_restart_pending(data: &Path, required: bool) -> Result<()> {
    let present = restart_pending(data)?;
    if present == required { return Ok(()); }
    let directory_path = data.join(".desktop-profile/office-preview"); directory(&directory_path)?;
    let marker = directory_path.join(RESTART);
    if required {
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(marker).map_err(|_| "Le redémarrage requis ne peut pas être enregistré.")?;
        output.write_all(RESTART_BYTES).and_then(|_| output.sync_all()).map_err(|_| "Le redémarrage requis ne peut pas être enregistré.")?;
    } else { fs::remove_file(marker).map_err(|_| "Le marqueur de redémarrage Office ne peut pas être effacé.")?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pinned_runtime_archive_and_manifest_match_the_packaged_helpers() {
        let bytes = include_bytes!("../../native/bin/NotchyOfficePreview.zip");
        let entries = verify_package(bytes, ARCHIVE_SHA).unwrap();
        assert_eq!(entries.len(), 10);
    }
    #[test]
    fn legacy_com_stub_and_same_sized_foreign_dll_are_never_accepted_as_office_v6() {
        let root = tempfile::tempdir().unwrap();
        let legacy = root.path().join("bundled/QuickLook.Plugin.OfficeViewer.dll");
        let foreign = root.path().join("user/QuickLook.Plugin.OfficeViewer.dll");
        for (path, size) in [(&legacy, 15_872), (&foreign, 13_312)] {
            fs::create_dir_all(path.parent().unwrap()).unwrap(); fs::write(path, vec![0u8; size]).unwrap();
            assert!(checked_office(path).is_err());
        }
        let error = resolve_office(&[legacy, foreign]).unwrap_err();
        assert!(error.contains("version 6") && error.contains("Market"));
    }
    #[test]
    fn restart_requirement_survives_an_app_restart_and_never_removes_foreign_contents() {
        let root = tempfile::tempdir().unwrap(); assert!(!restart_pending(root.path()).unwrap());
        set_restart_pending(root.path(), true).unwrap(); assert!(restart_pending(root.path()).unwrap());
        set_restart_pending(root.path(), true).unwrap(); set_restart_pending(root.path(), false).unwrap();
        assert!(!restart_pending(root.path()).unwrap());
        let marker = root.path().join(".desktop-profile/office-preview").join(RESTART);
        fs::write(&marker, b"foreign").unwrap(); assert!(set_restart_pending(root.path(), false).is_err());
        assert_eq!(fs::read(marker).unwrap(), b"foreign");
    }
    #[test]
    fn broker_configuration_matches_the_runtime_writer_and_rejects_extra_fields() {
        let root = tempfile::tempdir().unwrap(); let config = root.path().join(BROKER_CONFIG);
        let mut value = serde_json::json!({"pipe":format!(r"\\.\pipe\Notchy.OfficePreview.{}", "a".repeat(32)),"secret":"b".repeat(64),"pid":std::process::id(),"version":"office-isolation-v1"});
        fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap(); assert!(broker_config(&config).is_ok());
        value["extra"] = serde_json::json!(true); fs::write(&config, serde_json::to_vec(&value).unwrap()).unwrap(); assert!(broker_config(&config).is_err());
    }
    #[test]
    fn exact_archive_names_reject_traversal_and_foreign_payloads() {
        assert!(allowed_entry(PROXY)); assert!(allowed_entry("source/LICENSE-GPL.txt"));
        for name in ["../NotchyOfficeWorker.exe", "source/../Worker.cs", "source\\Worker.cs", "/Worker.cs", "C:/Worker.cs", "QuickLook.Plugin.OfficeViewer.dll", "source/not-listed.cs"] { assert!(!allowed_entry(name)); }
    }
    #[test]
    fn installer_reuses_own_files_and_refuses_modified_or_foreign_directories() {
        let root = tempfile::tempdir().unwrap(); let target = root.path().join("runtime");
        install_owned(&target, &[(WORKER, b"worker1"), (CONFIG, b"config")]).unwrap();
        install_owned(&target, &[(WORKER, b"worker1"), (CONFIG, b"config")]).unwrap();
        install_owned(&target, &[(WORKER, b"worker2"), (CONFIG, b"config")]).unwrap();
        assert_eq!(fs::read(target.join(WORKER)).unwrap(), b"worker2");
        fs::write(target.join(WORKER), b"foreign replacement").unwrap();
        assert!(install_owned(&target, &[(WORKER, b"worker3"), (CONFIG, b"config")]).is_err());
        assert_eq!(fs::read(target.join(WORKER)).unwrap(), b"foreign replacement");
        let foreign = root.path().join("foreign"); fs::create_dir(&foreign).unwrap();
        assert!(install_owned(&foreign, &[(WORKER, b"worker")]).is_err());
    }
    #[test]
    fn linked_payloads_and_relative_paths_are_rejected() {
        assert!(plain(Path::new("relative/worker.exe")).is_err());
        let root = tempfile::tempdir().unwrap(); let folder = root.path().join("not-a-file"); fs::create_dir(&folder).unwrap();
        assert!(regular(&folder).is_err());
    }
}
