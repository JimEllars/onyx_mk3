use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBranchInput {
    pub repo: String,
    pub branch_name: String,
    pub base_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateBranchOutput {
    pub success: bool,
}

pub async fn execute_create_branch(input: CreateBranchInput) -> Result<CreateBranchOutput, String> {
    let token = std::env::var("GITHUB_PAT").map_err(|_| "GITHUB_PAT is not set")?;
    let client = reqwest::Client::new();

    // First, get the SHA of the base branch
    let base_url = format!("https://api.github.com/repos/{}/git/ref/heads/{}", input.repo, input.base_branch);
    let base_res = client
        .get(&base_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "Onyx-Agent")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !base_res.status().is_success() {
        return Err(format!("Failed to fetch base branch: {}", base_res.status()));
    }

    let base_data: serde_json::Value = base_res.json().await.map_err(|e| e.to_string())?;
    let sha = base_data["object"]["sha"].as_str().ok_or("Invalid SHA format")?;

    // Create the new branch
    let create_url = format!("https://api.github.com/repos/{}/git/refs", input.repo);
    let create_res = client
        .post(&create_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "Onyx-Agent")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "ref": format!("refs/heads/{}", input.branch_name),
            "sha": sha
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if create_res.status().is_success() {
        Ok(CreateBranchOutput { success: true })
    } else {
        Err(format!("Failed to create branch: {}", create_res.status()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePullRequestInput {
    pub repo: String,
    pub title: String,
    pub head_branch: String,
    pub base_branch: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePullRequestOutput {
    pub pr_url: String,
}

pub async fn execute_create_pull_request(input: CreatePullRequestInput) -> Result<CreatePullRequestOutput, String> {
    let token = std::env::var("GITHUB_PAT").map_err(|_| "GITHUB_PAT is not set")?;
    let client = reqwest::Client::new();

    let url = format!("https://api.github.com/repos/{}/pulls", input.repo);
    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "Onyx-Agent")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "title": input.title,
            "head": input.head_branch,
            "base": input.base_branch,
            "body": input.body
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let pr_url = data["html_url"].as_str().unwrap_or("").to_string();
        Ok(CreatePullRequestOutput { pr_url })
    } else {
        Err(format!("Failed to create pull request: {}", res.status()))
    }
}
