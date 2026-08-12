# Onyx

Onyx is an AXiM-integrated Rust CLI with a Cloudflare Worker edge bridge. The
local runtime lives in [`rust/`](./rust); the Worker configuration lives in
[`edge-bridge/`](./edge-bridge).

> [!IMPORTANT]
> Start with [installation and activation](./docs/ONYX_SETUP.md). Build the
> local CLI, configure a provider credential or OAuth, deploy the edge bridge
> with its required bindings and secrets, then run `onyx doctor`.

## Repository shape

- **`rust/`** - canonical Rust workspace and the `onyx` CLI binary
- **`edge-bridge/`** - Cloudflare Worker, bindings, assets, and deployment scripts
- **`docs/ONYX_SETUP.md`** - installation, configuration, and production activation
- **`src/` + `tests/`** - companion Python/reference workspace and audit helpers

## Quick start

```bash
cd rust
cargo build --workspace
./target/debug/onyx --help
./target/debug/onyx doctor
```

Authenticate with an API key or OAuth:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# or
cd rust
./target/debug/onyx login
```

Build and validate the Worker:

```bash
npm run build
npm run deploy:dry-run
```

## Documentation

- [Installation and activation](./docs/ONYX_SETUP.md)
- [Rust workspace](./rust/README.md)
- [Container workflow](./docs/container.md)
