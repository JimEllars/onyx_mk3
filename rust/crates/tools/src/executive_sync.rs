use crate::chatbase_ops::{execute_consult_chatbase_agent, ConsultChatbaseAgentInput};
use crate::communication_ops::{execute_dispatch_executive_brief, DispatchExecutiveBriefInput};
use std::fmt::Write;

pub async fn run_daily_department_sync(company_update: &str) -> Result<(), String> {
    let roles = ["CEO", "CTO", "CFO", "COO", "Legal"];
    let mut compiled_report = String::new();

    compiled_report.push_str("Daily Department Sync Report\n");
    compiled_report.push_str("============================\n\n");

    for role in roles {
        let input = ConsultChatbaseAgentInput {
            agent_role: role.to_string(),
            message: company_update.to_string(),
            conversation_id: None,
        };

        match execute_consult_chatbase_agent(input).await {
            Ok(output) => {
                let _ = writeln!(compiled_report, "--- Report from {role} ---");
                compiled_report.push_str(&output.text);
                compiled_report.push_str("\n\n");
            }
            Err(e) => {
                let _ = writeln!(compiled_report, "--- Error from {role} ---");
                let _ = write!(compiled_report, "Failed to consult agent: {e}\n\n");
            }
        }
    }

    let brief_input = DispatchExecutiveBriefInput {
        message_body: compiled_report,
        priority: "high".to_string(),
    };

    execute_dispatch_executive_brief(brief_input).await?;

    Ok(())
}
