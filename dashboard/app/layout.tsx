import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import { AgentProvider } from "@/components/AgentContext";
import ChatPanel from "@/components/ChatPanel";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "TradeMind — Terminal",
  description: "IBKR options trading instrument",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Trancy) inject attributes
    // onto <html> before React hydrates, causing a harmless attribute mismatch.
    // This suppresses only this element's attribute warning, not its subtree.
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-screen">
        <AgentProvider>
          <Nav />
          <main className="max-w-7xl mx-auto px-4 py-7">{children}</main>
          <ChatPanel />
        </AgentProvider>
      </body>
    </html>
  );
}
