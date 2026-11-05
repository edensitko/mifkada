fn main() {
    // הפקודות של הגשר לשרת: מקבלות הרשאות allow-net-open וכו' שמוגדרות ב-capabilities/default.json
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["net_open", "net_send", "net_close"])),
    )
    .expect("tauri build");
}
