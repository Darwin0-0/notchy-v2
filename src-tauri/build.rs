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
    let mut assets = vec!["index.html", "notch.css", "notch.js", "focus.js", "welcome.js", "assets/manrope-latin.woff2", "assets/manrope-OFL.txt", "assets/dancing-script.ttf", "assets/dancing-script-OFL.txt", "assets/aref-ruqaa.ttf", "assets/aref-ruqaa-OFL.txt"];
    if root.join("focus-lab.html").is_file() { assets.push("focus-lab.html"); }
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
        tauri_build::AppManifest::new().commands(&["desktop_command"])
    )).unwrap();
}
