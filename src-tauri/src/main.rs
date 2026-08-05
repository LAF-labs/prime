// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The panic hook installed inside run() handles logging for all threads.
    // If run() itself panics (e.g. Tauri init failure), stderr is the last resort.
    kirodex_lib::run()
}
