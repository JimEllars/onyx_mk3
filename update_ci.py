import sys

filename = ".github/workflows/rust-ci.yml"
with open(filename, 'r') as f:
    content = f.read()

integration_test_block = """
  test-integration:
    name: cargo test --test '*' --features integration
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: rust -> target
      - name: Run integration tests
        run: cargo test --package integration_tests --features integration
"""

if "test-integration:" not in content:
    content += integration_test_block
    with open(filename, 'w') as f:
        f.write(content)
