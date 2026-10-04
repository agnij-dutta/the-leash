# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-05

### Added
- Jailbreak-me agent with a `pay(to, amount)` tool, Groq or any OpenAI-compatible brain, and a scripted fallback brain.
- Layer A preflight through the `capline/solana` SDK, and a forced on-chain `settle` so the Capline program reverts jailbroken payments publicly.
- "Paid out" read live from the attacker sink token account.
- Attempt store (Upstash/Vercel KV REST, JSONL file, or memory), hall of fame, live feed, share cards with OG images.
- Provision, end-to-end and local validator scripts.
- Devnet/localnet guard by cluster name, RPC URL and RPC genesis hash.
- Per-IP rate limits with salted IP hashes, and a global daily budget for forced reverts (`LEASH_FORCE_PER_DAY`).
- Unit tests, Biome lint and format, CI workflow, SECURITY, CONTRIBUTING and issue templates.

### Security
- The agent key file is excluded from Next's server output tracing, so it cannot ship inside a build.
- Secret key parse errors never echo the key.
- RPC credentials are stripped from `deployments/*.json` and explorer links.
- The rate limiter and the forced-revert budget fail closed when storage is down.

[Unreleased]: https://github.com/agnij-dutta/the-leash/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/agnij-dutta/the-leash/releases/tag/v0.1.0
