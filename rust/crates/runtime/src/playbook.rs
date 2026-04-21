use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tokio::task::JoinSet;
use std::future::Future;


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
}

impl PlaybookExecutor {
    #[must_use]
    pub fn new(definition: PlaybookDefinition) -> Self {
        Self { definition }
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
    /// This is an async function that returns a collection of outputs per task.
    /// In a real application, you'd pass a `spawn_agent_fn` to resolve actual work.
    pub async fn execute<F, Fut>(&self, spawn_agent: F) -> Result<HashMap<String, String>, String>
    where
        F: Fn(PlaybookTask, HashMap<String, String>) -> Fut + Clone + Send + Sync + 'static,
        Fut: Future<Output = Result<String, String>> + Send + 'static,
    {
        self.validate()?;

        let mut results: HashMap<String, String> = HashMap::new();
        let mut completed: HashSet<String> = HashSet::new();
        let mut in_progress: HashSet<String> = HashSet::new();
        let total_tasks = self.definition.tasks.len();

        let mut join_set = JoinSet::new();

        while completed.len() < total_tasks {
            // Find tasks that have all dependencies met and are not started yet
            for task in &self.definition.tasks {
                if completed.contains(&task.id) || in_progress.contains(&task.id) {
                    continue;
                }

                let deps_met = task.dependencies.iter().all(|d| completed.contains(d));
                if deps_met {
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
                    }
                    Ok((task_id, Err(e))) => {
                        return Err(format!("Task {task_id} failed: {e}"));
                    }
                    Err(e) => {
                        return Err(format!("Join error executing tasks: {e}"));
                    }
                }
            } else if completed.len() < total_tasks {
                return Err("Deadlock detected: no tasks in progress but not all completed".to_string());
            }
        }

        Ok(results)
    }
}
