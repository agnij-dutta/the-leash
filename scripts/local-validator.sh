#!/usr/bin/env bash
# Boot a local Solana validator with the Capline program preloaded at its
# devnet address. The program binary is dumped from devnet (read-only, no keys)
# or taken from a local Anchor build if present.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
PROGRAM_ID=DRNWDxtJ3P5hQCdGcmL3XXMW9NtnE345HTaWkk9dUhHp
mkdir -p .local
if [ ! -f .local/capline.so ]; then
  if [ -f "$HOME/Desktop/Capline/solana/target/deploy/capline.so" ]; then
    cp "$HOME/Desktop/Capline/solana/target/deploy/capline.so" .local/capline.so
  else
    solana program dump -u devnet "$PROGRAM_ID" .local/capline.so
  fi
fi
exec solana-test-validator --quiet --ledger .local/ledger --bpf-program "$PROGRAM_ID" .local/capline.so "$@"
