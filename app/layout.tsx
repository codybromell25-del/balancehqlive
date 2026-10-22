import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "balanceHQ",
  description: "Studio reporting and instructor documents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
