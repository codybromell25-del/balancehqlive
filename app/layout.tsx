import type { Metadata } from "next";
import { Libre_Baskerville, Raleway } from "next/font/google";
import "./globals.css";

// balance's own type: Libre Baskerville for the wordmark and headings,
// Raleway for everything else. next/font serves both from this app, which
// the content security policy requires (font-src 'self').
const serif = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-baskerville",
  display: "swap",
});

const sans = Raleway({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-raleway",
  display: "swap",
});

export const metadata: Metadata = {
  title: "balanceHQ",
  description: "Studio reporting and instructor documents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
