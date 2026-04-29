use crate::communication_ops::execute_send_email;
use crate::wordpress_admin::execute_create_wordpress_post;

pub async fn execute_marketing_deployment(campaign_title: &str, article_body: &str) -> Result<(), String> {
    println!("[SYSTEM] Initiating Closed-Loop Marketing Deployment: Posting to WordPress...");

    execute_create_wordpress_post(campaign_title, article_body, "publish").await?;

    println!("[SYSTEM] WordPress post successful. Generating email broadcast...");

    let email_body = format!("Check out our latest update: {campaign_title}");
    execute_send_email("subscribers@axim.us.com", campaign_title, &email_body).await?;

    println!("[SYSTEM] Email broadcast complete. Closed-loop workflow successful.");

    Ok(())
}
