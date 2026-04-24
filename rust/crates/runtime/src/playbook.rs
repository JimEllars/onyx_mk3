use crate::swarm_lock::DistributedLock;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::future::Future;
use std::path::PathBuf;
use tokio::task::JoinSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookTask {
    pub id: String,
    pub agent_type: String,
    pub description: String,
    pub prompt: String,
    pub model: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookDefinition {
    pub name: String,
    pub tasks: Vec<PlaybookTask>,
}

pub struct PlaybookExecutor {
    definition: PlaybookDefinition,
    instance_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlaybookCheckpoint {
    pub completed: HashSet<String>,
    pub results: HashMap<String, String>,
}

impl PlaybookExecutor {
    #[must_use]
    pub fn new(definition: PlaybookDefinition, instance_id: String) -> Self {
        Self {
            definition,
            instance_id,
        }
    }

    /// Fetches a cloud playbook from the `workflows_ax2024` table.
    pub async fn fetch_cloud_playbook(cloud_id: &str) -> Result<PlaybookDefinition, String> {
        let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
        let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
            .unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default());

        if supabase_url.is_empty() || supabase_key.is_empty() {
            return Err("Missing Supabase credentials for cloud sync".to_string());
        }

        let client = reqwest::Client::new();
        let url = format!("{supabase_url}/rest/v1/workflows_ax2024?id=eq.{cloud_id}&select=*");

        let res = client
            .get(&url)
            .header("apikey", &supabase_key)
            .header("Authorization", format!("Bearer {supabase_key}"))
            .send()
            .await
            .map_err(|e| format!("Network error fetching playbook: {e}"))?;

        if !res.status().is_success() {
            return Err(format!("Supabase API error: {}", res.status()));
        }

        let workflows: Vec<serde_json::Value> = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        let workflow = workflows
            .into_iter()
            .next()
            .ok_or_else(|| "Playbook not found in cloud".to_string())?;

        let definition: PlaybookDefinition = serde_json::from_value(workflow["definition"].clone())
            .map_err(|e| format!("Failed to parse playbook definition: {e}"))?;

        Ok(definition)
    }

    fn get_checkpoint_path(&self) -> PathBuf {
        let mut path = std::env::var("HOME")
            .map(PathBuf::from)
            .ok()
            .unwrap_or_else(|| PathBuf::from("."));
        path.push(".onyx");
        path.push("playbooks");
        path.push("checkpoints");
        fs::create_dir_all(&path).ok();
        path.push(format!("{}.json", self.instance_id));
        path
    }

    fn save_checkpoint(&self, completed: &HashSet<String>, results: &HashMap<String, String>) {
        let path = self.get_checkpoint_path();
        let cp = PlaybookCheckpoint {
            completed: completed.clone(),
            results: results.clone(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&cp) {
            let _ = fs::write(path, json);
        }
    }

    fn load_checkpoint(&self) -> Option<PlaybookCheckpoint> {
        let path = self.get_checkpoint_path();
        if let Ok(content) = fs::read_to_string(path) {
            serde_json::from_str(&content).ok()
        } else {
            None
        }
    }

    /// Validates that there are no cycles and all dependencies exist
    pub fn validate(&self) -> Result<(), String> {
        let task_ids: HashSet<_> = self.definition.tasks.iter().map(|t| t.id.clone()).collect();
        for task in &self.definition.tasks {
            for dep in &task.dependencies {
                if !task_ids.contains(dep) {
                    return Err(format!("Task {} depends on unknown task {}", task.id, dep));
                }
            }
        }

        let mut visited = HashSet::new();
        let mut stack = HashSet::new();
        for task in &self.definition.tasks {
            if self.has_cycle(&task.id, &mut visited, &mut stack) {
                return Err(format!("Cycle detected involving task {}", task.id));
            }
        }
        Ok(())
    }

    fn has_cycle(
        &self,
        node: &str,
        visited: &mut HashSet<String>,
        stack: &mut HashSet<String>,
    ) -> bool {
        if stack.contains(node) {
            return true;
        }
        if visited.contains(node) {
            return false;
        }
        visited.insert(node.to_string());
        stack.insert(node.to_string());

        if let Some(task) = self.definition.tasks.iter().find(|t| t.id == node) {
            for dep in &task.dependencies {
                if self.has_cycle(dep, visited, stack) {
                    return true;
                }
            }
        }

        stack.remove(node);
        false
    }

    /// Executes the DAG playbook. Independent tasks are spawned concurrently.
    #[allow(clippy::too_many_lines)]
    pub async fn execute<F, Fut>(
        &self,
        spawn_agent: F,
        resume: bool,
    ) -> Result<HashMap<String, String>, String>
    where
        F: Fn(PlaybookTask, HashMap<String, String>) -> Fut + Clone + Send + Sync + 'static,
        Fut: Future<Output = Result<String, String>> + Send + 'static,
    {
        self.validate()?;

        let lock_id = format!("playbook_{}", self.instance_id);
        let acquired = DistributedLock::acquire(&lock_id, 300)
            .await
            .unwrap_or(false);
        if !acquired {
            return Err(format!(
                "Could not acquire distributed lock for playbook {}",
                self.instance_id
            ));
        }

        let mut results: HashMap<String, String> = HashMap::new();
        let mut completed: HashSet<String> = HashSet::new();
        let mut in_progress: HashSet<String> = HashSet::new();
        let total_tasks = self.definition.tasks.len();

        if resume {
            if let Some(cp) = self.load_checkpoint() {
                results = cp.results;
                completed = cp.completed;
            }
        }

        let mut join_set = JoinSet::new();

        while completed.len() < total_tasks {
            // Find tasks that have all dependencies met and are not started yet
            for task in &self.definition.tasks {
                if completed.contains(&task.id) || in_progress.contains(&task.id) {
                    continue;
                }

                let deps_met = task.dependencies.iter().all(|d| completed.contains(d));
                if deps_met {
                    // Handle analyzeInternalInfrastructure objective
                    if task.description == "analyzeInternalInfrastructure"
                        || task.id == "analyzeInternalInfrastructure"
                    {
                        println!("Executing analyzeInternalInfrastructure...");
                        let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
                        let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
                            .unwrap_or_else(|_| {
                                std::env::var("AXIM_ONYX_SECRET").unwrap_or_default()
                            });

                        if !supabase_url.is_empty() && !supabase_key.is_empty() {
                            let client = reqwest::blocking::Client::new();
                            let url = format!("{supabase_url}/rest/v1/telemetry_logs?status=in.(500,502)&created_at=gte.now()-interval'24 hours'");
                            // Simplified fetching logic for demonstration
                            let _ = client
                                .get(&url)
                                .header("apikey", &supabase_key)
                                .header("Authorization", format!("Bearer {supabase_key}"))
                                .send();
                        }
                    }

                    if task.description == "Daily Executive Brief" || task.id == "Daily Executive Brief" {
                        println!("Executing Daily Executive Brief...");
                        let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
                        let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
                            .unwrap_or_else(|_| {
                                std::env::var("AXIM_ONYX_SECRET").unwrap_or_default()
                            });

                        if !supabase_url.is_empty() && !supabase_key.is_empty() {
                            let client = reqwest::blocking::Client::builder()
                                .timeout(std::time::Duration::from_secs(10))
                                .build()
                                .unwrap();
                            let url = format!("{supabase_url}/rest/v1/telemetry_logs?created_at=gte.now()-interval'24 hours'");
                            if let Ok(res) = client.get(&url).header("apikey", &supabase_key).header("Authorization", format!("Bearer {supabase_key}")).send() {
                                if let Ok(logs) = res.json::<serde_json::Value>() {
                                    let total_conversions = 0; // Placeholder logic
                                    let total_errors = logs.as_array().map_or(0, std::vec::Vec::len);
                                    let active_outages = 0; // Placeholder logic

                                    let markdown = format!("# AXiM Daily Executive Briefing\n\n**Total Conversions:** {total_conversions}\n**Total Errors:** {total_errors}\n**Active Outages:** {active_outages}");

                                    if let Ok(axim_service_key) = std::env::var("AXIM_SERVICE_KEY") {
                                        let axim_core_url = std::env::var("AXIM_CORE_URL").unwrap_or_else(|_| "https://api.axim.us.com".to_string());
                                        let email_url = format!("{axim_core_url}/api/send-email");
                                        let payload = serde_json::json!({
                                            "subject": "AXiM Daily Executive Briefing",
                                            "severity": "info",
                                            "message": markdown,
                                        });
                                        let _ = client.post(&email_url).header("Authorization", format!("Bearer {axim_service_key}")).header("Content-Type", "application/json").json(&payload).send();
                                    }
                                }
                            }
                        }

                    }

                    // Human-in-the-Loop Interruption
                    // Check if task needs approval
                    // We will just do a quick Supabase check if the task is explicitly approved.
                    let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
                    let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
                        .unwrap_or_else(|_| std::env::var("AXIM_ONYX_SECRET").unwrap_or_default());
                    if !supabase_url.is_empty() && !supabase_key.is_empty() {
                        let client = reqwest::blocking::Client::new();
                        let url = format!(
                            "{}/rest/v1/playbook_tasks?id=eq.{}&select=status,requires_approval",
                            supabase_url, task.id
                        );
                        if let Ok(res) = client
                            .get(&url)
                            .header("apikey", &supabase_key)
                            .header("Authorization", format!("Bearer {supabase_key}"))
                            .send()
                        {
                            if let Ok(tasks) = res.json::<serde_json::Value>() {
                                if let Some(task_arr) = tasks.as_array() {
                                    if let Some(t) = task_arr.first() {
                                        let req_appr =
                                            t["requires_approval"].as_bool().unwrap_or(false);
                                        let status = t["status"].as_str().unwrap_or("pending");
                                        if req_appr && status != "approved" {
                                            println!("Playbook paused. Task {} requires human authorization.", task.id);
                                            println!(
                                                "Run /approve {} or /reject {}",
                                                task.id, task.id
                                            );
                                            // Stash graph state
                                            self.save_checkpoint(&completed, &results);
                                            let _ = DistributedLock::release(&lock_id).await;
                                            return Ok(results); // Pause execution gracefully
                                        }
                                        if req_appr && status == "rejected" {
                                            let _ = DistributedLock::release(&lock_id).await;
                                            return Err(format!("Task {} was rejected.", task.id));
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let task_clone = task.clone();
                    let spawn_agent_clone = spawn_agent.clone();

                    // Filter outputs for dependencies
                    let mut task_inputs = HashMap::new();
                    for dep in &task.dependencies {
                        if let Some(output) = results.get(dep) {
                            task_inputs.insert(dep.clone(), output.clone());
                        }
                    }

                    in_progress.insert(task.id.clone());

                    join_set.spawn(async move {
                        let res = spawn_agent_clone(task_clone.clone(), task_inputs).await;
                        (task_clone.id, res)
                    });
                }
            }

            // Wait for at least one task to finish if any are in progress
            if let Some(res) = join_set.join_next().await {
                match res {
                    Ok((task_id, Ok(output))) => {
                        results.insert(task_id.clone(), output);
                        completed.insert(task_id.clone());
                        in_progress.remove(&task_id);

                        // Checkpoint after successful task
                        self.save_checkpoint(&completed, &results);
                    }
                    Ok((task_id, Err(e))) => {
                        let _ = DistributedLock::release(&lock_id).await;
                        return Err(format!("Task {task_id} failed: {e}"));
                    }
                    Err(e) => {
                        let _ = DistributedLock::release(&lock_id).await;
                        return Err(format!("Join error executing tasks: {e}"));
                    }
                }
            } else if completed.len() < total_tasks {
                let _ = DistributedLock::release(&lock_id).await;
                return Err(
                    "Deadlock detected: no tasks in progress but not all completed".to_string(),
                );
            }
        }

        let _ = DistributedLock::release(&lock_id).await;
        Ok(results)
    }
}
