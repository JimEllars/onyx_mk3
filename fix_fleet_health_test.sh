cat << 'INNER_EOF' > rust/crates/runtime/src/fleet_health.rs.patch
--- rust/crates/runtime/src/fleet_health.rs
+++ rust/crates/runtime/src/fleet_health.rs
@@ -107,17 +107,6 @@
                 );
                 println!("[Self-Healing: Spiking errors detected in {app}. Status set to DEGRADED. Pushing ProposedAction: {action_id}]");
                 current_status.pending_actions.push(proposed_action);
-
-                // Automatically invoke support_triage for degraded apps
-                tokio::spawn(async move {
-                    let _diagnostic_data = HealthDiagnostic {
-                        app_id: app.clone(),
-                        status_code: Some(500),
-                        error_rate: 1.0,
-                        mcp_server_status: "unknown".to_string(),
-                    };
-                    // Note: In a real environment we would call support triage logic here
-                });
             } else {
                 current_status
                     .apps
INNER_EOF
patch rust/crates/runtime/src/fleet_health.rs rust/crates/runtime/src/fleet_health.rs.patch
