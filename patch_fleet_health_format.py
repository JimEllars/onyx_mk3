import re
import sys

def patch():
    with open("rust/crates/runtime/src/fleet_health.rs", "r") as f:
        content = f.read()

    replacement = """
        let _system_prompt = format!(
            "You are an AI DevOps agent. Given the diagnostic: {diagnostic_data:?}\\n\
            And the available tools: {available_tools:?}\\n\
            Choose the best tool to resolve the issue. You MUST respond with a JSON object: {{\\"tool_name\\": \\"name\\", \\"arguments\\": {{}}, \\"reason\\": \\"why\\"}}"
        );
"""

    # find the block and replace
    start_idx = content.find("let _system_prompt = format!(")
    end_idx = content.find(");", start_idx) + 2

    if start_idx == -1 or end_idx == -1:
        print("Function not found!")
        sys.exit(1)

    new_content = content[:start_idx] + replacement.strip() + "\n" + content[end_idx:]

    with open("rust/crates/runtime/src/fleet_health.rs", "w") as f:
        f.write(new_content)

patch()
