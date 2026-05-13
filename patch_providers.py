import re

with open('rust/crates/api/src/providers/mod.rs', 'r') as f:
    content = f.read()

metadata_addition = """    if canonical.starts_with("deepseek") {
        return Some(ProviderMetadata {
            provider: ProviderKind::OpenAi,
            auth_env: "DEEPSEEK_API_KEY",
            base_url_env: "DEEPSEEK_BASE_URL",
            default_base_url: openai_compat::DEFAULT_DEEPSEEK_BASE_URL,
        });
    }
    if canonical.starts_with("openrouter") {
        return Some(ProviderMetadata {
            provider: ProviderKind::OpenAi,
            auth_env: "OPENROUTER_API_KEY",
            base_url_env: "OPENROUTER_BASE_URL",
            default_base_url: openai_compat::DEFAULT_OPENROUTER_BASE_URL,
        });
    }
"""

content = content.replace("    if canonical.starts_with(\"grok\") {\n        return Some(ProviderMetadata {\n            provider: ProviderKind::Xai,\n            auth_env: \"XAI_API_KEY\",\n            base_url_env: \"XAI_BASE_URL\",\n            default_base_url: openai_compat::DEFAULT_XAI_BASE_URL,\n        });\n    }\n", "    if canonical.starts_with(\"grok\") {\n        return Some(ProviderMetadata {\n            provider: ProviderKind::Xai,\n            auth_env: \"XAI_API_KEY\",\n            base_url_env: \"XAI_BASE_URL\",\n            default_base_url: openai_compat::DEFAULT_XAI_BASE_URL,\n        });\n    }\n" + metadata_addition)

with open('rust/crates/api/src/providers/mod.rs', 'w') as f:
    f.write(content)
