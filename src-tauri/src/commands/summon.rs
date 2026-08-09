//! Menu-bar presence and a system-wide summon shortcut.
//!
//! Both are opt-in and both resolve to the same action: bring a LAF Agent
//! window to the front, creating one if every window is closed.
//!
//! # Why opt-in
//!
//! A status item the user did not ask for is clutter in a bar that is already
//! crowded, and a global shortcut is taken from *every* other application
//! while it is registered — pick a common combination and the user loses it in
//! their editor with no clue why. Neither is on by default.

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use super::error::AppError;
use super::settings::SettingsState;

/// The one tray icon, if the user asked for one.
const TRAY_ID: &str = "laf-agent-tray";

/// Bring a window forward, creating one when the app is running window-less.
///
/// Prefers `main`, then any other window, so summoning twice does not scatter
/// new windows across the desktop.
pub fn summon_window(app: &AppHandle) {
    let existing = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());

    match existing {
        Some(window) => {
            // A minimized window stays hidden behind `set_focus` alone.
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        None => crate::create_new_window(app),
    }
    // Without this the window rises but the app stays in the background, so
    // keystrokes still go to whatever the user was in.
    #[cfg(target_os = "macos")]
    activate_app();
}

/// Pull the whole application to the front, not just the window.
#[cfg(target_os = "macos")]
fn activate_app() {
    use objc2_app_kit::NSApplication;
    let Some(mtm) = objc2::MainThreadMarker::new() else { return };
    let ns_app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    ns_app.activateIgnoringOtherApps(true);
}

/// Install or remove the menu-bar icon to match `enabled`.
///
/// Idempotent: calling it with the state the app is already in does nothing,
/// so the settings screen can call it on every save.
pub fn apply_tray(app: &AppHandle, enabled: bool) -> Result<(), AppError> {
    let existing = app.tray_by_id(TRAY_ID);
    match (enabled, existing) {
        (true, Some(_)) | (false, None) => Ok(()),
        (false, Some(_)) => {
            app.remove_tray_by_id(TRAY_ID);
            Ok(())
        }
        (true, None) => {
            let show = MenuItemBuilder::with_id("tray_show", "Open LAF Agent").build(app)?;
            let new_window = MenuItemBuilder::with_id("tray_new_window", "New Window").build(app)?;
            let quit = MenuItemBuilder::with_id("tray_quit", "Quit LAF Agent").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &new_window])
                .separator()
                .item(&quit)
                .build()?;

            let mut builder = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                // The menu belongs on right-click; a left click should summon
                // directly, which is what every other menu-bar app does.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().0.as_str() {
                    "tray_show" => summon_window(app),
                    "tray_new_window" => crate::create_new_window(app),
                    "tray_quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        summon_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                builder = builder.icon(icon).icon_as_template(true);
            }
            builder.build(app)?;
            Ok(())
        }
    }
}

/// Register `shortcut` as the summon hotkey, replacing any previous one.
///
/// `None` (or a blank string) unregisters and leaves the combination to other
/// applications. A combination the OS rejects — already taken, or not a legal
/// accelerator — surfaces as an error rather than failing silently, because a
/// hotkey that quietly does nothing is indistinguishable from a broken app.
pub fn apply_shortcut(app: &AppHandle, shortcut: Option<&str>) -> Result<(), AppError> {
    let gs = app.global_shortcut();
    // Drop the previous binding first: re-registering a held combination fails,
    // and unregister_all is the only way to clear one we no longer know.
    let _ = gs.unregister_all();

    let Some(accel) = shortcut.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(());
    };

    gs.on_shortcut(accel, |app, _shortcut, event| {
        // Fire once per press. Without the state check the handler also runs on
        // key-up, summoning twice.
        if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            summon_window(app);
        }
    })
    .map_err(|e| {
        AppError::Other(format!(
            "Could not register {accel} as the summon shortcut ({e}). Another app may already own it."
        ))
    })
}

/// Apply both from persisted settings. Called once at startup.
pub fn apply_from_settings(app: &AppHandle) {
    let (icon, shortcut) = {
        let Some(state) = app.try_state::<SettingsState>() else { return };
        let store = state.0.lock();
        (
            store.settings.menu_bar_icon.unwrap_or(false),
            store.settings.summon_shortcut.clone(),
        )
    };
    if let Err(e) = apply_tray(app, icon) {
        log::warn!("[summon] menu-bar icon not installed: {e}");
    }
    if let Err(e) = apply_shortcut(app, shortcut.as_deref()) {
        // Startup must not fail over a hotkey the user can change; the settings
        // screen reports the same error when they next edit it.
        log::warn!("[summon] {e}");
    }
}

/// Re-apply after a settings change. Returns the shortcut error so the UI can
/// tell the user their combination was rejected.
#[tauri::command]
pub fn summon_apply(
    app: AppHandle,
    menu_bar_icon: bool,
    summon_shortcut: Option<String>,
) -> Result<(), AppError> {
    apply_tray(&app, menu_bar_icon)?;
    apply_shortcut(&app, summon_shortcut.as_deref())
}
