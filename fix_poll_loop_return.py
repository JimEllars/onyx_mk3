import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

target = """    }
    })
}"""

replacement = """    }
    })
}"""

if target in content:
    print("Already fine")
