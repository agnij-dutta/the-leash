import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted from @fontsource-variable (OFL) instead of next/font/google, so
// `next build` never depends on reaching Google Fonts. A flaky fetch there
// used to fail fresh-clone and CI builds.
const archivo = localFont({
  src: "../node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
});
const jbMono = localFont({
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jbmono",
  weight: "100 800",
  display: "swap",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: "THE LEASH · jailbreak the agent, it still pays $0",
  description:
    "An AI agent that holds a treasury and is meant to be jailbroken. The jailbreak works. The theft does not: every payment is enforced on-chain by Capline.",
  metadataBase: new URL(SITE),
  openGraph: {
    title: "THE LEASH · jailbreak the agent, it still pays $0",
    description: "The jailbreak succeeds. The theft does not. Spend limits enforced on-chain by Capline.",
    type: "website",
  },
  twitter: { card: "summary_large_image", creator: "@0xholmesdev" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${jbMono.variable} antialiased`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
