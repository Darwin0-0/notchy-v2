use std::{env, fs, path::{Path, PathBuf}};

fn assert_plain_tree(path: &Path) {
    let metadata = fs::symlink_metadata(path).unwrap();
    assert!(!metadata.file_type().is_symlink(), "Generated dist must not contain links");
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        assert_eq!(metadata.file_attributes() & 0x400, 0, "Generated dist must not contain reparse points");
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).unwrap() {
            assert_plain_tree(&entry.unwrap().path());
        }
    }
}

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().canonicalize().unwrap();
    let dist = root.join("dist");
    let assets = vec!["index.html", "tokens.css", "tokens.js", "ia.css", "ia.js", "empty-states.css", "empty-states.js", "notch.css", "welcome.css", "experience.css", "experience-polish.css", "focus-experience.css", "sharing-experience.css", "experience.js", "sharing-experience.js", "i18n.js", "notch.js", "focus.js", "welcome.js", "assets/manrope-latin.woff2", "assets/manrope-OFL.txt"];
    let assets = assets.into_iter().chain(["search.css", "search.js", "module-runtime.js", "module-library.js", "module-library.css", "calendar.js", "calendar.css"]).collect::<Vec<_>>();
    for name in assets.iter().copied().chain(["assets/spotify.ico"]) {
        let input = root.join(name).canonicalize().unwrap();
        assert!(input.starts_with(&root), "Public UI input must stay inside the project");
        assert!(input.is_file(), "Public UI input must be a file");
        println!("cargo:rerun-if-changed={}", input.display());
    }
    // Rebuild only this generated directory, so a stale asset cannot enter the executable.
    if fs::symlink_metadata(&dist).is_ok() {
        assert_plain_tree(&dist);
        assert_eq!(dist.canonicalize().unwrap(), root.join("dist"));
        assert!(dist.is_dir(), "Generated dist must be a directory");
        fs::remove_dir_all(&dist).unwrap();
    }
    fs::create_dir_all(dist.join("assets")).unwrap();
    for name in assets {
        fs::copy(root.join(name), dist.join(name)).unwrap();
    }
    fs::copy(root.join("assets/spotify.ico"), dist.join("spotify.ico")).unwrap();
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["desktop_command", "health_run", "settings_get", "settings_set", "favorites_list", "favorites_add", "discovery_validate", "discovery_scan", "discovery_first_candidates"])
    )).unwrap();
}
