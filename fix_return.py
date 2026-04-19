import re

with open("rust/crates/runtime/src/session_control.rs", "r") as f:
    content = f.read()

target = """        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
    });"""

replacement = """        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
    })"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/session_control.rs", "w") as f:
        f.write(content)
    print("Fixed session control return")


with open("rust/crates/runtime/src/team_cron_registry.rs", "r") as f:
    content = f.read()

target = """            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        }
    });"""

replacement = """            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        }
    })"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/team_cron_registry.rs", "w") as f:
        f.write(content)
    print("Fixed team cron return")
