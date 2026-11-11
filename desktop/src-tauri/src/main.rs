#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
struct Operations(Mutex<()>);

fn data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn run(root: &Path, data: &Path, script: &str, args: &[&str]) -> Result<String, String> {
    let result = Command::new(root.join("integrations/macos").join(script))
        .args(args)
        .env("PAIN_DATA_DIR", data)
        .current_dir(root)
        .output()
        .map_err(|e| e.to_string())?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    if result.status.success() {
        Ok(text)
    } else {
        Err(text)
    }
}
#[tauri::command]
async fn control(app: tauri::AppHandle, command: String, value: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Operations>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "Another PAIN operation is in progress.")?;
        let data = data(&app)?;
        let root = data.join("project");
        match command.as_str() {
            "setup" => {
                let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
                // Only packaged application files are copied. Models and .state are not part of the payload.
                copy_tree(&resource.join("payload"), &root)?;
                let archive = resource.join("runtime/pain-macos-runtime-arm64.tar.gz");
                let same_llama = fs::read(data.join("runtime/current/llama-revision")).ok()
                    == fs::read(root.join("containers/virtgpu/llama-revision")).ok();
                let same_virgl = fs::read(data.join("runtime/current/virgl-revision")).ok()
                    == fs::read(root.join("integrations/macos/virgl-revision")).ok();
                if !data.join("runtime/current").exists() || !same_llama || !same_virgl {
                    run(
                        &root,
                        &data,
                        "install-runtime",
                        &[archive.to_str().ok_or("Invalid runtime path")?],
                    )?;
                }
                run(&root, &data, "setup", &[])
            }
            "up" => run(&root, &data, "ai", &["up", "llamacpp-metal"]),
            "down" => run(&root, &data, "ai", &["down"]),
            "logs" => run(&root, &data, "ai", &["logs", "--once"]),
            "download" => {
                if !value.starts_with("https://") {
                    return Err("Use an HTTPS GGUF download URL.".into());
                }
                run(&root, &data, "ai", &["add-model", &value])
            }
            _ => Err("Unsupported operation".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn snapshot(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime_ready = data(&app)?.join("runtime/current").exists();
        let mut result = json!({"online":false,"backend":"llamacpp-metal","engine":"llama.cpp","runtimeReady":runtime_ready,"model_alias":"","inference":{}});
        let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build().map_err(|e|e.to_string())?;
        let healthy = client.get("http://127.0.0.1:11434/health").send().map(|r|r.status().is_success()).unwrap_or(false);
        result["online"] = json!(healthy);
        if healthy {
            if let Ok(response) = client.get("http://127.0.0.1:11434/models").send() {
                if let Ok(models) = response.json::<Value>() {
                    if let Some(model) = loaded_model(&models) {
                        result["model_alias"] = json!(model);
                        if let Ok(response) = client.get("http://127.0.0.1:11434/slots").query(&[("model", model)]).send() {
                            if let Ok(slots) = response.json::<Value>() {
                                if let Some(slots) = slots.as_array() {
                                    if let Some(slot) = slots.iter().find(|s|s["is_processing"] == true).or_else(||slots.first()) {
                                        result["inference"] = json!({
                                            "n_ctx":slot["n_ctx"],"prompt":slot["n_prompt_tokens"],
                                            "decoded":slot["next_token"][0]["n_decoded"],
                                            "processing":slot["is_processing"]
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(result)
    }).await.map_err(|e|e.to_string())?
}
fn loaded_model(models: &Value) -> Option<&str> {
    models["data"].as_array()?.iter().find(|model| {
        model["loaded"] == true
            || model["status"] == "loaded"
            || model["status"]["value"] == "loaded"
    })?["id"]
        .as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn available_presets_are_not_reported_as_loaded() {
        assert_eq!(
            loaded_model(&json!({"data":[{"id":"available","status":{"value":"unloaded"}}]})),
            None
        );
        assert_eq!(
            loaded_model(
                &json!({"data":[{"id":"available"},{"id":"active","status":{"value":"loaded"}}]})
            ),
            Some("active")
        );
    }
}
fn main() {
    tauri::Builder::default()
        .manage(Operations(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![control, snapshot])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open PAIN", true, None::<&str>)?;
            let quit = MenuItem::with_id(
                app,
                "quit",
                "Quit PAIN (keep inference running)",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .title("PAIN")
                .tooltip("Private AI Network")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("PAIN failed to launch");
}
