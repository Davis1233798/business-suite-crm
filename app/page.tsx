"use client";
import SpotlightCard from "@/components/react-bits/SpotlightCard";
import { useEffect, useState } from "react";
import Link from "next/link";
import { WorkspaceTools } from "@/components/workspace-tools";
import { ArrowUpRight, Factory, Database, Calculator, Users, UtensilsCrossed, ShoppingBag, ArrowRight, Code2 } from "lucide-react";

const projects = [
  { id: "mes", name: "ForgeFlow", category: "製造", title: "讓生產現場，每一步都有跡可循。", description: "工單進度、現場報工、物料批次與品質紀錄，集中在同一個製造工作台。", icon: Factory, color: "#2563eb", steps: ["工單與備料", "良品／報廢報工", "物料與品檢追溯"], limitation: "設備資料須有對應服務連線；產能排程與完整重工流程仍待擴充。" },
  { id: "erp", name: "LedgerWorks", category: "營運", title: "從一件庫存，走到一筆清楚的帳。", description: "採購收貨、倉庫調撥、銷售出貨與帳款核銷，讓單據與庫存變化連在一起。", icon: Database, color: "#047857", steps: ["採購審核與收貨", "跨倉調撥", "帳款與試算表"], limitation: "採簡化會計；正式電子發票、稅務申報與銀行串接另行建置。" },
  { id: "pos", name: "CounterPoint", category: "零售", title: "把結帳變簡單，把交易留下來。", description: "條碼購物籃、現金找零、交易小票、掛單與班結，服務門市的日常節奏。", icon: Calculator, color: "#b45309", steps: ["掃碼與購物籃", "現金結帳與小票", "退款與交班"], limitation: "目前為在線收銀展示，尚未連接實體收銀設備或正式發票。" },
  { id: "crm", name: "RelationDesk", category: "客戶", title: "每一次聯繫，都能成為下一個機會。", description: "從潛客轉換到商機階段，把聯絡人、跟進活動與客服需求放在同一條脈絡。", icon: Users, color: "#7c3aed", steps: ["潛客轉換", "商機與加權漏斗", "活動與客服追蹤"], limitation: "郵件與簡訊尚未串接；進階業務團隊權限與合併流程待擴充。" },
  { id: "dining", name: "TableCraft", category: "餐飲", title: "從入座到出餐，接住每一張訂單。", description: "桌位開桌、菜單點餐、廚房工作站與帳單結算，串起前場和後場的協作。", icon: UtensilsCrossed, color: "#be123c", steps: ["桌位與點餐", "廚房 KDS", "帳單與模擬結算"], limitation: "付款為模擬流程；正式金流與廚房硬體另行串接。" },
  { id: "shop", name: "MarketLane", category: "電商", title: "從挑選喜歡，到收到期待。", description: "商品規格、購物車、優惠碼與訂單追蹤，搭配獨立營運後台處理付款與出貨。", icon: ShoppingBag, color: "#4338ca", steps: ["規格與購物車", "優惠碼與下單", "模擬付款與履約"], limitation: "付款、物流均為模擬適配器，沒有實際扣款或建立物流託運。" },
];

export default function PortfolioPage() {
  const [stationBase, setStationBase] = useState("");
  useEffect(() => {
    const configured = process.env.NEXT_PUBLIC_STATION_URL;
    if (configured) setStationBase(configured.replace(/\/$/, ""));
    else if (["localhost", "127.0.0.1"].includes(window.location.hostname)) setStationBase(`${window.location.protocol}//${window.location.hostname}:8095`);
  }, []);
  const [filter, setFilter] = useState("全部作品");
  const [selected, setSelected] = useState<string | null>(null);
  const visible = projects.filter(p => filter === "全部作品" || (filter === "營運與製造" ? ["mes", "erp"].includes(p.id) : !["mes", "erp"].includes(p.id)));
  return <main data-site="portfolio" className="portfolio-page">
    <section className="portfolio-hero"><div className="aurora-field" aria-hidden="true"><i/><i/><i/><div className="aurora-grid"/></div>
      <div className="portfolio-hero-copy"><p className="portfolio-eyebrow"><Code2 size={15}/> BUILT FOR THE WAY YOU WORK</p>
        <h1>讓複雜，<br/><span>流暢運作。</span></h1>
        <p className="portfolio-lead">從生產現場到每一次消費。六套可操作的商業系統，<br className="hidden md:block"/>將介面、資料與業務流程，連成完整的體驗。</p>
        <div className="portfolio-hero-actions"><a href="#work" className="portfolio-primary">探索六套作品 <ArrowRight size={16}/></a><a href="#about" className="portfolio-secondary">了解工程實作 <ArrowUpRight size={16}/></a></div>
        <p className="portfolio-meta">互動展示 · 繁體中文 · 示範資料</p>
      </div>
      <div className="hero-ecosystem"><div className="orbital-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core"><span>BS</span><small>CONNECTED BUSINESS</small></div><span className="orbit-label label-one">DESIGN</span><span className="orbit-label label-two">BUILD</span><span className="orbit-label label-three">CONNECT</span></div><div className="portfolio-system-map"><div className="map-title"><span>THE BUSINESS ECOSYSTEM</span><span>01 — 06</span></div><div className="map-grid">{projects.map((p,i)=><Link href={`/${p.id}`} key={p.id}><p.icon size={22} strokeWidth={1.4}/><span><b>{p.name}</b><small>{p.category}工作區</small></span><span className="map-number">0{i+1}</span></Link>)}</div><div className="map-caption"><span className="map-dot"/>六個領域，一個展示空間</div></div></div>
    </section>
    <div className="portfolio-facts"><div><strong>06</strong><span>業務領域</span></div><div><strong>08</strong><span>前台與工作區入口</span></div><div><strong>React + TypeScript</strong><span>互動介面與資料流程</span></div><Link href="/platform">基礎設施中心 <ArrowUpRight size={17}/></Link></div>
    <section id="work" className="portfolio-work">
      <div className="portfolio-section-heading"><div><p className="portfolio-eyebrow">01 / APPLICATIONS</p><h2>每個業務，都有自己的工作方式。</h2><p>選擇一套系統，從真實操作理解背後的設計。</p></div><div className="portfolio-filters" aria-label="作品篩選">{["全部作品","營運與製造","銷售與服務"].map(f=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f}</button>)}</div></div>
      <div className="portfolio-cards">{visible.map(p=><SpotlightCard key={p.id} className="project-spotlight" spotlightColor={p.color} intensity={0.16} borderGlow={0.8} theme="light">
        <div className="project-visual" data-project={p.id}><span className="project-icon"><p.icon size={38} strokeWidth={1.2}/></span><span className="project-watermark" aria-hidden="true">{p.id.toUpperCase()}</span><div className="project-flow">{p.steps.map((step,i)=><div key={step}><span>0{i+1}</span><b>{step}</b><span className="flow-line"/></div>)}</div><span className="project-category">{p.category} / {p.id.toUpperCase()}</span></div>
        <div className="project-body"><p className="project-name">{p.name}<ArrowUpRight size={17}/></p><h3>{p.title}</h3><p className="project-description">{p.description}</p>
          {selected===p.id&&<div className="project-boundary" id={`boundary-${p.id}`}><b>展示範圍</b><p>{p.limitation}</p><p>初始資料為內建示範資料；角色切換用於體驗不同操作權限。</p></div>}
          <div className="project-actions"><button aria-expanded={selected===p.id} aria-controls={selected===p.id?`boundary-${p.id}`:undefined} onClick={()=>setSelected(selected===p.id?null:p.id)}>{selected===p.id?"收起範圍說明":"案例與展示範圍"}</button><Link href={`/${p.id}`}>互動展示 <ArrowRight size={15}/></Link></div>{stationBase && <a className="station-entry" href={`${stationBase}/${p.id}/front`} target="_blank" rel="noreferrer">登入獨立工作站 <ArrowUpRight size={14}/></a>}
        </div>
      </SpotlightCard>)}</div>
    </section>
    <section id="about" className="portfolio-about"><div><p className="portfolio-eyebrow">02 / BUILT UNDERNEATH</p><h2>畫面之下，<br/>每個動作都有脈絡。</h2><p>訂單如何改變庫存、付款如何核銷、報工如何留下紀錄。介面之外，業務結果也需要能被查證。</p><Link href="/platform">探索基礎設施 <ArrowUpRight size={15}/></Link></div><div className="portfolio-capabilities">{[["01","介面與互動","響應式工作區、表單驗證與清楚的操作回饋。"],["02","資料與流程","同源 API、持久化資料、領域服務與交易紀錄。"],["03","驗證與交付","以既有測試檢查金額、庫存與狀態轉換；正式外部服務另行整合。"]].map(([n,t,d])=><div key={n}><span>{n}</span><div><h3>{t}</h3><p>{d}</p></div></div>)}</div></section>
    <section className="portfolio-tools"><div className="portfolio-section-heading"><div><p className="portfolio-eyebrow">03 / YOUR WORKSPACE</p><h2>把操作紀錄，留在自己的空間。</h2></div></div><WorkspaceTools/></section>
  </main>;
}
