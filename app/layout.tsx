import type { Metadata } from "next";
import "./globals.css";
import { SuiteFrame } from "@/components/suite-frame";

export const metadata: Metadata = {
  title: "Business Suite Portfolio | 六套企業商業系統展示平台",
  description:
    "包含 MES製造管理、ERP進銷存財、POS門市收銀、CRM客戶關係、餐飲桌位KDS、電商網路通路的完整持久化全端架構與業務規則實作。",
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
    <html lang="zh-TW">
      <body className="antialiased min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans selection:bg-stone-200">
        <SuiteFrame>{children}</SuiteFrame>
      </body>
    </html>
  );
}
