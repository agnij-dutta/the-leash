#!/usr/bin/env bash
# Boot a local Solana validator with the Capline program preloaded at its
# devnet address, so `npm run provision:local` needs no faucet.
#
# Program binary, first match wins:
#   1. .local/capline.so (cached from a previous run)
#   2. $CAPLINE_SO, e.g. a local `anchor build` of the Capline repo
#   3. `solana program dump` from devnet (read-only, no keys)
#
# Extra arguments go to solana-test-validator (e.g. --reset).
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
PROGRAM_ID=DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp
mkdir -p .local
if [ ! -f .local/capline.so ]; then
  if [ -n "${CAPLINE_SO:-}" ]; then
    cp "$CAPLINE_SO" .local/capline.so
  else
    solana program dump -u devnet "$PROGRAM_ID" .local/capline.so
  fi
fi
exec solana-test-validator --quiet --ledger .local/ledger --bpf-program "$PROGRAM_ID" .local/capline.so "$@"
