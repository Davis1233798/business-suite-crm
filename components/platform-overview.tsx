import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Calculator, Code2, Database, Factory, GitBranch, Info, Layers, Server, ShoppingBag, Users, UtensilsCrossed, Workflow } from "lucide-react";
import registry from "@/infra/sites.json";
import graph from "@/infra/control/services.json";
import { PlatformControl } from "@/components/platform-control";
import s from "@/components/platform-dashboard.module.css";

const applications = {
  mes: { label: "Manufacturing execution", detail: "Work order traceability · Production reporting · Equipment data", short: "MES", icon: Factory, color: "#5e6ad2" },
  erp: { label: "Business operations", detail: "Purchasing and sales · Stock transfers · Double-entry accounting", short: "ERP", icon: Database, color: "#0057d2" },
  pos: { label: "Retail checkout", detail: "Checkout · Shift handover · Original-sale refunds", short: "POS", icon: Calculator, color: "#171717" },
  crm: { label: "Customer relations", detail: "Opportunity board · Quote approval · Support tracking", short: "CRM", icon: Users, color: "#6f4bb2" },
  dining: { label: "Dining operations", detail: "Reservations · Kitchen service · Split bills", short: "DINING", icon: UtensilsCrossed, color: "#006241" },
  shop: { label: "Commerce", detail: "Shopping · Order payments · Fulfillment", short: "SHOP", icon: ShoppingBag, color: "#171717" },
};
const phases = [["Define", "Acceptance"], ["Failing test", "Red"], ["Minimal implementation", "Green"], ["Refactor", "Refactor"], ["Verify", "Verify"], ["Observe", "Observe"]];

export function PlatformOverview() {
  return <main data-site="portfolio" className={s.shell}><div className={s.frame}>
    <div className={s.workspace}><span className={s.workspaceIcon}><Layers size={15}/></span><span className={s.workspaceLabel}>Business Suite</span><span className={s.slash}>/</span><span className={s.workspaceLabel}>Infrastructure</span><span className={s.environment}>Development</span></div>
    <section className={s.hero} aria-labelledby="platform-title">
      <div><p className={s.eyebrow}><Code2 size={14}/> BUSINESS SUITE / CONTROL PLANE</p><h1 id="platform-title">Every system.<br/><span>One place to manage.</span></h1><p className={s.lead}>Manage infrastructure and service dependencies across six business workspaces.<br/>Plan each change, review its impact and verify execution.</p><div className={s.actions}><a href="#operations" className={s.primary}>Manage services <ArrowRight size={15}/></a><a href="#stations" className={s.secondary}>Explore workspaces <Layers size={15}/></a></div></div>
      <div className={s.topology} role="img" aria-label="Architecture: the control platform manages MES, ERP, POS, CRM, dining and commerce, each with an independent web service."><div className={s.topologyCaption}>SYSTEM OVERVIEW<span>IaC / v{registry.version}</span></div><div className={s.controlNode}><Layers size={25} strokeWidth={1.4}/><div><b>Business Suite</b><small>Infrastructure control plane</small></div></div><div className={s.branch}/><div className={s.nodeGrid}>{registry.sites.map(site=>{const app=applications[site.id as keyof typeof applications];return <div key={site.id} className={s.node}><app.icon size={13} strokeWidth={1.5}/>{app.short}</div>;})}</div><p className={s.topologyFoot}>6 applications · independent web runtimes</p></div>
    </section>
    <div className={s.metrics} aria-label="Infrastructure configuration">
      <div className={s.metric}><p className={s.metricLabel}><Layers size={13}/>Business workspaces</p><p className={s.metricValue}>{String(registry.sites.length).padStart(2,"0")}<small>applications</small></p><p className={s.metricSub}>One configuration, shared management</p></div>
      <div className={s.metric}><p className={s.metricLabel}><Server size={13}/>Managed services</p><p className={s.metricValue}>{Object.keys(graph).length}<small>services</small></p><p className={s.metricSub}>Connect to query live status</p></div>
      <div className={s.metric}><p className={s.metricLabel}><Database size={13}/>Data shards</p><p className={s.metricValue}>02<small>shards</small></p><p className={s.metricSub}>PostgreSQL · Tenant routing</p></div>
      <div className={s.metric}><p className={s.metricLabel}><GitBranch size={13}/>Development model</p><p className={s.metricValue}>TDD + Loop</p><p className={s.metricSub}>Test → Deliver → Iterate</p></div>
    </div>
    <div className={s.content}>
      <section id="stations" className={s.section} aria-labelledby="stations-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>01 / APPLICATIONS</p><h2 id="stations-title">A workspace for every business.</h2><p className={s.sectionDescription}>Six business domains connected through one engineering configuration.</p></div><a href="#architecture" className={s.textLink}>View architecture <ArrowUpRight size={14}/></a></div><div className={s.cards}>{registry.sites.map(site=>{const app=applications[site.id as keyof typeof applications];return <Link key={site.id} href={site.path} className={s.card}><div className={s.cardTop}><span className={s.appIcon} style={{color:app.color}}><app.icon size={20} strokeWidth={1.6}/></span><span className={s.route}>{site.path}</span></div><h3>{site.name}</h3><p>{app.label} · {app.detail}</p><div className={s.cardBottom}><span>{site.services.length?`${site.services.length} service dependencies`:"Shared web and business data"}</span><ArrowUpRight size={16}/></div></Link>;})}</div><p className={s.sharedNote}><Info size={13}/>Workspace web services can start and stop independently. Databases and the gateway remain shared; plans list the affected workspaces.</p></section>
      <section id="operations" className={s.section} aria-labelledby="operations-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>02 / OPERATIONS</p><h2 id="operations-title">Plan each change before execution.</h2><p className={s.sectionDescription}>Check live status and affected workspaces before starting, stopping or restarting services.</p></div></div><PlatformControl/></section>
      <section id="architecture" className={s.section} aria-labelledby="architecture-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>03 / BUILT UNDERNEATH</p><h2 id="architecture-title">Engineering behind the interface.</h2></div></div><div className={s.architecture}>
        <article className={s.feature}><div className={s.featureTitle}><ShoppingBag size={19}/><h3>Keep commerce requests moving.</h3></div><p>Product descriptions use Redis caching. Payment events are recorded in an outbox before delivery to a durable queue. Transaction data remains authoritative for prices and stock.</p><div className={s.flow}><span>Payment</span><ArrowRight size={12}/><span>Outbox</span><ArrowRight size={12}/><span>RabbitMQ</span></div></article>
        <article className={s.feature}><div className={s.featureTitle}><Activity size={19}/><h3>Manufacturing, from equipment signals to work orders.</h3></div><p>MQTT Collect equipment measurements in a time-series database and synchronize work order changes to PostgreSQL read-model shards.</p><div className={s.flow}><span>MQTT</span><ArrowRight size={12}/><span>Time-series data</span><ArrowRight size={12}/><span>Anomaly tracking</span></div><Link href="/mes/industrial" className={s.textLink}>View equipment data <ArrowUpRight size={13}/></Link></article>
      </div></section>
      <section className={s.section} aria-labelledby="loop-title"><div className={s.sectionHeader}><div><p className={s.eyebrow}>04 / ENGINEERING LOOP</p><h2 id="loop-title">Each delivery starts the next iteration.</h2><p className={s.sectionDescription}>Retain test evidence, verification results and open issues for every iteration.</p></div><Workflow size={22} strokeWidth={1.4}/></div><div className={s.loop}><ol className={s.loopSteps}>{phases.map(([label,english],index)=><li key={english}><span className={s.stepNumber}>{index+1}</span><b>{label}</b><small>{english}</small></li>)}</ol><div className={s.loopFooter}><code>$ npm run engineering:check</code><span>Type checking · Behavior tests · Production build</span></div></div></section>
    </div>
    <footer className={s.footer}><span>Business Suite / Infrastructure Console</span><Link href="/" className={s.textLink}>Back to portfolio <ArrowUpRight size={13}/></Link></footer>
  </div></main>;
}
