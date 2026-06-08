cat << 'INNER_EOF' > rust/crates/runtime/src/fleet_health.rs.patch
--- rust/crates/runtime/src/fleet_health.rs
+++ rust/crates/runtime/src/fleet_health.rs
@@ -55,10 +55,12 @@
     }

     // Fetch recent incidents
-    let mut _recent_incidents = serde_json::json!([]);
+    let mut recent_incidents = serde_json::json!([]);
+    let _ = recent_incidents;
     let workspace_root = std::env::current_dir().unwrap_or_default();
     let config_home_dir = std::env::var("ONYX_CONFIG_HOME").map_or_else(
         |_| {
@@ -93,7 +95,8 @@
         .await
     {
         if let Ok(json) = res.json::<serde_json::Value>().await {
-            _recent_incidents = json;
+            recent_incidents = json;
+            let _ = recent_incidents;
         }
     }

@@ -270,6 +273,7 @@
                 // Task 1: Execution
                 let mut exec_status = "Completed";
                 let mut exec_details = String::new();
+                let _ = exec_details; // suppress warning
                 {
                     // Simulated local MCP execution
                     match action.tool_name.as_str() {
INNER_EOF
patch rust/crates/runtime/src/fleet_health.rs rust/crates/runtime/src/fleet_health.rs.patch
