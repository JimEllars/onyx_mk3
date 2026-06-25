import re
import sys

def patch():
    with open("rust/crates/runtime/src/config_validate.rs", "r") as f:
        content = f.read()

    replacement = """
#[cfg(test)]
mod proxy_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_proxy_mode_validation() {
        let mut envs = HashMap::new();
        envs.insert("CHAT_ROUTING_MODE".to_string(), "proxy".to_string());

        assert!(validate_proxy_mode_secrets(&envs).is_err());

        envs.insert("AXIM_ONYX_SECRET".to_string(), "secret".to_string());
        envs.insert("AXIM_CORE_URL".to_string(), "http://axim-core.internal".to_string());

        assert!(validate_proxy_mode_secrets(&envs).is_err());

        envs.insert("AXIM_CORE_URL".to_string(), "https://api.axim.us.com".to_string());
        assert!(validate_proxy_mode_secrets(&envs).is_ok());
    }
}
"""

    start_idx = content.find("#[cfg(test)]\nmod proxy_tests {")

    if start_idx == -1:
        print("Function not found!")
        sys.exit(1)

    new_content = content[:start_idx] + replacement.strip() + "\n"

    with open("rust/crates/runtime/src/config_validate.rs", "w") as f:
        f.write(new_content)

patch()
