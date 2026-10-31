"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Navbar } from "./navbar";

export function SuiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const site = pathname.split("/")[1] || "portfolio";
  return <div data-suite-theme={site} className="suite-frame">
    <a href="#suite-content" className="suite-skip">Skip to main content</a>
    <Navbar />
    <div id="suite-content" className="suite-content" tabIndex={-1}>{children}</div>
    <footer className="suite-footer"><span>Business Suite <span aria-hidden="true">/</span> Interactive portfolio</span><span>Demo data · TWD · Asia/Taipei</span></footer>
  </div>;
}
