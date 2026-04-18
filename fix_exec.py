import sys

content = open("rust/crates/runtime/src/fleet_health.rs", "r").read()

search = """            let mut exec_status = "Failed";
            let mut exec_details = "Unknown error".to_string();"""

replace = """            let mut exec_status = "Failed";
            let mut exec_details: String = "Unknown error".to_string();"""

content = content.replace(search, replace)
with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
    f.write(content)
