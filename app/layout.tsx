import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — temporary sharing",
  description: "Share text, files and folders across devices with an eight-digit room code.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
