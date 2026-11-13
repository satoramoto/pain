#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod host_stats;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::{
    menu::Menu,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
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
        .env("PAIN_RUNTIME", framework(data))
        .env("PAIN_MODELS_DIR", models_dir(data))
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
/// Where model weights live: the folder chosen in the window, else ~/Models.
fn models_dir(data: &Path) -> PathBuf {
    match fs::read_to_string(data.join("models-dir")) {
        Ok(text) if text.trim().starts_with('/') => PathBuf::from(text.trim()),
        _ => PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Models"),
    }
}
/// The VM shares only /Users with the Mac, so the folder must be inside it.
fn models_folder(value: &str) -> Result<PathBuf, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let value = value.trim();
    let path = match value.strip_prefix("~/") {
        Some(rest) => PathBuf::from(home).join(rest),
        None => PathBuf::from(value),
    };
    let plain = path.components().all(|part| matches!(part, std::path::Component::RootDir | std::path::Component::Normal(_)));
    if plain && path.starts_with("/Users") && path.components().count() > 3 {
        Ok(path)
    } else {
        Err("Choose a folder inside your home folder, for example ~/Models.".into())
    }
}
fn framework(data: &Path) -> String {
    match fs::read_to_string(data.join("framework"))
        .as_deref()
        .map(str::trim)
    {
        Ok("docker") => "docker".into(),
        _ => "podman".into(),
    }
}
fn refresh_payload(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
    // Overlay shipped files only: unbundled .state and custom presets remain.
    // Runtime installation is deliberately separate from an application upgrade.
    copy_tree(&resource.join("payload"), root)
}
fn prepare(app: &tauri::AppHandle, data: &Path, root: &Path) -> Result<(), String> {
    let resource = app.path().resource_dir().map_err(|e| e.to_string())?;
    refresh_payload(app, root)?;
    let archive = resource.join("runtime/pain-macos-runtime-arm64.tar.gz");
    let same_llama = fs::read(data.join("runtime/current/llama-revision")).ok()
        == fs::read(root.join("containers/virtgpu/llama-revision")).ok();
    let same_virgl = fs::read(data.join("runtime/current/virgl-revision")).ok()
        == fs::read(root.join("integrations/macos/virgl-revision")).ok();
    if framework(data) == "podman"
        && (!data.join("runtime/current").exists() || !same_llama || !same_virgl)
    {
        run(
            &root,
            &data,
            "install-runtime",
            &[archive.to_str().ok_or("Invalid runtime path")?],
        )?;
    }
    Ok(())
}
fn opencode_config(models: &Value, legacy: bool) -> Result<Value, String> {
    let entries = models["data"]
        .as_array()
        .ok_or("The engine returned no model list.")?;
    let mut available = serde_json::Map::new();
    for model in entries {
        if let Some(id) = model["id"].as_str() {
            available.insert(
                id.into(),
                json!({"name":id,"limit":{"context":32768,"output":4096}}),
            );
        }
    }
    let first = available
        .keys()
        .find(|id| id.starts_with("local-"))
        .or_else(|| available.keys().next())
        .ok_or("No model is available. Download the starter model and retry.")?
        .clone();
    if legacy {
        Ok(
            json!({"$schema":"https://opencode.ai/config.json","model":format!("pain/{first}"),
          "provider":{"pain":{"name":"PAIN local","npm":"@ai-sdk/openai-compatible","options":{"baseURL":"http://127.0.0.1:11434/v1"},"models":available}}}),
        )
    } else {
        Ok(
            json!({"$schema":"https://opencode.ai/config.json","model":format!("pain/{first}"),
          "providers":{"pain":{"name":"PAIN local","package":"@opencode/ai/providers/openai-compatible","settings":{"baseURL":"http://127.0.0.1:11434/v1"},"models":available}}}),
        )
    }
}
#[tauri::command]
async fn onboarding_step(
    app: tauri::AppHandle,
    step: String,
    selected: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !["podman", "docker"].contains(&selected.as_str()) { return Err("Unknown container framework.".into()); }
        if !["dependencies", "machine", "model", "engine", "opencode", "launch"].contains(&step.as_str()) { return Err("Unknown setup step.".into()); }
        let state = app.state::<Operations>();
        let _guard = state.0.try_lock().map_err(|_| "Another PAIN operation is in progress.")?;
        let data = data(&app)?;
        let root = data.join("project");
        fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        if step == "dependencies" {
            if let Ok(owner) = fs::read_to_string(root.join(".state/runtime")) {
                if owner.trim() != selected { return Err("Stop the current engine from the dashboard before changing container frameworks.".into()); }
            }
            let _ = fs::remove_file(data.join("onboarding.complete"));
            fs::write(data.join("framework"), &selected).map_err(|e|e.to_string())?;
            // Stage scripts before installing the system runtime; APIR is unpacked during machine setup.
            refresh_payload(&app, &root)?;
        } else if framework(&data) != selected { return Err("The framework changed. Reopen Getting Started and try again.".into()); }
        if step == "machine" { prepare(&app, &data, &root)?; }
        let result = run(&root, &data, "onboarding", &[&step, &selected])?;
        if step == "opencode" {
            write_opencode_config(&data, &result)?;
            fs::write(data.join("onboarding.complete"), &selected).map_err(|e|e.to_string())?;
        }
        Ok(result)
    }).await.map_err(|e|e.to_string())?
}
/// Point PAIN's private OpenCode config at whatever the engine serves now.
/// `version_output` is what the onboarding `opencode` step printed.
fn write_opencode_config(data: &Path, version_output: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e|e.to_string())?;
    let models = client.get("http://127.0.0.1:11434/v1/models").send().map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?.json::<Value>().map_err(|e|e.to_string())?;
    let version = version_output.split_whitespace().map(|word| word.trim_start_matches('v')).find(|line| line.starts_with("1.") || line.starts_with("2.")).unwrap_or("");
    if !version.starts_with("1.") && !version.starts_with("2.") { return Err("Unrecognized OpenCode version. Expected OpenCode 1 or 2.".into()); }
    let config = opencode_config(&models, version.starts_with("1."))?;
    let temp = data.join("opencode.json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(&config).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    fs::rename(temp, data.join("opencode.json")).map_err(|e|e.to_string())
}
fn preset_name(value: &str) -> Result<&str, String> {
    if !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        Ok(value)
    } else {
        Err("Unknown model.".into())
    }
}
/// Presets with download and selection state. Unlocked so the window can poll
/// download progress while a download holds the operation lock.
#[tauri::command]
async fn models(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = data(&app)?;
        let text = run(&data.join("project"), &data, "ai", &["models", "--json"])?;
        let line = text.lines().rev().find(|line| line.starts_with('[')).ok_or("No model list.")?;
        let rows: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
        Ok(json!({"models": rows, "memoryCapacity": host_stats::memory_capacity()}))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn control(app: tauri::AppHandle, command: String, value: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = data(&app)?;
        let root = data.join("project");
        // Log snapshots are read-only and must not hold the mutation lock.
        if command == "logs" {
            return run(&root, &data, "ai", &["logs", "--once"]);
        }
        let state = app.state::<Operations>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "Another PAIN operation is in progress.")?;
        match command.as_str() {
            "setup" => {
                prepare(&app, &data, &root)?;
                run(&root, &data, "onboarding", &["machine", &framework(&data)])
            }
            "up" => run(
                &root,
                &data,
                "ai",
                &[
                    "up",
                    if framework(&data) == "docker" {
                        "llamacpp-cpu"
                    } else {
                        "llamacpp-metal"
                    },
                ],
            ),
            "fetch" => run(&root, &data, "ai", &["pull", preset_name(&value)?]),
            "remove" => run(&root, &data, "ai", &["remove", preset_name(&value)?, "--yes"]),
            "use" => {
                run(&root, &data, "ai", &["use", preset_name(&value)?])?;
                let started = run(&root, &data, "ai", &["up", if framework(&data) == "docker" { "llamacpp-cpu" } else { "llamacpp-metal" }])?;
                // The served model id changed, so OpenCode's private config must follow.
                if data.join("opencode.json").exists() {
                    let version = run(&root, &data, "onboarding", &["opencode", &framework(&data)])?;
                    write_opencode_config(&data, &version)?;
                }
                Ok(started)
            }
            "folder" => {
                let folder = models_folder(&value)?;
                fs::create_dir_all(&folder).map_err(|e| format!("Cannot use {}: {e}", folder.display()))?;
                // The engine mounts the old folder; stop it before the setting changes.
                let _ = run(&root, &data, "ai", &["down"]);
                fs::write(data.join("models-dir"), folder.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
                Ok(String::new())
            }
            "down" => run(&root, &data, "ai", &["down"]),
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
        let data = data(&app)?;
        let selected = framework(&data);
        let runtime_ready = if selected == "docker" { data.join("project/ai").exists() } else { data.join("runtime/current").exists() };
        let mut result = json!({"online":false,"backend":if selected == "docker" { "llamacpp-cpu" } else { "llamacpp-metal" },"engine":"llama.cpp","runtimeReady":runtime_ready,"modelsDir":models_dir(&data),"framework":selected,"onboarded":data.join("opencode.json").exists() && fs::read_to_string(data.join("onboarding.complete")).ok().as_deref() == Some(selected.as_str()),"model_alias":"","inference":{}});
        if let Some(host) = app.state::<host_stats::Sampler>().snapshot().as_object() {
            result.as_object_mut().unwrap().extend(host.clone());
        }
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
                                    if let Some(slot) = slots.iter().find(|s|s["is_processing"] == true).or_else(||slots.first()).filter(|slot|slot.is_object()) {
                                        let cache_hit_pct = slot["n_prompt_tokens"].as_u64().filter(|prompt| *prompt > 0)
                                            .zip(slot["n_prompt_tokens_cache"].as_u64())
                                            .map(|(prompt, cached)| (cached as f64 / prompt as f64 * 100.0).round_ties_even() as u64);
                                        result["inference"] = json!({
                                            "has_slot":true,"n_ctx":slot["n_ctx"],"prompt":slot["n_prompt_tokens"],
                                            "cached":slot["n_prompt_tokens_cache"],"cache_hit_pct":cache_hit_pct,
                                            "decoded":slot["next_token"][0]["n_decoded"],
                                            "remain":slot["next_token"][0]["n_remain"],
                                            "processing":slot["is_processing"],"speculative":slot["speculative"]
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
    let entries = models["data"].as_array()?;
    // A single-model server (the Metal backend) lists its one model with no load state.
    let stateless = |model: &Value| model.get("status").is_none() && model.get("loaded").is_none();
    if !entries.is_empty() && entries.iter().all(stateless) {
        return entries[0]["id"].as_str();
    }
    entries.iter().find(|model| {
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
    fn local_config_supports_both_opencode_generations() {
        let models = json!({"data":[{"id":"local-starter-default"}]});
        let modern = opencode_config(&models, false).unwrap();
        assert_eq!(modern["model"], "pain/local-starter-default");
        assert_eq!(
            modern["providers"]["pain"]["settings"]["baseURL"],
            "http://127.0.0.1:11434/v1"
        );
        assert!(modern.get("provider").is_none());
        let legacy = opencode_config(&models, true).unwrap();
        assert_eq!(
            legacy["provider"]["pain"]["npm"],
            "@ai-sdk/openai-compatible"
        );
        assert!(legacy.get("providers").is_none());
        assert!(opencode_config(&json!({"data":[]}), false).is_err());
    }
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
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    // The inference engine runs independently of this UI.
    app.exit(0);
}

fn show_popup(window: &tauri::WebviewWindow, rect: tauri::Rect) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let tray_position = rect.position.to_physical::<f64>(scale);
    let tray_size = rect.size.to_physical::<f64>(scale);
    if let Some(monitor) = window.monitor_from_point(tray_position.x, tray_position.y)? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let width = (460.0 * scale).round().min(area.size.width as f64) as u32;
        let height = (850.0 * scale).round().min(area.size.height as f64) as u32;
        window.set_size(tauri::PhysicalSize::new(width, height))?;
        let x = (tray_position.x + tray_size.width / 2.0 - width as f64 / 2.0)
            .clamp(area.position.x as f64, area.position.x as f64 + (area.size.width - width) as f64);
        let y = (tray_position.y + tray_size.height)
            .clamp(area.position.y as f64, area.position.y as f64 + (area.size.height - height) as f64);
        window.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
    }
    window.show()?;
    window.set_focus()
}

fn main() {
    tauri::Builder::default()
        .manage(Operations(Mutex::new(())))
        .manage(host_stats::Sampler::default())
        .invoke_handler(tauri::generate_handler![control, snapshot, onboarding_step, models, quit_app])
        .setup(|app| {
            let directory = data(app.handle()).map_err(std::io::Error::other)?;
            refresh_payload(app.handle(), &directory.join("project"))
                .map_err(std::io::Error::other)?;
            app.set_menu(Menu::default(app.handle())?)?;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            TrayIconBuilder::with_id("brain")
                .icon(tauri::include_image!("./icons/tray-brain.png"))
                .icon_as_template(true)
                .tooltip("Private AI Network")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else if let Err(error) = show_popup(&window, rect) {
                                eprintln!("Cannot show PAIN popup: {error}");
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            if let tauri::WindowEvent::Focused(false) = event {
                // Clicking the brain can blur the window before the click event.
                // Let that click toggle it, rather than hiding then reopening it.
                let over_tray = (|| -> Option<bool> {
                    let rect = window.app_handle().tray_by_id("brain")?.rect().ok()??;
                    let cursor = window.cursor_position().ok()?;
                    let scale = window.scale_factor().ok()?;
                    let position = rect.position.to_physical::<f64>(scale);
                    let size = rect.size.to_physical::<f64>(scale);
                    Some(cursor.x >= position.x && cursor.x < position.x + size.width
                        && cursor.y >= position.y && cursor.y < position.y + size.height)
                })().unwrap_or(false);
                if !over_tray {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("PAIN failed to launch");
}
