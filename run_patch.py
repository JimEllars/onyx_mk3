import re

with open("rust/crates/tools/src/lib.rs", "r") as f:
    content = f.read()

content = re.sub(
    r'let res = tokio::runtime::Runtime::new\(\)\s*\.unwrap\(\)\s*\.block_on\(\s*(.*?)\s*\);\s*serde_json::to_string\(&res\)',
    r'let res = tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(\1));\n            serde_json::to_string(&res)',
    content,
    flags=re.DOTALL
)

content = content.replace("execute_verify_url_status(input));", "execute_verify_url_status(input)));")
content = content.replace("execute_escalate_to_admin(input));", "execute_escalate_to_admin(input)));")
content = content.replace("execute_trigger_marketing_loop(input));", "execute_trigger_marketing_loop(input)));")
content = content.replace("execute_reconcile_micro_app_revenue(input));", "execute_reconcile_micro_app_revenue(input)));")
content = content.replace("execute_dispatch_secure_message(input));", "execute_dispatch_secure_message(input)));")
content = content.replace("execute_dispatch_executive_brief(input));", "execute_dispatch_executive_brief(input)));")

with open("rust/crates/tools/src/lib.rs", "w") as f:
    f.write(content)

with open("rust/crates/commands/src/lib.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")

with open("rust/crates/commands/src/lib.rs", "w") as f:
    f.write(content)

with open("rust/crates/onyx/tests/cli_flags_and_config_defaults.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")
content = content.replace("Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")));", "Session::new().with_workspace_root(root);")

with open("rust/crates/onyx/tests/cli_flags_and_config_defaults.rs", "w") as f:
    f.write(content)

with open("rust/crates/onyx/tests/resume_slash_commands.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")
content = content.replace("Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))", "Session::new().with_workspace_root(&temp_dir)")
content = content.replace("Session::new().with_workspace_root(&temp_dir).with_persistence_path", "Session::new().with_workspace_root(&project_dir).with_persistence_path")

content = content.replace("Session::load_from_path(&session_path).expect(\"cleared session should load\");", "{\n        let previous_cwd = std::env::current_dir().unwrap();\n        std::env::set_current_dir(&temp_dir).unwrap();\n        let res = Session::load_from_path(&session_path).expect(\"cleared session should load\");\n        std::env::set_current_dir(previous_cwd).unwrap();\n        res\n    };")
content = content.replace("Session::load_from_path(&backup_path).expect(\"backup session should load\");", "{\n        let previous_cwd = std::env::current_dir().unwrap();\n        std::env::set_current_dir(&temp_dir).unwrap();\n        let res = Session::load_from_path(&backup_path).expect(\"backup session should load\");\n        std::env::set_current_dir(previous_cwd).unwrap();\n        res\n    };")
content = content.replace("Session::load_from_path(&session_path).expect(\"session should load\");", "{\n        let previous_cwd = std::env::current_dir().unwrap();\n        std::env::set_current_dir(&root).unwrap();\n        let res = Session::load_from_path(&session_path).expect(\"session should load\");\n        std::env::set_current_dir(previous_cwd).unwrap();\n        res\n    };")


with open("rust/crates/onyx/tests/resume_slash_commands.rs", "w") as f:
    f.write(content)

with open("rust/crates/runtime/src/conversation.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")

with open("rust/crates/runtime/src/conversation.rs", "w") as f:
    f.write(content)

with open("rust/crates/runtime/src/compact.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")

with open("rust/crates/runtime/src/compact.rs", "w") as f:
    f.write(content)

with open("rust/crates/runtime/src/session_control.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")

with open("rust/crates/runtime/src/session_control.rs", "w") as f:
    f.write(content)

with open("rust/crates/runtime/src/usage.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")

with open("rust/crates/runtime/src/usage.rs", "w") as f:
    f.write(content)

with open("rust/crates/onyx/src/main.rs", "r") as f:
    content = f.read()

content = content.replace("Session::new()", "Session::new().with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))")
content = content.replace("with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\"))).with_workspace_root", "with_workspace_root")
content = content.replace("with_workspace_root(env::current_dir()?).with_workspace_root(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(\".\")))", "with_workspace_root(env::current_dir()?)")

content = content.replace("    Doctor {\n        output_format: CliOutputFormat,\n    },", "    Doctor {\n        output_format: CliOutputFormat,\n    },\n    State {\n        output_format: CliOutputFormat,\n    },")
content = content.replace("\"doctor\" => Ok(CliAction::Doctor { output_format }),", "\"doctor\" => Ok(CliAction::Doctor { output_format }),\n        \"state\" => Ok(CliAction::State { output_format }),")
content = content.replace("CliAction::Doctor { output_format } => print_doctor(output_format),", "CliAction::Doctor { output_format } => print_doctor(output_format),\n        CliAction::State { output_format } => print_state(output_format),")

print_state_func = """
fn print_state(output_format: CliOutputFormat) -> Result<(), Box<dyn std::error::Error>> {
    let cwd = std::env::current_dir()?;
    let state_path = cwd.join(".claw").join("worker-state.json");
    if state_path.exists() {
        let raw = std::fs::read_to_string(&state_path)?;
        if output_format == CliOutputFormat::Json {
            println!("{}", raw);
        } else {
            let value: serde_json::Value = serde_json::from_str(&raw)?;
            println!("Worker ID: {}", value["worker_id"].as_str().unwrap_or("unknown"));
            println!("Status: {}", value["status"].as_str().unwrap_or("unknown"));
            println!("Ready: {}", value["is_ready"].as_bool().unwrap_or(false));
            println!("Trust Cleared: {}", value["trust_gate_cleared"].as_bool().unwrap_or(false));
            println!("Prompt In Flight: {}", value["prompt_in_flight"].as_bool().unwrap_or(false));
            println!("Seconds Since Update: {}", value["seconds_since_update"].as_u64().unwrap_or(0));
            println!("Is Sub Agent: {}", value["is_sub_agent"].as_bool().unwrap_or(false));
        }
    } else {
        if output_format == CliOutputFormat::Json {
            println!("{{\\"error\\": \\"no worker state found in current directory\\"}}");
        } else {
            println!("No worker state found in current directory (.claw/worker-state.json)");
        }
    }
    Ok(())
}
"""

content = content.replace("fn print_doctor(", print_state_func + "\nfn print_doctor(")

with open("rust/crates/onyx/src/main.rs", "w") as f:
    f.write(content)

