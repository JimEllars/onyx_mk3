with open("rust/crates/commands/src/lib.rs", "r") as f:
    text = f.read()

# Add it at the end to avoid shifting indices if hardcoded length assertions exist,
# and check tests to see where the assertion is. Wait, tests usually assert total count.
# The `renders_help_from_shared_specs` might be hardcoding `141`.
# Let's adjust the test to accept the new length or dynamically compute it.

import re

# find the test
test_pattern = r'assert_eq!\(left, right\); // Or similar length check'
# Actually we can just find the exact test.
# `tests::renders_help_from_shared_specs` failed with left: 142 right: 141

text = re.sub(r'assert_eq!\(([^,]+),\s*141\);', r'assert_eq!(\1, 142);', text)

# Put playbook back
if 'name: "playbook"' not in text:
    text = text.replace('const SLASH_COMMAND_SPECS: &[SlashCommandSpec] = &[', 'const SLASH_COMMAND_SPECS: &[SlashCommandSpec] = &[\n    SlashCommandSpec {\n        name: "playbook",\n        aliases: &["workflow"],\n        summary: "Fetch and run, or resume a cloud playbook",\n        argument_hint: Some("[run <cloud_id>|resume <instance_id>]"),\n        resume_supported: true,\n    },')

with open("rust/crates/commands/src/lib.rs", "w") as f:
    f.write(text)
