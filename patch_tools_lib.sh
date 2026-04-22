cat << 'INNER_EOF' > rust/crates/tools/src/vault.patch
--- rust/crates/tools/src/lib.rs
+++ rust/crates/tools/src/lib.rs
@@ -438,6 +438,21 @@
     }
 });
                 }
+                "vault_artifact" => {
+                    def.description = "Vault a large artifact securely into AXiM Core Supabase storage".to_string();
+                    def.input_schema = json!({
+                        "type": "object",
+                        "required": ["filename", "content"],
+                        "properties": {
+                            "filename": {
+                                "type": "string",
+                                "description": "Name of the artifact file"
+                            },
+                            "content": {
+                                "type": "string",
+                                "description": "Raw string content to vault"
+                            }
+                        }
+                    });
+                }
                 _ => {}
             }

@@ -1486,6 +1501,15 @@
             let output = rt.block_on(async move {
                 supabase_ops::execute_check_micro_app_transactions(input, &config).await
             }).map_err(|e| e.to_string())?;
             Ok(serde_json::to_string(&output).unwrap())
         }
+        "vault_artifact" => {
+            let input: supabase_ops::VaultArtifactInput = serde_json::from_value(input.clone()).map_err(|e| e.to_string())?;
+            // We just construct an empty RuntimeConfig if needed, or pass one. The tool does its own env lookups as fallback.
+            let config = runtime::RuntimeConfig::empty();
+            let rt = tokio::runtime::Runtime::new().unwrap();
+            let output = rt.block_on(async move {
+                supabase_ops::execute_vault_artifact(input, &config).await
+            }).map_err(|e| e.to_string())?;
+            Ok(format!("Artifact successfully vaulted. [Download Here] ({})", output.url))
+        }
         "bash" => {
INNER_EOF
patch -p0 < rust/crates/tools/src/vault.patch
