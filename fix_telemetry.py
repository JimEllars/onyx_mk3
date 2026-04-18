import sys

content = open("rust/crates/onyx/src/main.rs", "r").read()

search = """                let workspace = runtime::ProjectContext::detect_workspace(std::env::current_dir().unwrap_or_default()).unwrap_or_default();
                let config_home = runtime::ProjectContext::config_home();
                let loader = runtime::ConfigLoader::new(&workspace, &config_home);
                let runtime_config = loader.load().unwrap_or_default();"""

replace = """                let workspace = runtime::ProjectContext::discover(std::env::current_dir().unwrap_or_default(), "unknown").unwrap_or_else(|_| runtime::ProjectContext::new(std::env::current_dir().unwrap_or_default(), "unknown"));
                let loader = runtime::ConfigLoader::new(workspace.workspace_root(), workspace.config_home());
                let runtime_config = loader.load().unwrap_or_else(|_| runtime::RuntimeConfig::new(runtime::ConfigSource::Empty));"""

content = content.replace(search, replace)
with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)
