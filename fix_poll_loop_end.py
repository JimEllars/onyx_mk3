import re

with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
    content = f.read()

# Add `})` before `#[cfg(test)]`
target = """    }
}

#[cfg(test)]
mod tests {"""

replacement = """    }
    })
}

#[cfg(test)]
mod tests {"""

if target in content:
    content = content.replace(target, replacement)
    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(content)
    print("Fixed poll loop end")
