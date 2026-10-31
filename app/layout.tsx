import type { Metadata } from "next";
import "./globals.css";
import { SuiteFrame } from "@/components/suite-frame";

export const metadata: Metadata = {
  title: "Business Suite Portfolio | Six Business Systems",
  description:
    "Explore manufacturing, operations, retail, customer relationships, dining and commerce in six connected business workspaces.",
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
      <body className="antialiased min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans selection:bg-stone-200">
        <SuiteFrame>{children}</SuiteFrame>
      </body>
    </html>
  );
}
