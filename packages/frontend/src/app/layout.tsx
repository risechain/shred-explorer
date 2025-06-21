import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const interFont = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const monoFont = Roboto_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RISE Shred Explorer",
  description: "Explore the RISE Chain testnet - track blockchain statistics, view blocks and transactions in real-time on the Based Gigagas EVM Layer 2.",
  openGraph: {
    type: "website",
    title: "RISE Shred Explorer",
    description: "Explore the RISE Chain testnet - track blockchain statistics, view blocks and transactions in real-time on the Based Gigagas EVM Layer 2.",
    images: [
      {
        url: "https://opengraph.b-cdn.net/production/images/423afeff-c644-460a-b980-ef33291781d5.png?token=YGQfIyMomwrXDT_1udttTAWVj_Q2J1q8SL1qVfMEQ4g&height=677&width=1200&expires=33262480069",
        width: 1200,
        height: 677,
        alt: "RISE Shred Explorer - Explore the RISE Chain testnet",
      },
    ],
    siteName: "RISE",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "RISE Shred Explorer",
    description: "Explore the RISE Chain testnet - track blockchain statistics, view blocks and transactions in real-time.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${interFont.variable} ${monoFont.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
