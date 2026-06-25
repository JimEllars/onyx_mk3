import re

with open('rust/crates/telemetry/src/dlq.rs', 'r') as f:
    content = f.read()

# Replace read-all into lines_to_keep with bounded lines
search = """
            if let Ok(file) = File::open(&dlq_path) {
                let reader = BufReader::new(file);
                for line in reader.lines().map_while(Result::ok) {
                    if line.trim().is_empty() {
                        continue;
                    }

                    if let Ok(receipt) = serde_json::from_str::<serde_json::Value>(&line) {
                        let res = client.post(&sync_url).json(&receipt).send().await;
                        if res.is_err() || res.unwrap().status().is_server_error() {
                            lines_to_keep.push(line);
                            repeated_failures += 1;
                        }
                    } else {
                        // Unparseable, discard
                    }
                }
            }

            // FIFO eviction if the queue grows too large
            if lines_to_keep.len() > max_lines {
                let overflow = lines_to_keep.len() - max_lines;
                lines_to_keep.drain(0..overflow);
            }

            // Further memory boundary check
            let mut total_size: usize = lines_to_keep.iter().map(std::string::String::len).sum();
            let mut drop_count = 0;
            for line in &lines_to_keep {
                if total_size <= max_file_size {
                    break;
                }
                total_size -= line.len();
                drop_count += 1;
            }
            if drop_count > 0 {
                lines_to_keep.drain(0..drop_count);
            }
"""

replace = """
            if let Ok(file) = File::open(&dlq_path) {
                let reader = BufReader::new(file);
                for line in reader.lines().map_while(Result::ok) {
                    if line.trim().is_empty() {
                        continue;
                    }

                    if let Ok(receipt) = serde_json::from_str::<serde_json::Value>(&line) {
                        let res = client.post(&sync_url).json(&receipt).send().await;
                        if res.is_err() || res.unwrap().status().is_server_error() {
                            lines_to_keep.push(line);
                            repeated_failures += 1;

                            // FIFO eviction if the queue grows too large (in memory)
                            if lines_to_keep.len() > max_lines {
                                lines_to_keep.remove(0);
                            }
                        }
                    } else {
                        // Unparseable, discard
                    }
                }
            }

            // Further memory boundary check
            let mut total_size: usize = lines_to_keep.iter().map(std::string::String::len).sum();
            while total_size > max_file_size && !lines_to_keep.is_empty() {
                total_size -= lines_to_keep[0].len();
                lines_to_keep.remove(0);
            }
"""

content = content.replace(search, replace)

with open('rust/crates/telemetry/src/dlq.rs', 'w') as f:
    f.write(content)
