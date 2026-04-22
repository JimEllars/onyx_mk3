cat << 'INNER_EOF' > rust/crates/tools/src/vault_tool.patch
--- rust/crates/tools/src/lib.rs
+++ rust/crates/tools/src/lib.rs
@@ -62,6 +62,10 @@
         entries.push(ToolManifestEntry {
             name: "wp_check_headless_seo".to_string(),
             source: ToolSource::Base,
         });
+        entries.push(ToolManifestEntry {
+            name: "vault_artifact".to_string(),
+            source: ToolSource::Base,
+        });

         Self { entries }
     }
@@ -341,6 +345,19 @@
             "type": "string",
             "description": "Approval token if executed remotely",
         }
+    }
+});
+                }
+                "vault_artifact" => {
+                    def.description = "Vault a large artifact (e.g. JSON, binary) securely into AXiM Core Supabase storage".to_string();
+                    def.input_schema = json!({
+    "type": "object",
+    "required": ["filename", "content"],
+    "properties": {
+        "filename": {
+            "type": "string",
+            "description": "Name of the artifact file"
+        },
+        "content": {
+            "type": "string",
+            "description": "Raw string content to vault"
+        }
     }
 });
                 }
                 _ => {}
             }
INNER_EOF
patch -p0 < rust/crates/tools/src/vault_tool.patch
