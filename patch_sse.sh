#!/bin/bash
cat << 'INNER_EOF' >> rust/crates/api/src/sse.rs

use serde::{Deserialize, Serialize};
use std::io::{self, Write};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SsePayload {
    pub chunk: String,
    pub done: bool,
}

impl SsePayload {
    #[must_use]
    pub fn new(chunk: impl Into<String>, done: bool) -> Self {
        Self {
            chunk: chunk.into(),
            done,
        }
    }

    /// Formats the payload as a standard SSE event and flushes it to the given writer.
    /// This prevents internal Rust deadlocks when yielding tokens.
    pub fn emit<W: Write>(&self, writer: &mut W) -> io::Result<()> {
        let json = serde_json::to_string(self)?;
        write!(writer, "data: {json}\n\n")?;
        writer.flush()?;
        Ok(())
    }
}
INNER_EOF
