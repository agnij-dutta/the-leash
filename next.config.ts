import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  // deployments/<cluster>.json is read at runtime by the API routes
  outputFileTracingIncludes: { "/**": ["./deployments/**", "./assets/**"] },
  serverExternalPackages: ["@coral-xyz/anchor", "@solana/web3.js", "@solana/spl-token", "capline"],
};

export default nextConfig;
