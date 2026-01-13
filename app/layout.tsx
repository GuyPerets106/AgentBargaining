import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";

import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Negotiation Lab",
  description: "Multi-issue negotiation experiment",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} ${fraunces.variable}`}>
      <body className="min-h-screen">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
