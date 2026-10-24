use std::{env, fs, path::{Path, PathBuf}, process::Command};

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
    println!("cargo:rerun-if-changed={}", root.join("scripts/frontend-manifest.json").display());
    println!("cargo:rerun-if-changed={}", root.join("scripts/build-frontend.cjs").display());
    println!("cargo:rerun-if-changed={}", root.join("scripts/checkpoint-trial.cjs").display());
    println!("cargo:rerun-if-changed={}", root.join("scripts/check-storage.cjs").display());
    println!("cargo:rerun-if-changed={}", root.join("scripts/storage-policy.json").display());
    println!("cargo:rerun-if-env-changed=NOTCHY_NODE");
    // Preserve the native reparse-point guard before the shared builder replaces dist.
    if fs::symlink_metadata(&dist).is_ok() {
        assert_plain_tree(&dist);
        assert_eq!(dist.canonicalize().unwrap(), root.join("dist"));
        assert!(dist.is_dir(), "Generated dist must be a directory");
    }
    let output = Command::new(env::var_os("NOTCHY_NODE").unwrap_or_else(|| "node".into()))
        // Node resolves a relative entry from cwd; Rust's Windows verbatim paths are not valid CLI entries.
        .arg("scripts/build-frontend.cjs").arg("--cargo").current_dir(&root)
        .output().expect("Node.js is required to build the frontend (set NOTCHY_NODE to its executable path)");
    assert!(output.status.success(), "Frontend build failed:\n{}", String::from_utf8_lossy(&output.stderr));
    print!("{}", String::from_utf8_lossy(&output.stdout));
    assert_plain_tree(&dist);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["desktop_command", "health_run", "settings_get", "settings_set", "favorites_list", "favorites_add", "discovery_validate", "discovery_scan", "discovery_first_candidates"])
    )).unwrap();
}
