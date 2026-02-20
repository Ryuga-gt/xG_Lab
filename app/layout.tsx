import type { Metadata } from "next";
import { Barlow_Condensed, Sora } from "next/font/google";

import "./globals.css";

const barlowCondensed = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const sora = Sora({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PitchPulse Football Dashboard",
  description:
    "Interactive football analytics dashboard built on Kaggle player-scores data and designed for Vercel deployment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${barlowCondensed.variable} ${sora.variable}`}>{children}</body>
    </html>
  );
}
