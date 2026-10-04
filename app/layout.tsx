import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"] });
const jbMono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"], weight: ["400", "500", "700"] });

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
