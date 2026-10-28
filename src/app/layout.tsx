import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { DemoRoot } from "@/components/demo";

export const metadata: Metadata = {
  title: { default: "VANTA — Trust Layer for Agentic Commerce", template: "%s · VANTA" },
  description: "AI agents can act. VANTA makes sure they act within policy. Governance, policy and human control between AI commerce agents and PayPal.",
};

export const viewport: Viewport = { themeColor: "#050608" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-fg">
        <DemoRoot>{children}</DemoRoot>
      </body>
    </html>
  );
}
