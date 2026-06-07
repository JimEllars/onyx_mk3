sed -i 's/        return Ok(response.into());/        return Err("Circuit breaker is OPEN. Service Unavailable.".to_string());/g' rust/crates/api/src/http_client.rs
sed -i '/return Ok(reqwest::Response::from(http::response::Builder::new().status(503).body(/d' rust/crates/api/src/http_client.rs
