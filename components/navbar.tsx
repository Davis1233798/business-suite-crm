"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import platformStyles from "./platform-dashboard.module.css";
import mesStyles from "@/app/mes/mes-workbench.module.css";
import {
  ShieldCheck,
  RotateCcw,
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
  const [role, setRole] = useState<string>("admin");
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // Read role from cookie if set
    const match = document.cookie.match(/demo_user_role=([^;]+)/);
    if (match) {
      setRole(match[1]);
    }
  }, []);

  const handleRoleChange = (newRole: string) => {
    setRole(newRole);
    document.cookie = `demo_user_role=${newRole}; path=/; max-age=86400`;
    setMessage(`已切換為：${newRole === "admin" ? "系統管理員 (Admin)" : newRole === "operator" ? "現場作業主管 (Operator)" : "訪客 (唯讀 Readonly)"}`);
    setTimeout(() => setMessage(null), 3000);
    window.dispatchEvent(new Event("demo-role-change"));
  };

  const handleResetData = async () => {
    if (!confirm("確定要重置為標準示範資料嗎？所有手動變更將恢復為種子資料。")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/seed/reset", { method: "POST" });
      const data: any = await res.json();
      if (data.success) {
        setMessage("示範資料已成功重置！");
        setTimeout(() => window.location.reload(), 800);
      } else {
        alert("重置失敗：" + data.error?.message);
      }
    } catch (e: any) {
      alert("重置錯誤：" + e.message);
    } finally {
      setResetting(false);
    }
  };

  const navItems = [
    { label: "作品集", href: "/", icon: Home },
    { label: "基礎設施", href: "/platform", icon: Layers },
    { label: "MES 工單生產", href: "/mes", icon: Factory },
    { label: "ERP 進銷存財", href: "/erp", icon: Database },
    { label: "POS 門市收銀", href: "/pos", icon: Calculator },
    { label: "CRM 客戶商機", href: "/crm", icon: Users },
    { label: "餐飲 桌次出餐", href: "/dining", icon: UtensilsCrossed },
    { label: "電商 前台購物", href: "/shop", icon: ShoppingBag },
    { label: "電商 後台營運", href: "/commerce", icon: SlidersHorizontal },
  ];

  return (
    <header data-suite-navigation className={`suite-navigation sticky top-0 z-50 w-full border-b border-stone-200 bg-white/95 backdrop-blur-md ${isPlatform ? platformStyles.navigation : ""} ${isMes ? mesStyles.navigation : ""}`}>
      {/* Top Demo Bar */}
      <div className="suite-demo-bar">
        <div className="flex items-center gap-2">
          <span data-demo-badge className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono text-[10px] font-semibold border border-blue-200">
            互動展示 · 後端持久化
          </span>
          <span className="hidden sm:inline text-stone-500">
            六套商業系統展示空間 | 繁體中文 Asia/Taipei
          </span>
        </div>

        <div className="flex items-center gap-3">
          {message && (
            <span role="status" className="text-blue-700 font-medium">{message}</span>
          )}

          <div className="flex items-center gap-1.5">
            <label htmlFor="demo-role" className="text-stone-500">示範角色:</label>
            <select
              id="demo-role"
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="bg-white text-stone-700 rounded px-2 py-0.5 border border-stone-200 text-xs focus:outline-none focus:ring-1 focus:ring-stone-500"
            >
              <option value="admin">管理員 (Admin - 完整讀寫)</option>
              <option value="operator">現場作業員 (Operator)</option>
              <option value="readonly">訪客 (Readonly - 唯讀限制)</option>
            </select>
          </div>

          <button
            onClick={handleResetData}
            disabled={resetting}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-blue-50 text-stone-700 border border-stone-200 transition"
            title="重置為標準種子資料"
          >
            <RotateCcw className={`w-3 h-3 ${resetting ? "animate-spin" : ""}`} />
            <span>{resetting ? "重置中..." : "重置資料"}</span>
          </button>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="suite-nav-main">
        <Link href="/" className="suite-brand">
          <div data-suite-brand className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-black text-sm">
            BS
          </div>
          <div className="flex flex-col leading-tight">
            <span>Business Suite</span>
            <span className="text-[10px] font-normal text-stone-500 tracking-normal">全端開發 · 商業系統作品集</span>
          </div>
        </Link>

        <nav aria-label="系統導覽" className="suite-desktop-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
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
          <button onClick={() => setMenuOpen(!menuOpen)} aria-controls="suite-mobile-menu" aria-expanded={menuOpen} aria-label={menuOpen ? "關閉系統選單" : "開啟系統選單"} className="p-2 rounded-lg border border-stone-200">{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
        </div>
      </div>
      {menuOpen && <nav id="suite-mobile-menu" aria-label="行動版系統導覽" className="suite-mobile-nav">{navItems.map(item => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} aria-current={pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/")) ? "page" : undefined} className={`flex items-center gap-2 p-3 rounded-lg text-xs ${pathname === item.href ? "bg-primary text-white" : "bg-stone-50 text-stone-700"}`}><item.icon size={16}/>{item.label}</Link>)}</nav>}
    </header>
  );
}
