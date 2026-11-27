// macOS app menu. Tauri's default one binds ⌘W to Close Window, which would swallow the key before
// the webview sees it; here File holds the tab commands instead (⌘T, ⌘W, ⌥⌘W, like Postman) and
// Close Window moves to ⇧⌘W. The other Postman keys with a natural menu home are here too (Settings ⌘,,
// Send ⌘↵, Reopen Closed Tab ⇧⌘T, next / previous tab ⇧⌘] / ⇧⌘[, Toggle Sidebar ⌘\, Search Requests ⌘K,
// zoom, Keyboard Shortcuts ⌘/), so they show in the menu. Windows and Linux draw the same menus in the
// window (`AppMenu`): keep the two in step. Commands reach the UI as a "menu" event carrying the item id.
// Keys without a menu item (⌘1–⌘9, ⌘L) and every key on other platforms are caught by the UI.

use tauri::menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg = app.package_info();
    let about = AboutMetadata { name: Some(pkg.name.clone()), version: Some(pkg.version.to_string()), ..Default::default() };
    let sep = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                pkg.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &sep()?,
                    &MenuItem::with_id(app, "app:settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
                    &sep()?,
                    &PredefinedMenuItem::services(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &MenuItem::with_id(app, "tab:new", "New Request", true, Some("CmdOrCtrl+T"))?,
                    &MenuItem::with_id(app, "tab:save", "Save", true, Some("CmdOrCtrl+S"))?,
                    &MenuItem::with_id(app, "request:send", "Send", true, Some("CmdOrCtrl+Enter"))?,
                    &sep()?,
                    &MenuItem::with_id(app, "tab:reopen", "Reopen Closed Tab", true, Some("Shift+CmdOrCtrl+T"))?,
                    &MenuItem::with_id(app, "tab:close", "Close Tab", true, Some("CmdOrCtrl+W"))?,
                    &MenuItem::with_id(app, "tab:force-close", "Force Close Tab", true, Some("Alt+CmdOrCtrl+W"))?,
                    &MenuItem::with_id(app, "window:close", "Close Window", true, Some("Shift+CmdOrCtrl+W"))?,
                ],
            )?,
            // Without Edit, copy / paste / select all stop working in the webview's inputs.
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &sep()?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &MenuItem::with_id(app, "view:zoom-reset", "Actual Size", true, Some("CmdOrCtrl+0"))?,
                    &MenuItem::with_id(app, "view:zoom-in", "Zoom In", true, Some("CmdOrCtrl+="))?,
                    &MenuItem::with_id(app, "view:zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
                    &sep()?,
                    &MenuItem::with_id(app, "view:toggle-sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+Backslash"))?,
                    &MenuItem::with_id(app, "view:search", "Search Requests", true, Some("CmdOrCtrl+K"))?,
                    &sep()?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &MenuItem::with_id(app, "tab:next", "Show Next Tab", true, Some("Shift+CmdOrCtrl+BracketRight"))?,
                    &MenuItem::with_id(app, "tab:prev", "Show Previous Tab", true, Some("Shift+CmdOrCtrl+BracketLeft"))?,
                    &sep()?,
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Help",
                true,
                &[
                    &MenuItem::with_id(app, "app:shortcuts", "Keyboard Shortcuts", true, Some("CmdOrCtrl+Slash"))?,
                    &sep()?,
                    // Same item as on Windows / Linux: opens Settings → General, which holds About.
                    &MenuItem::with_id(app, "app:about", "About Zenar", true, None::<&str>)?,
                ],
            )?,
        ],
    )
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, e: MenuEvent) {
    let id = e.id().as_ref();
    if id == "window:close" {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.close();
        }
    } else if ["tab:", "request:", "view:", "app:"].iter().any(|p| id.starts_with(p)) {
        let _ = app.emit("menu", id);
    }
}
