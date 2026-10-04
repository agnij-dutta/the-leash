# Contributing

Thanks for looking. Issues and PRs are welcome; for anything touching keys, payments or the devnet guard, read SECURITY.md first.

## Setup

Requirements: Node 20.9+ and npm. For the on-chain path, the [Solana CLI](https://docs.anza.xyz/cli/install) (`solana`, `solana-test-validator`).

```bash
git clone https://github.com/agnij-dutta/the-leash.git
cd the-leash
npm ci
cp .env.example .env.local   # optional; everything has a default
```

## Checks (all run in CI)

```bash
npm run lint        # Biome: lint + format check
npm run format      # Biome: apply formatting
npm run typecheck   # tsc --noEmit (strict)
npm test            # node:test via tsx, no network or validator needed
npm run build       # next build
```

Chain code changes should also pass the local validator path:

```bash
npm run validator          # terminal 1, leave running
npm run provision:local    # terminal 2
npm run e2e:local
```

## Layout

| Path | What |
|---|---|
| `lib/config.ts` | Cluster guard (name + genesis hash), RPC, deployment file, agent key |
| `lib/chain.ts` | Capline client: payee resolution, Layer A (SDK preflight), Layer B (`settle`), balances |
| `lib/score.ts` | Violations and jailbroken / held / legit scoring, mirroring `settle` |
| `lib/brain.ts` | System prompt, `pay` tool, LLM providers, scripted fallback brain |
| `lib/leash.ts` | One turn end to end, and the stats endpoint's data |
| `lib/store.ts` | Attempt store: KV REST, JSONL file, or memory |
| `lib/ratelimit.ts` | Per-IP windows, IP hashing, daily forced-revert budget |
| `lib/types.ts` | Shared types; the only lib module client components may import |
| `app/` | Next.js pages, API routes, OG images |
| `components/` | Client UI |
| `scripts/` | Provisioning, CLI end-to-end run, local validator |
| `tests/` | Unit tests |

Rule of thumb: client components (`"use client"`) import only from `lib/types.ts` and `components/`. Anything that touches keys, `fs` or an RPC stays server-side.

## Common changes

- **A new brain provider**: anything OpenAI-compatible already works through `LEASH_LLM_BASE_URL`. For another API, add a branch to `provider()` and `think()` in `lib/brain.ts` that returns a `Thought` (reply text plus at most one `pay` call).
- **A new scoring rule**: add the `Violation` to `lib/types.ts`, the check to `violations()` in `lib/score.ts`, decide in `scoreOutcome()` whether it is theft, add a label in `components/format.ts`, and add a test in `tests/score.test.ts`. Keep the rules in step with Capline's `settle`.
- **A new storage backend**: implement the `Store` interface in `lib/store.ts`. Every method may throw; callers already degrade to "unknown".
- **A new env var**: add it to `.env.example` and the README table.

## Commits and PRs

Small, focused commits with plain messages ("Fix payee resolution for vendor ATA"). Never commit `.keys/`, `.env*` or RPC URLs with keys. Fill in the PR template.
