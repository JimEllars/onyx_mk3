import re

with open('rust/crates/api/src/providers/mod.rs', 'r') as f:
    content = f.read()

# Update detect_provider_kind in rust/crates/api/src/providers/mod.rs
# to also check for DEEPSEEK_API_KEY and OPENROUTER_API_KEY.
detection_addition = """    if openai_compat::has_api_key("DEEPSEEK_API_KEY") {
        return ProviderKind::OpenAi;
    }
    if openai_compat::has_api_key("OPENROUTER_API_KEY") {
        return ProviderKind::OpenAi;
    }
"""

content = content.replace("    if openai_compat::has_api_key(\"DASHSCOPE_API_KEY\") {\n        return ProviderKind::OpenAi;\n    }\n", "    if openai_compat::has_api_key(\"DASHSCOPE_API_KEY\") {\n        return ProviderKind::OpenAi;\n    }\n" + detection_addition)

with open('rust/crates/api/src/providers/mod.rs', 'w') as f:
    f.write(content)
