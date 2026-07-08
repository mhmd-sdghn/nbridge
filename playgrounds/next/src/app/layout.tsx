import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "nbridge/next playground",
  description: "App Router back-navigation demo for the nbridge/next entry",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>
          <h1>nbridge/next playground</h1>
          <p className="hint">
            Loopback mode — the bridge echoes its own messages, so a{" "}
            <code>shutdown</code> send comes straight back as an incoming
            message instead of closing a real WebView.
          </p>
          {children}
        </main>
      </body>
    </html>
  );
}
