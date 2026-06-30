import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Trench Desk",
  description:
    "Solana / pump.fun meme-coin trading desk — screens, alerts, vets, logs, and enforces discipline. It does not trade.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <span className="dot" />
              TRENCH&nbsp;DESK
            </div>
            <Nav />
            <span className="spacer" />
            <span className="mono dim" style={{ fontSize: 11 }}>
              find &amp; flag · the human executes
            </span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
