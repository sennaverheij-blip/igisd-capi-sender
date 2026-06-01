import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IGSID → CAPI Sender",
  description: "Send Instagram DM conversion events to the Meta Conversions API.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
