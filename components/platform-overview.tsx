import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Calculator, Code2, Database, Factory, GitBranch, Info, Layers, Server, ShoppingBag, Users, UtensilsCrossed, Workflow } from "lucide-react";
import registry from "@/infra/sites.json";
import graph from "@/infra/control/services.json";
import { PlatformControl } from "@/components/platform-control";
import s from "@/components/platform-dashboard.module.css";

const applications = {
  mes: { label: "製造執行", detail: "工單追溯 · 生產報工 · 工業資料", short: "MES", icon: Factory, color: "#5e6ad2" },
  erp: { label: "企業營運", detail: "採購銷售 · 庫存調撥 · 雙式帳務", short: "ERP", icon: Database, color: "#0057d2" },
  pos: { label: "門市收銀", detail: "商品收銀 · 班別交接 · 原單退貨", short: "POS", icon: Calculator, color: "#171717" },
  crm: { label: "客戶關係", detail: "商機看板 · 報價核准 · 客服追蹤", short: "CRM", icon: Users, color: "#6f4bb2" },
  dining: { label: "餐飲營運", detail: "桌位預約 · 廚房出餐 · 分單結帳", short: "DINING", icon: UtensilsCrossed, color: "#006241" },
  shop: { label: "電商通路", detail: "商品選購 · 訂單付款 · 營運履約", short: "SHOP", icon: ShoppingBag, color: "#171717" },
};
const phases = [["定義", "Acceptance"], ["失敗測試", "Red"], ["最小實作", "Green"], ["重構", "Refactor"], ["驗證", "Verify"], ["觀測", "Observe"]];

export function PlatformOverview() {
  return <main data-site="portfolio" className={s.shell}><div className={s.frame}>
    <div className={s.workspace}><span className={s.workspaceIcon}><Layers size={15}/></span><span className={s.workspaceLabel}>Business Suite</span><span className={s.slash}>/</span><span className={s.workspaceLabel}>Infrastructure</span><span className={s.environment}>Development</span></div>
    <section className={s.hero} aria-labelledby="platform-title">
      <div><p className={s.eyebrow}><Code2 size={14}/> BUSINESS SUITE / CONTROL PLANE</p><h1 id="platform-title">所有系統。<br/><span>一處掌握。</span></h1><p className={s.lead}>管理六個業務分站的基礎設施與服務依賴。<br/>從操作計畫到執行驗證，讓每一次變更都有依據。</p><div className={s.actions}><a href="#operations" className={s.primary}>管理服務 <ArrowRight size={15}/></a><a href="#stations" className={s.secondary}>瀏覽分站 <Layers size={15}/></a></div></div>
      <div className={s.topology} role="img" aria-label="架構示意：主站控制平台管理 MES、ERP、POS、CRM、餐飲與電商六個分站；各分站使用獨立 Web 服務。"><div className={s.topologyCaption}>SYSTEM OVERVIEW<span>IaC / v{registry.version}</span></div><div className={s.controlNode}><Layers size={25} strokeWidth={1.4}/><div><b>Business Suite</b><small>Infrastructure control plane</small></div></div><div className={s.branch}/><div className={s.nodeGrid}>{registry.sites.map(site=>{const app=applications[site.id as keyof typeof applications];return <div key={site.id} className={s.node}><app.icon size={13} strokeWidth={1.5}/>{app.short}</div>;})}</div><p className={s.topologyFoot}>6 applications · independent web runtimes</p></div>
    </section>
    <div className={s.metrics} aria-label="基礎設施配置摘要">
      <div className={s.metric}><p className={s.metricLabel}><Layers size={13}/>業務分站</p><p className={s.metricValue}>{String(registry.sites.length).padStart(2,"0")}<small>applications</small></p><p className={s.metricSub}>同一份配置，統一管理</p></div>
      <div className={s.metric}><p className={s.metricLabel}><Server size={13}/>受管服務</p><p className={s.metricValue}>{Object.keys(graph).length}<small>services</small></p><p className={s.metricSub}>即時狀態於連線後查詢</p></div>
      <div className={s.metric}><p className={s.metricLabel}><Database size={13}/>資料分片</p><p className={s.metricValue}>02<small>shards</small></p><p className={s.metricSub}>PostgreSQL · 租戶路由</p></div>
      <div className={s.metric}><p className={s.metricLabel}><GitBranch size={13}/>開發模式</p><p className={s.metricValue}>TDD + Loop</p><p className={s.metricSub}>測試 → 交付 → 迭代</p></div>
    </div>
    <div className={s.content}>
      <section id="stations" className={s.section} aria-labelledby="stations-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>01 / APPLICATIONS</p><h2 id="stations-title">每個業務，都有自己的工作區。</h2><p className={s.sectionDescription}>六個領域入口，連接同一份工程配置。</p></div><a href="#architecture" className={s.textLink}>查看架構 <ArrowUpRight size={14}/></a></div><div className={s.cards}>{registry.sites.map(site=>{const app=applications[site.id as keyof typeof applications];return <Link key={site.id} href={site.path} className={s.card}><div className={s.cardTop}><span className={s.appIcon} style={{color:app.color}}><app.icon size={20} strokeWidth={1.6}/></span><span className={s.route}>{site.path}</span></div><h3>{site.name}</h3><p>{app.label} · {app.detail}</p><div className={s.cardBottom}><span>{site.services.length?`${site.services.length} 項服務依賴`:"共用 Web 與業務資料"}</span><ArrowUpRight size={16}/></div></Link>;})}</div><p className={s.sharedNote}><Info size={13}/>分站 Web 可獨立啟停；資料庫與入口仍共用，計畫會列出受影響的分站。</p></section>
      <section id="operations" className={s.section} aria-labelledby="operations-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>02 / OPERATIONS</p><h2 id="operations-title">先規劃，再讓變更發生。</h2><p className={s.sectionDescription}>查看實際狀態，核對影響範圍，再執行啟停或重新啟動。</p></div></div><PlatformControl/></section>
      <section id="architecture" className={s.section} aria-labelledby="architecture-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>03 / BUILT UNDERNEATH</p><h2 id="architecture-title">介面之下，也有章法。</h2></div></div><div className={s.architecture}>
        <article className={s.feature}><div className={s.featureTitle}><ShoppingBag size={19}/><h3>電商，讓請求有序流動。</h3></div><p>商品描述由 Redis 緩存；付款事件先寫入 Outbox，再送入持久隊列。價格與庫存仍以交易資料為準。</p><div className={s.flow}><span>付款</span><ArrowRight size={12}/><span>Outbox</span><ArrowRight size={12}/><span>RabbitMQ</span></div></article>
        <article className={s.feature}><div className={s.featureTitle}><Activity size={19}/><h3>製造，從設備訊號到工單。</h3></div><p>MQTT 收集設備量測，時序資料庫保留訊號；工單異動同步至 PostgreSQL 分片查詢模型。</p><div className={s.flow}><span>MQTT</span><ArrowRight size={12}/><span>時序資料</span><ArrowRight size={12}/><span>異常追蹤</span></div><Link href="/mes/industrial" className={s.textLink}>查看工業資料 <ArrowUpRight size={13}/></Link></article>
      </div></section>
      <section className={s.section} aria-labelledby="loop-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>04 / ENGINEERING LOOP</p><h2 id="loop-title">好的交付，是下一輪的起點。</h2><p className={s.sectionDescription}>每輪保留測試證據、驗證結果與尚未解決的問題。</p></div><Workflow size={22} strokeWidth={1.4}/></div><div className={s.loop}><ol className={s.loopSteps}>{phases.map(([label,english],index)=><li key={english}><span className={s.stepNumber}>{index+1}</span><b>{label}</b><small>{english}</small></li>)}</ol><div className={s.loopFooter}><code>$ npm run engineering:check</code><span>型別檢查 · 行為測試 · 正式建置</span></div></div></section>
    </div>
    <footer className={s.footer}><span>Business Suite / Infrastructure Console</span><Link href="/" className={s.textLink}>回到作品集 <ArrowUpRight size={13}/></Link></footer>
  </div></main>;
}
