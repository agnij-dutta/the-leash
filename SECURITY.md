# Security policy

The Leash is a public demo that invites people to jailbreak an AI agent. Jailbreaking the model is the game, not a vulnerability. What must hold is the money: no prompt, forged history or tool call should move vault funds outside the Capline mandate.

## Reporting

Report privately through GitHub's private vulnerability reporting: the **Security** tab of [agnij-dutta/the-leash](https://github.com/agnij-dutta/the-leash), then **Report a vulnerability**. Please do not open a public issue. Expect an acknowledgement within a few days.

There is no bug bounty and no prize. The vault holds devnet test tokens with no value.

## In scope

- Any path that makes a `settle` succeed for a non-allowlisted payee, or above the per-tx or total cap, through this app.
- Bypassing the devnet/localnet guard (`lib/config.ts`) so the app talks to mainnet.
- Leaking the agent secret key, LLM keys, KV tokens or RPC credentials to the browser, logs, share cards or `deployments/*.json`.
- Making "paid out" show a number that was not read from the attacker sink token account.
- Bypassing the per-IP rate limit or the daily forced-revert budget in a way that drains the agent's SOL.
- Stored XSS through prompts or replies on the feed or share pages.

## Out of scope

- Getting the model to call `pay` with anything. That is the point.
- Bugs in the Capline program itself: report those to the [Capline repo](https://github.com/agnij-dutta/capline).
- Volumetric DoS against a hosted instance, or the public devnet RPC rate limits.
- Dependency advisories with no reachable path in this app (see the README's known issues).

## Known non-goals

- **Prompts are public.** Every attempt is stored and shown in the feed. Do not type anything private.
- **The agent key is a hot key on a server.** If it leaks, the attacker is still bounded by the mandate (the vendor only, within caps) but can burn the agent's SOL on fees. See the README's threat model.
- **Not mainnet-ready.** Running against real funds needs an audit of the Capline program, a multisig or frozen upgrade authority, and legal review. The code refuses mainnet on purpose.
