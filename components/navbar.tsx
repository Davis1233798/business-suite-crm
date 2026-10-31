"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import platformStyles from "./platform-dashboard.module.css";
import mesStyles from "@/app/mes/mes-workbench.module.css";
import {
  Layers,
  Factory,
  Database,
  Calculator,
  Users,
  UtensilsCrossed,
  ShoppingBag,
  SlidersHorizontal,
  Home,
  Menu,
  X,
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const isPlatform = pathname === "/platform";
  const isMes = pathname === "/mes" || pathname.startsWith("/mes/");
  const [menuOpen, setMenuOpen] = useState(false);

  const [stationBase, setStationBase] = useState(process.env.NEXT_PUBLIC_STATION_URL || "https://station.blockchen.duckdns.org");
  useEffect(() => { if (!process.env.NEXT_PUBLIC_STATION_URL && ["localhost", "127.0.0.1"].includes(window.location.hostname)) setStationBase(`${window.location.protocol}//${window.location.hostname}:8095`); }, []);
  const stationLogin = (href: string) => `${stationBase}/${href === "/commerce" ? "shop" : href.slice(1)}/login`;
  const navItems = [
    { label: "Portfolio", href: "/", icon: Home },
    { label: "Infrastructure", href: "/platform", icon: Layers },
    { label: "MES Manufacturing", href: "/mes", icon: Factory },
    { label: "ERP Operations", href: "/erp", icon: Database },
    { label: "POS Retail", href: "/pos", icon: Calculator },
    { label: "CRM Customers", href: "/crm", icon: Users },
    { label: "Dining", href: "/dining", icon: UtensilsCrossed },
    { label: "E-commerce", href: "/shop", icon: ShoppingBag },
    { label: "Commerce Admin", href: "/commerce", icon: SlidersHorizontal },
  ];

  return (
    <header data-suite-navigation className={`suite-navigation sticky top-0 z-50 w-full border-b border-stone-200 bg-white/95 backdrop-blur-md ${isPlatform ? platformStyles.navigation : ""} ${isMes ? mesStyles.navigation : ""}`}>
      {/* Main Navigation */}
      <div className="suite-nav-main">
        <Link href="/" className="suite-brand">
          <div data-suite-brand className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-black text-sm">
            BS
          </div>
          <div className="flex flex-col leading-tight">
            <span>Business Suite</span>
            <span className="text-[10px] font-normal text-stone-500 tracking-normal">Business systems portfolio</span>
          </div>
        </Link>

        <nav aria-label="System navigation" className="suite-desktop-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href === "/" || item.href === "/platform" ? item.href : stationLogin(item.href)}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition ${
                  isActive
                    ? "bg-blue-50 text-primary font-semibold"
                    : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-stone-900" : "text-stone-500"}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile Nav Button */}
        <div className="suite-menu-toggle">
          <button onClick={() => setMenuOpen(!menuOpen)} aria-controls="suite-mobile-menu" aria-expanded={menuOpen} aria-label={menuOpen ? "Close navigation" : "Open navigation"} className="p-2 rounded-lg border border-stone-200">{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
        </div>
      </div>
      {menuOpen && <nav id="suite-mobile-menu" aria-label="Mobile system navigation" className="suite-mobile-nav">{navItems.map(item => <Link key={item.href} href={item.href === "/" || item.href === "/platform" ? item.href : stationLogin(item.href)} onClick={() => setMenuOpen(false)} aria-current={pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/")) ? "page" : undefined} className={`flex items-center gap-2 p-3 rounded-lg text-xs ${pathname === item.href ? "bg-primary text-white" : "bg-stone-50 text-stone-700"}`}><item.icon size={16}/>{item.label}</Link>)}</nav>}
    </header>
  );
}
