#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--notchy-file-worker") {
        notchy::file_tools::worker_main();
        return;
    }
    app::run();
}

mod app;
