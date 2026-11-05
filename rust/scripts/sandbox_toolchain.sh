#!/usr/bin/env bash
# Build the Rust workspace in a sandbox that has no system C toolchain.
#
# The authoring sandbox ships neither `cc`/`ar` nor OpenSSL headers, so
# `cargo clippy`/`cargo test` die in `cc-rs` before linting a single line of our
# own code. Everything needed is already on disk; this script wires it up.
#
#   source rust/scripts/sandbox_toolchain.sh     # exports CC/AR/OPENSSL_DIR
#   cargo clippy --workspace --all-targets -- -D warnings
#
# What it does:
#   * `cc` -> `zig cc`, with cc-rs's own flags filtered. zig rejects
#     `--target=x86_64-unknown-linux-gnu` ("UnknownOperatingSystem") and
#     `-Wp,-U_FORTIFY_SOURCE` ("unsupported preprocessor arg").
#   * `ar` -> `zig ar`.
#   * `OPENSSL_DIR` -> an extracted `libssl-dev` prefix. Debian puts the
#     arch-dependent headers in `include/x86_64-linux-gnu/openssl/`; openssl-sys
#     expands `opensslv.h` from `include/`, so those have to be copied up.
#   * `OPENSSL_STATIC=1` so the linker does not need a `libssl.so.3` symlink.
#
# Known limit: `cargo test` links the `onyx` binary (ratatui + onig + sqlite +
# static OpenSSL) and aborts under zig cc on this box, and a full build needs
# ~4 GB of `target/`. `cargo fmt` and `cargo clippy --workspace --all-targets`
# do run to completion. CI stays the compiler of record for the test suite.
#
# Requires: /workspace/.toolchain/zig-*/zig, network access to deb.debian.org
# on first run only.

set -euo pipefail

ZIG="$(ls -d /workspace/.toolchain/zig-*/zig 2>/dev/null | head -1)"
if [ -z "${ZIG}" ]; then
    echo "sandbox_toolchain: no zig found under /workspace/.toolchain" >&2
    return 1 2>/dev/null || exit 1
fi

BIN="${HOME}/.local/bin"
PREFIX="${SANDBOX_OPENSSL_PREFIX:-/tmp/osslroot/usr}"

mkdir -p "${BIN}"

cat > "${BIN}/cc" <<EOF
#!/usr/bin/env bash
# zig clang, with cc-rs flags zig will not accept.
args=()
for a in "\$@"; do
  case "\$a" in
    --target=x86_64-unknown-linux-gnu) ;;
    -Wp,-U_FORTIFY_SOURCE) ;;
    --target=aarch64-unknown-linux-gnu) args+=("--target=aarch64-linux-gnu") ;;
    *) args+=("\$a") ;;
  esac
done
exec "${ZIG}" cc "\${args[@]}"
EOF
chmod +x "${BIN}/cc"
ln -sf "${BIN}/cc" "${BIN}/gcc"

cat > "${BIN}/ar" <<EOF
#!/usr/bin/env bash
exec "${ZIG}" ar "\$@"
EOF
chmod +x "${BIN}/ar"

# OpenSSL headers + static libs, once.
if [ ! -f "${PREFIX}/lib/libssl.a" ]; then
    echo "sandbox_toolchain: fetching libssl-dev into ${PREFIX}"
    tmp="$(mktemp -d)"
    deb="$(curl -sS http://deb.debian.org/debian/pool/main/o/openssl/ \
        | grep -oE 'libssl-dev_3\.0\.[0-9]+-[0-9]+~deb12u[0-9]+_amd64\.deb' \
        | sort -uV | tail -1)"
    ( cd "${tmp}" && curl -sS -O "http://deb.debian.org/debian/pool/main/o/openssl/${deb}" )
    dpkg-deb -x "${tmp}/${deb}" "${tmp}/root"
    mkdir -p "$(dirname "${PREFIX}")"
    mv "${tmp}/root/usr" "$(dirname "${PREFIX}")/usr" 2>/dev/null || true
    rm -rf "${tmp}"
    # Debian splits the arch-dependent headers out; openssl-sys only looks in include/.
    cp -an "${PREFIX}/include/x86_64-linux-gnu/openssl/." "${PREFIX}/include/openssl/"
    cp -a  "${PREFIX}/lib/x86_64-linux-gnu/libssl.a" \
           "${PREFIX}/lib/x86_64-linux-gnu/libcrypto.a" "${PREFIX}/lib/"
fi

export PATH="${HOME}/.cargo/bin:${BIN}:${PATH}"
export OPENSSL_DIR="${PREFIX}"
export OPENSSL_STATIC=1
export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-0}"

echo "sandbox_toolchain: cc=${BIN}/cc openssl=${OPENSSL_DIR}"
command -v cargo && cargo --version
