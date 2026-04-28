import re

# tools/src/communication_ops.rs
with open("rust/crates/tools/src/communication_ops.rs", "r") as f:
    content = f.read()

content = content.replace('format!("{}/api/v1/email/send", axim_core_url)', 'format!("{axim_core_url}/api/v1/email/send")')
content = content.replace('format!("Bearer {}", service_key)', 'format!("Bearer {service_key}")')
content = content.replace('format!("Request failed: {}", e)', 'format!("Request failed: {e}")')
content = content.replace('format!("{}/api/v1/email/inbox", axim_core_url)', 'format!("{axim_core_url}/api/v1/email/inbox")')
content = content.replace('format!("Failed to parse response: {}", e)', 'format!("Failed to parse response: {e}")')

with open("rust/crates/tools/src/communication_ops.rs", "w") as f:
    f.write(content)


# tools/src/wordpress_admin.rs
with open("rust/crates/tools/src/wordpress_admin.rs", "r") as f:
    content = f.read()

content = content.replace('format!("{}/wp/v2/posts", wp_url)', 'format!("{wp_url}/wp/v2/posts")')
content = content.replace('format!("Failed to create post: {} - {}", status, text)', 'format!("Failed to create post: {status} - {text}")')
content = content.replace('format!("{}/wp/v2/posts/{}", wp_url, post_id)', 'format!("{wp_url}/wp/v2/posts/{post_id}")')
content = content.replace('format!("Failed to update post: {} - {}", status, text)', 'format!("Failed to update post: {status} - {text}")')

with open("rust/crates/tools/src/wordpress_admin.rs", "w") as f:
    f.write(content)
