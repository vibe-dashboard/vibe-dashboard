use std::{fs, path::Path, process::Command};

fn main() {
    // Load .env from the workspace root
    let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let env_file = workspace_root.join(".env");
    dotenv::from_path(&env_file).ok();

    // Re-run build script when these env vars or .env file change
    println!("cargo:rerun-if-env-changed=POSTHOG_API_KEY");
    println!("cargo:rerun-if-env-changed=POSTHOG_API_ENDPOINT");
    println!("cargo:rerun-if-env-changed=VK_SHARED_API_BASE");
    println!("cargo:rerun-if-env-changed=SENTRY_DSN");
    println!("cargo:rerun-if-env-changed=VK_BUILD_COMMIT_HASH");
    if env_file.exists() {
        println!("cargo:rerun-if-changed={}", env_file.display());
    }
    emit_git_rerun_if_changed(&workspace_root);

    if let Ok(api_key) = std::env::var("POSTHOG_API_KEY") {
        println!("cargo:rustc-env=POSTHOG_API_KEY={}", api_key);
    }
    if let Ok(api_endpoint) = std::env::var("POSTHOG_API_ENDPOINT") {
        println!("cargo:rustc-env=POSTHOG_API_ENDPOINT={}", api_endpoint);
    }
    if let Ok(vk_shared_api_base) = std::env::var("VK_SHARED_API_BASE") {
        println!("cargo:rustc-env=VK_SHARED_API_BASE={}", vk_shared_api_base);
    }
    if let Ok(vk_shared_relay_api_base) = std::env::var("VK_SHARED_RELAY_API_BASE") {
        println!(
            "cargo:rustc-env=VK_SHARED_RELAY_API_BASE={}",
            vk_shared_relay_api_base
        );
    }
    if let Some(commit_hash) = env_commit_hash().or_else(|| git_commit_hash(&workspace_root)) {
        println!("cargo:rustc-env=VK_BUILD_COMMIT_HASH={}", commit_hash);
    }

    // Create packages/local-web/dist directory if it doesn't exist
    let dist_path = Path::new("../../packages/local-web/dist");
    if !dist_path.exists() {
        println!("cargo:warning=Creating dummy packages/local-web/dist directory for compilation");
        fs::create_dir_all(dist_path).unwrap();

        // Create a dummy index.html
        let dummy_html = r#"<!DOCTYPE html>
<html><head><title>Build web app first</title></head>
<body><h1>Please build @vibe/local-web first</h1></body></html>"#;

        fs::write(dist_path.join("index.html"), dummy_html).unwrap();
    }
}

fn env_commit_hash() -> Option<String> {
    std::env::var("VK_BUILD_COMMIT_HASH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn git_commit_hash(workspace_root: &Path) -> Option<String> {
    git_output(workspace_root, &["rev-parse", "--short=12", "HEAD"])
}

fn emit_git_rerun_if_changed(workspace_root: &Path) {
    if let Some(head_path) = git_output(workspace_root, &["rev-parse", "--git-path", "HEAD"]) {
        println!(
            "cargo:rerun-if-changed={}",
            workspace_root.join(head_path).display()
        );
    }

    if let Some(ref_name) = git_output(workspace_root, &["symbolic-ref", "-q", "HEAD"])
        && let Some(ref_path) = git_output(workspace_root, &["rev-parse", "--git-path", &ref_name])
    {
        println!(
            "cargo:rerun-if-changed={}",
            workspace_root.join(ref_path).display()
        );
    }

    if let Some(packed_refs_path) =
        git_output(workspace_root, &["rev-parse", "--git-path", "packed-refs"])
    {
        println!(
            "cargo:rerun-if-changed={}",
            workspace_root.join(packed_refs_path).display()
        );
    }
}

fn git_output(workspace_root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(workspace_root)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!value.is_empty()).then_some(value)
}
