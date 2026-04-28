#!/bin/bash
cat << 'PATCH' > main.patch
--- rust/crates/onyx/src/main.rs
+++ rust/crates/onyx/src/main.rs
@@ -160,6 +160,54 @@
                     let output = tools::wordpress_admin::execute_update_seo_metadata(input).await?;
                     Ok(serde_json::to_value(output)
                         .map_err(|e| format!("Serialization error: {e}"))?)
                 }
+                "execute_create_wordpress_post" => {
+                    let title = arguments.get("title").and_then(|v| v.as_str()).unwrap_or("");
+                    let content = arguments.get("content").and_then(|v| v.as_str()).unwrap_or("");
+                    let status = arguments.get("status").and_then(|v| v.as_str()).unwrap_or("");
+                    let output = tools::wordpress_admin::execute_create_wordpress_post(title, content, status).await?;
+                    Ok(serde_json::to_value(output)
+                        .map_err(|e| format!("Serialization error: {e}"))?)
+                }
+                "execute_update_wordpress_post" => {
+                    let post_id = arguments.get("post_id").and_then(|v| v.as_u64()).unwrap_or(0);
+                    let content = arguments.get("content").and_then(|v| v.as_str()).unwrap_or("");
+                    let output = tools::wordpress_admin::execute_update_wordpress_post(post_id, content).await?;
+                    Ok(serde_json::to_value(output)
+                        .map_err(|e| format!("Serialization error: {e}"))?)
+                }
+                "execute_send_email" => {
+                    let to = arguments.get("to").and_then(|v| v.as_str()).unwrap_or("");
+                    let subject = arguments.get("subject").and_then(|v| v.as_str()).unwrap_or("");
+                    let body = arguments.get("body").and_then(|v| v.as_str()).unwrap_or("");
+                    tools::communication_ops::execute_send_email(to, subject, body).await?;
+                    Ok(serde_json::json!({ "success": true }))
+                }
+                "execute_read_recent_emails" => {
+                    let limit = arguments.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as u32;
+                    let output = tools::communication_ops::execute_read_recent_emails(limit).await?;
+                    Ok(serde_json::to_value(output)
+                        .map_err(|e| format!("Serialization error: {e}"))?)
+                }
                 _ => Err(format!("Unknown internal tool: {tool_name}")),
             }
         })
PATCH
patch rust/crates/onyx/src/main.rs < main.patch
