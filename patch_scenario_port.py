with open("rust/crates/mock-anthropic-service/tests/scenario.rs", "r") as f:
    content = f.read()

import re

# Find an available port logic or just random port.
# Let's bind a listener to port 0, get its local address, then drop it, and use that port for `onyx`.
# Better yet, just generate a random port since this is an external process and we can't easily pass the ephemeral port back.
# But wait, we can just use port 0 for `onyx` if `ServeHeadless` supports it and writes it to stdout, but we are just sending HTTP requests to it.
# If we pass --port 0 to onyx, we don't know which port it bound to easily without reading stdout.
# So let's find a free port before spawning `onyx`.
port_finding_code = """
    // Find a free port
    let headless_port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
"""

content = re.sub(
    r'(    let mut command = Command::new\(onyx_bin\);\n)',
    port_finding_code + r'\1',
    content,
    count=1
)

content = content.replace('command.args(["serve-headless", "--port", "13342"]);', 'command.args(["serve-headless", "--port", &headless_port.to_string()]);')
content = content.replace('"http://127.0.0.1:13342/tasks"', 'format!("http://127.0.0.1:{headless_port}/tasks")')

with open("rust/crates/mock-anthropic-service/tests/scenario.rs", "w") as f:
    f.write(content)
