import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AEGIS — Autonomous Commerce Trust Platform", template: "%s · AEGIS" },
  description: "AI can act. AEGIS makes sure it acts responsibly. Governance, policy and human control between AI commerce agents and PayPal.",
};

export const viewport: Viewport = { themeColor: "#050608" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
