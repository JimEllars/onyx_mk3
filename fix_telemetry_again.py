import sys

content = open("rust/crates/onyx/src/main.rs", "r").read()

search = """                let workspace = runtime::ProjectContext::discover(std::env::current_dir().unwrap_or_default(), "unknown").unwrap_or_else(|_| runtime::ProjectContext::discover(std::env::current_dir().unwrap_or_default(), "unknown").unwrap());
                let loader = runtime::ConfigLoader::new(workspace.workspace_root(), workspace.config_home());
                let runtime_config = loader.load().unwrap_or_else(|_| runtime::RuntimeConfig::new(runtime::ConfigSource::Empty));"""

# Actually looking at rust/crates/onyx/src/main.rs:8495 it has:
# let config_home = root.join("config-home");
# let workspace = temp_dir();
# loader = ConfigLoader::new(&workspace, &config_home);

replace = """                let workspace_root = std::env::current_dir().unwrap_or_default();
                let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".onyx"));
                let loader = runtime::ConfigLoader::new(&workspace_root, &config_home_dir);
                let runtime_config = loader.load().unwrap_or_else(|_| runtime::RuntimeConfig::empty());"""

content = content.replace("""                let workspace = runtime::ProjectContext::discover(std::env::current_dir().unwrap_or_default(), "unknown").unwrap_or_else(|_| runtime::ProjectContext::new(std::env::current_dir().unwrap_or_default(), "unknown"));
                let loader = runtime::ConfigLoader::new(workspace.workspace_root(), workspace.config_home());
                let runtime_config = loader.load().unwrap_or_else(|_| runtime::RuntimeConfig::new(runtime::ConfigSource::Empty));""", replace)

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
