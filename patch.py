import re

with open('rust/crates/api/src/providers/openai_compat.rs', 'r') as f:
    content = f.read()

config_addition = """    #[must_use]
    pub const fn deepseek() -> Self {
        Self {
            provider_name: "DeepSeek",
            api_key_env: "DEEPSEEK_API_KEY",
            base_url_env: "DEEPSEEK_BASE_URL",
            default_base_url: DEFAULT_DEEPSEEK_BASE_URL,
        }
    }

    #[must_use]
    pub const fn openrouter() -> Self {
        Self {
            provider_name: "OpenRouter",
            api_key_env: "OPENROUTER_API_KEY",
            base_url_env: "OPENROUTER_BASE_URL",
            default_base_url: DEFAULT_OPENROUTER_BASE_URL,
        }
    }

"""

# Insert right before credential_env_vars
content = content.replace("    #[must_use]\n    pub fn credential_env_vars(self)", config_addition + "    #[must_use]\n    pub fn credential_env_vars(self)")

# Add to credential_env_vars
content = content.replace("\"DashScope\" => DASHSCOPE_ENV_VARS,", "\"DashScope\" => DASHSCOPE_ENV_VARS,\n            \"DeepSeek\" => DEEPSEEK_ENV_VARS,\n            \"OpenRouter\" => OPENROUTER_ENV_VARS,")

with open('rust/crates/api/src/providers/openai_compat.rs', 'w') as f:
    f.write(content)
