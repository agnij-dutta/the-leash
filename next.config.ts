import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  // deployments/<cluster>.json is read at runtime by the API routes.
  outputFileTracingIncludes: { "/**": ["./deployments/**", "./assets/**"] },
  // The file tracer follows `path.join(process.cwd(), ".keys", "agent.json")`
  // in lib/config.ts and would copy the agent's SECRET KEY (and the local
  // attempt log) into the server bundle. Serverless deploys must use
  // LEASH_AGENT_SECRET instead; never ship the key file.
  outputFileTracingExcludes: { "/**": ["./.keys/**", "./.data/**", "./.local/**", "./.env*"] },
  serverExternalPackages: ["@coral-xyz/anchor", "@solana/web3.js", "@solana/spl-token", "capline"],
};

export default nextConfig;
