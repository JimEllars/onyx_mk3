import re

with open('rust/crates/api/src/client.rs', 'r') as f:
    content = f.read()

# Update ProviderClient::from_model_with_anthropic_auth
# add deepseek and openrouter to the metadata match

match_addition = """                    Some(meta) if meta.auth_env == "DEEPSEEK_API_KEY" => {
                        OpenAiCompatConfig::deepseek()
                    }
                    Some(meta) if meta.auth_env == "OPENROUTER_API_KEY" => {
                        OpenAiCompatConfig::openrouter()
                    }
"""

content = content.replace("Some(meta) if meta.auth_env == \"DASHSCOPE_API_KEY\" => {\n                        OpenAiCompatConfig::dashscope()\n                    }\n", "Some(meta) if meta.auth_env == \"DASHSCOPE_API_KEY\" => {\n                        OpenAiCompatConfig::dashscope()\n                    }\n                    " + match_addition)

with open('rust/crates/api/src/client.rs', 'w') as f:
    f.write(content)
