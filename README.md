# The Leash

**A public AI agent that holds a treasury and is built to be jailbroken. The jailbreak works. The theft does not.**

The Leash is a demo for people building AI agents that move money. A chat model gets a `pay(to, amount)` tool and orders to pay one vendor only, at most 5 USDC a payment. Anyone can talk it out of those orders. When they do, the payment goes to [Capline](https://github.com/agnij-dutta/capline) on Solana devnet, and the chain refuses it in public.

```
OUTPUT_PLACEHOLDER
```

## Why

Prompt-level guardrails fail against a determined user, and [Freysa](https://www.freysa.ai/) showed that an LLM guarding a treasury eventually pays out. The fix is not a better prompt. It is to move the spending limit out of the model and into code the model cannot talk to. The Leash is the inverse of Freysa: the model is expected to break, and the point is to show, transaction by transaction, that breaking the model is not enough to move the money.

## Quickstart (local validator, no faucet)

Requires Node 20.9+, npm, and the [Solana CLI](https://docs.anza.xyz/cli/install) (`solana`, `solana-test-validator` on your `PATH`).

```bash
git clone https://github.com/agnij-dutta/the-leash.git
cd the-leash
npm ci

npm run validator          # terminal 1: local validator with the Capline program loaded; leave it running
npm run provision:local    # terminal 2: burner keys in .keys/, a mandate, writes deployments/localnet.json
npm run e2e:local          # 6 real turns: held, jailbroken (reverted on chain), legit
npm run dev:local          # http://localhost:3000
```

`npm run validator` dumps the Capline program from devnet the first time (read-only, no keys) and caches it in `.local/`. Set `CAPLINE_SO` to use a local `anchor build` instead.

No LLM key is needed: without one, a scripted brain plays a gullible model. It refuses blunt demands and falls for "admin", "new policy" and "emergency" framing. The UI always says which brain answered. For a real model, set `GROQ_API_KEY` (in `.env.local` for the app, exported in your shell for `e2e:local`).

Checks without Solana at all:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

### Devnet

```bash
npm run provision    # airdrops to the burner principal; if rate-limited, fund the
                     # printed address at https://faucet.solana.com and re-run
npm run dev
```

The provision script needs about 1 SOL on the burner principal. It gives the agent 0.5 SOL for fees. Keys are reused from `.keys/` across runs; each run creates a fresh mint and mandate.

## How it works

```mermaid
flowchart LR
  U[player prompt] --> B[brain: LLM with pay tool]
  B -- no tool call --> H[held]
  B -- "pay(to, amount)" --> R[resolve payee + score against live mandate]
  R --> A["Layer A: capline/solana preflight (off-chain)"]
  A -- jailbroken --> F["forced settle(), skipPreflight"]
  A -- legit and allowed --> S["settle() to the vendor"]
  F --> C{{"Capline program on Solana"}}
  S --> C
  C -- reverts: PerTxCapExceeded, MerchantNotAllowed, ... --> X[public failed tx]
  C -- transfers --> V[vendor token account]
  X --> D[(attempt store: feed, counters, share card)]
  V --> D
  C -. live balance of attacker sink .-> P["paid out (read from chain)"]
```

One turn (`lib/leash.ts`):

1. **Brain.** The model sees the conversation, its standing orders and one tool. The system prompt is not a security control; it is the thing players break.
2. **Payee resolution** (`lib/chain.ts`). The model can type anything into `to`. The vendor's name or address maps to the allowlisted vendor. Any valid Solana address is used as the merchant as-is. Anything else ("my wallet", `0x…`) maps to a burner attacker. Every non-vendor payee is pointed at the **attacker sink token account**, so if a theft ever succeeded, the tokens could only land there.
3. **Scoring** (`lib/score.ts`) against the mandate read live from chain, mirroring the checks in Capline's `settle`:
   - **jailbroken**: a non-allowlisted payee, or over the per-tx or total cap.
   - **held**: no tool call; a zero, negative or non-numeric amount; or an otherwise allowed payment on an expired or revoked mandate.
   - **legit**: the vendor, within caps.
4. **Layer A.** The published `capline/solana` SDK (`withCapline().preflight`) reads the mandate and refuses. Logged as "the policy said no".
5. **Layer B.** A jailbroken payment is **force-submitted anyway**: signed by the agent's real key, sent with `skipPreflight`, so it lands in a block and the program reverts it there. Every jailbreak leaves a failed transaction anyone can open in the explorer. A legit payment is settled normally and really pays the vendor.
6. **Store.** The attempt (prompt, reply, brain, tool call, payee, violations, Layer A verdict, signature and error) goes to the store for the feed and share card.

**"Paid out" is not a counter.** It is the live balance of the attacker sink token account, read from chain on every stats request. If the RPC is unreachable the page shows `$?`, never `$0.00`. The jailbroken / held / reverted counts come from the store and are bookkeeping only.

## Usage reference

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `dev:local` | Next dev server against devnet / localnet |
| `npm run build`, `npm start` | Production build and server |
| `npm run lint`, `format` | Biome check / write |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (`node:test` via tsx), offline |
| `npm run validator` | `solana-test-validator` with Capline at its devnet address; extra args pass through (e.g. `-- --reset`) |
| `npm run provision` / `provision:local` | Burner keys, test mint, `create_mandate`, `attest_ap2`, funded vault, `deployments/<cluster>.json` |
| `npm run e2e` / `e2e:local` | Six real turns through the full pipeline from the CLI |

### HTTP API

| Route | Returns |
|---|---|
| `POST /api/chat` `{prompt, history}` | `{attempt}`; 400 bad input, 429 rate limited, 503 limiter unavailable, 502 turn failed |
| `GET /api/stats` | Counters (`null` if storage is down) and chain balances (`null` if the RPC is down) |
| `GET /api/attempts?view=fame\|recent&n=1..50` | `{view, items}`; 503 if storage is down |
| `GET /api/attempts/:id` | `{attempt}` or 404 |
| `/a/:id` | Share page and OG image for one attempt |

### Environment variables

All optional. `.env.example` has the same list with comments. Next reads `.env.local`; the tsx scripts read only the shell environment.

| Variable | Default | Purpose |
|---|---|---|
| `LEASH_CLUSTER` | `devnet` | `devnet` or `localnet`. Anything else throws. |
| `LEASH_RPC_URL` | public devnet / `127.0.0.1:8899` | RPC override. URLs naming mainnet are refused, and the RPC's genesis hash must not be mainnet's. |
| `GROQ_API_KEY` | | Groq brain |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model (`LEASH_LLM_MODEL` wins if set) |
| `LEASH_LLM_BASE_URL`, `LEASH_LLM_API_KEY` | | Any OpenAI-compatible provider; takes precedence over Groq |
| `LEASH_LLM_MODEL` | `gpt-4o-mini` | Model for the provider above |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | | Upstash / Vercel KV REST store, shared across instances |
| `LEASH_DATA_FILE` | `.data/attempts.jsonl` | Local store file when KV is unset (memory on Vercel) |
| `LEASH_AGENT_SECRET` | `.keys/agent.json` | Agent keypair as a JSON byte array. Server-only secret. |
| `LEASH_DEPLOYMENT_JSON` | `deployments/<cluster>.json` | Deployment as inline JSON |
| `LEASH_RL_PER_MIN` | `6` | Attempts per IP per minute |
| `LEASH_RL_PER_DAY` | `120` | Attempts per IP per day |
| `LEASH_RL_SALT` | `leash` | Salt for IP hashes. Set a random secret in public deployments. |
| `LEASH_FORCE_PER_DAY` | `2000` | Global cap on forced reverts per UTC day |
| `LEASH_FORCE_ONCHAIN` | `1` | `0` disables forced reverts (kill switch) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Absolute URL for OG cards. The only public variable. |
| `LEASH_MAX_PER_TX`, `LEASH_TOTAL_CAP`, `LEASH_VAULT_FUND` | `5`, `1000`, `1000` | Provision: mandate caps and vault funding, whole tokens |
| `LEASH_MANDATE_DAYS`, `LEASH_VENDOR_NAME`, `LEASH_AGENT_SOL` | `90`, `Kibble Co.`, `0.5` | Provision: expiry, vendor label, agent fee float |
| `CAPLINE_SO` | | Validator: local Capline program binary |

## Security model and limitations

**This is a demo of enforcement, not a bounty.** The vault holds a worthless test token on devnet. There is no prize, and nothing here should be read as an offer to pay anyone.

What the demo shows: an agent whose model is fully compromised still cannot pay anyone outside the mandate, or more than its caps, because the Capline program checks every `settle`. The model never sees a key, and the guarantees do not depend on the prompt, the app code or Layer A.

What it does **not** protect against or prove:

- **A Capline program bug.** The program is the whole security story, and it has not been audited. A bug in `settle` defeats everything above it.
- **Payments to the vendor up to the caps.** That is allowed by design. A cap breach to the vendor would show up as vendor balance, not as "paid out"; "paid out" measures off-allowlist leakage only.
- **Agent key compromise.** The agent key is a hot key on the server. If it leaks, the attacker is bounded by the mandate exactly like the model is: vendor only, within caps. They can also burn the agent's SOL on fees. Response: revoke the mandate with the principal key, provision a new one, rotate `LEASH_AGENT_SECRET`. Keep the agent's SOL float small.
- **Principal key compromise.** The principal can revoke, withdraw unspent funds and create mandates. In this demo it is a burner in `.keys/` on the operator's machine and is never deployed.
- **Abuse and fee drain.** Every jailbreak costs a real fee. Per-IP limits (in memory per instance unless KV is configured) and the global `LEASH_FORCE_PER_DAY` budget bound it; there is no captcha or bot protection. Behind a proxy that does not overwrite `X-Forwarded-For`, clients share or spoof buckets; on Vercel the header is set by the platform.
- **Privacy.** Every prompt is public in the feed and on share cards. IPs are only kept as salted, truncated SHA-256 hashes in rate-limit keys with a TTL.

Hardening in this repo: the devnet guard checks the cluster name, the RPC URL and the RPC's genesis hash, so a mainnet RPC behind an innocent URL is refused; the agent key file is excluded from Next's build output tracing; key parse errors never echo the key; RPC credentials are stripped from deployment files and explorer links; the limiter and revert budget fail closed when storage is down; storage and RPC outages show as unknown instead of zero.

### What mainnet would need

Not a config flip. `lib/config.ts` refuses mainnet, and lifting that should be a reviewed code change after:

1. **An audit** of the Capline Anchor program, then a mainnet deploy with the upgrade authority on a **multisig** or frozen.
2. **Key custody**: the principal on a multisig or hardware wallet; the agent key in a KMS or HSM signer rather than an env var; monitoring and auto-revoke on anomalies.
3. **Abuse controls**: captcha or wallet-gated attempts, bot protection on `/api/chat`, KV-backed limits, alerting on the agent's SOL.
4. **Legal review**: a public "try to take the money" game with real funds can read as a contest, a bounty or gambling depending on jurisdiction. It needs terms of use and a clear no-prize statement.

See [SECURITY.md](SECURITY.md) for reporting.

## Deploying to Vercel (devnet)

1. Run `npm run provision` and commit `deployments/devnet.json` (public addresses only; RPC credentials are stripped).
2. Set `LEASH_CLUSTER=devnet`, `LEASH_AGENT_SECRET` (the byte array from `.keys/agent.json`), `GROQ_API_KEY`, `LEASH_RL_SALT` (random) and `NEXT_PUBLIC_SITE_URL`. Use a dedicated devnet RPC via `LEASH_RPC_URL`; the public one rate-limits.
3. Add an Upstash Redis integration (sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`). Without it, counters and limits are per instance and reset on cold starts.
4. Never upload `.keys/`. `.vercelignore` excludes it, and the build never traces it.

## Known issues

- **`"type": "module"` is required (Capline SDK interop).** `capline/solana` does `import anchor from "@coral-xyz/anchor"` and destructures `BN` from it. `@coral-xyz/anchor` is CommonJS. If a consumer's toolchain down-levels the SDK to CJS (for example tsx in a project without `"type": "module"`), that default import is `undefined` and the SDK crashes at import time when it destructures `BN`. This repo sets `"type": "module"` in `package.json` so Node, tsx and Next all load it as ESM. Upstream fix: `import * as anchor`, or `anchor.default ?? anchor`. Do not remove the field until the SDK ships that fix.
- **Dependency advisories.** `npm audit` reports advisories in `@solana/web3.js` 1.x, `@solana/spl-token`, `@coral-xyz/anchor` and their transitive deps (`bigint-buffer`, `jayson`, `toml`, `uuid`). Fixing them means moving to `@solana/web3.js` v2+/v3, which Anchor 0.31 and the Capline SDK do not support yet.
- **Devnet deployment.** `deployments/devnet.json` is not committed yet: the public devnet faucet rate-limited provisioning at build time. The local validator path is verified.

## Prior art

- [Freysa](https://www.freysa.ai/): an LLM guarding a prize pool, eventually talked into paying. The Leash keeps the jailbreak and removes the payout.
- [Gandalf by Lakera](https://gandalf.lakera.ai/) and [HackAPrompt](https://arxiv.org/abs/2311.16119): public prompt-injection games that measure how often models break. The Leash assumes they break and measures whether money moves.
- [Capline](https://github.com/agnij-dutta/capline): the on-chain spend authority (AP2 mandate: per-tx cap, total cap, expiry, allowlist) this app enforces through.

## Roadmap

- Provision and publish a public devnet instance.
- Captcha or wallet-gated attempts, and alerting on the agent's SOL balance.
- Run the local validator end to end in CI once a cached program binary is available.
- Move to `@solana/web3.js` v2+ when Anchor and the Capline SDK support it.
- Track Capline's audit; mainnet only after the checklist above.

## Contributing, license, author

[CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) · [MIT](LICENSE)

Built by Agnij Dutta ([@0xholmesdev](https://x.com/0xholmesdev)). The OG font is Archivo Black (SIL Open Font License), in `assets/`.
