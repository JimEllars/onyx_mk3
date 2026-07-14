use runtime::persona::BrandId;

#[test]
fn test_persona_isolation() {
    let brand = BrandId::AximSystems;
    let forbidden = brand.forbidden_terms();
    assert!(forbidden.contains(&"Speculative"));
    assert!(forbidden.contains(&"Web3 tokens"));
    assert!(forbidden.contains(&"Hype-words"));
}

use runtime::PermissionPolicy;
use runtime::Session;
use runtime::ToolError;
use runtime::ToolExecutor;
use runtime::{ApiClient, ApiRequest, AssistantEvent, ConversationRuntime, RuntimeError};
use std::fmt::{Formatter, Result as FmtResult};

#[derive(Clone)]
struct MockApiClient;
impl ApiClient for MockApiClient {
    fn stream(&mut self, _request: ApiRequest) -> Result<Vec<AssistantEvent>, RuntimeError> {
        Ok(vec![])
    }
}
impl std::fmt::Debug for MockApiClient {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "MockApiClient")
    }
}

#[derive(Clone)]
struct MockToolExecutor;
impl ToolExecutor for MockToolExecutor {
    fn execute(&mut self, _tool_name: &str, _input: &str) -> Result<String, ToolError> {
        Ok(String::new())
    }
}
impl std::fmt::Debug for MockToolExecutor {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "MockToolExecutor")
    }
}

#[tokio::test]
async fn test_persona_isolation_runtime_blocks_forbidden() {
    let mut session = Session::new();
    session.brand_id = Some(BrandId::AximSystems);

    let mut runtime = ConversationRuntime::new(
        session,
        MockApiClient,
        MockToolExecutor,
        PermissionPolicy::new(runtime::PermissionMode::Allow),
        vec![],
    );

    let result = runtime.run_turn("This is a prompt with Speculative content", None);
    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("Input contains forbidden term for active persona: Speculative"));
}
