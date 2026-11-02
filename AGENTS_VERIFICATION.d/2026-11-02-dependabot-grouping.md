# Verification Log — Grouped Dependabot updates (2026-11-02)

**Branch:** `chore/dependabot-grouped-updates`
**Base:** `1fdddef` (main, post-PR #295)
**Scope:** `.github/dependabot.yml` (new). No source, no lockfile, no workflow change.

## Why

The repo had no Dependabot configuration, so it ran in default mode — one PR per
advisory. This cycle inherited the result: four PRs (#262, #263, #274, #285) against the
root lockfile, three of them patching the same tree, and roughly 29 advisories with no PR
at all (`undici`, `sharp`, `rustls`, `rustls-webpki`, `quinn-proto`, `protobuf`, `rand`,
`lru`).

## What

Weekly grouped patch/minor updates for `npm` at `/` and `/edge-bridge`, patch-only for
`cargo` at `/rust`, monthly grouped `github-actions`. Majors are never grouped, and
`tailwindcss` / `@tailwindcss/*` are excluded from the HUD group: PR #263 was a Tailwind
3 → 4 migration presented as a dependency bump, and it failed `Workers Builds` while
dropping the v3 plugin chain from the lockfile.

Grouping is scoped with `applies-to: version-updates` so security updates stay
ungrouped and are never queued behind routine bumps.

## Proving runs

```
$ python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))"
parsed OK; entries: 4
npm  /             | groups: hud-minor-patch (minor, patch; exclude tailwindcss,@tailwindcss/*) | limit 3 | weekly
npm  /edge-bridge  | groups: edge-minor-patch (minor, patch)                                    | limit 3 | weekly
cargo /rust        | groups: cargo-patch (patch)                                                | limit 3 | weekly
github-actions /   | groups: actions (patterns *)                                               | limit 2 | monthly
```

Every `schedule.interval` is one of `daily|weekly|monthly`; every `commit-message.prefix`
is present; `time` is quoted so it is not parsed as sexagesimal (a well-known Dependabot
YAML trap). PyYAML 6.0.3.

## What "green" does not cover here

**This change has no automated gate.** `.github/dependabot.yml` is not in any workflow's
`paths:` filter, so CI for this PR is GitGuardian and the Cloudflare worker build only —
neither of which reads the file. The YAML parse above proves it is well-formed; it does
not prove GitHub accepts every key.

The real validator is Dependabot itself. A schema error appears under **Insights →
Dependency graph → Dependabot**, and the first grouped PR is the proof that grouping
works. If no grouped PR has opened by the Monday 06:00 America/Chicago run after this
merge, the config is wrong and that panel says why.
