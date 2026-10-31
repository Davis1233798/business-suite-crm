"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./mes-workbench.module.css";
import { MesOperations } from "@/components/domain-operations";
import { Factory, CheckCircle, AlertTriangle, RotateCcw } from "lucide-react";

export default function MesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Report form state
  const [selectedWo, setSelectedWo] = useState<string>("");
  const [goodQty, setGoodQty] = useState<number>(10);
  const [scrapQty, setScrapQty] = useState<number>(0);
  const [reportNote, setReportNote] = useState<string>("");
  const [reporting, setReporting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);
  const reportAttempt = useRef({ signature: "", key: "" });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/mes/data");
      const json: any = await res.json();
      if (json.success) {
        setData(json.data);
        setUpdatedAt(new Date().toLocaleTimeString("en-US", {hour12:false}));
        if (json.data.workOrders.length > 0 && !selectedWo) {
          setSelectedWo(json.data.workOrders[0].id);
        }
      } else {
        setError(json.error?.message || "Unable to load MES data");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWo) return;
    setReporting(true);
    setReportSuccess(null);
    setError(null);

    try {
      const wo = data.workOrders.find((w: any) => w.id === selectedWo);
      const op = data.operations.find((o: any) => o.workOrderId === selectedWo);
      const signature = JSON.stringify([selectedWo, op?.id, goodQty, scrapQty, reportNote]);
      if (reportAttempt.current.signature !== signature) reportAttempt.current = { signature, key: crypto.randomUUID() };

      const res = await fetch("/api/mes/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workOrderId: selectedWo,
          operationId: op?.id || "op_default",
          goodQuantity: goodQty,
          scrapQuantity: scrapQty,
          notes: reportNote || "Routine production report",
          idempotencyKey: reportAttempt.current.key,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        reportAttempt.current = { signature: "", key: "" };
        setReportSuccess(`Report saved. Good units: : ${json.data.goodQuantity}, scrap: : ${json.data.scrapQuantity}, completed total: : ${json.data.totalCompleted}`);
        fetchData();
      } else {
        setError(json.error?.message || "Production reporting failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReporting(false);
    }
  };

  const orders = data?.workOrders ?? [];
  const selected = orders.find((wo: any) => wo.id === selectedWo);
  const productName = (id: string) => data?.products?.find((p: any) => p.id === id)?.name ?? "—";
  const statusNames: Record<string,string> = {draft:"Draft",released:"Released",in_progress:"In progress",completed:"Completed",closed:"Closed"};
  const visibleOrders = orders.filter((wo:any) => (statusFilter === "all" || wo.status === statusFilter) &&
    `${wo.orderNo} ${productName(wo.productId)}`.toLowerCase().includes(query.toLowerCase()));
  const good = orders.reduce((n:number,w:any)=>n+w.completedQuantity,0);
  const scrap = orders.reduce((n:number,w:any)=>n+w.scrappedQuantity,0);
  const target = orders.reduce((n:number,w:any)=>n+w.targetQuantity,0);
  const quality = data?.qualityChecks ?? [];
  const materials = (data?.materials ?? []).filter((m:any)=>m.workOrderId===selectedWo);
  const stamp = (value:string) => value ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)?value:value.replace(" ","T")+"Z").toLocaleString("en-US",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}) : "—";
  const panelTitle = (title:string,count?:number) => <div className={styles.panelTitle}><h2>{title}</h2>{count!==undefined&&<span>{count} records</span>}</div>;
  const badge = (status:string) => <span className={`${styles.badge} ${status==="in_progress"?styles.active:status==="completed"||status==="closed"?styles.success:""}`}>{statusNames[status]??status}</span>;

  return <main data-site="mes" className={styles.shell}>
    <div className={styles.appBar}><span><Factory size={17}/> ForgeFlow <b>Manufacturing execution</b></span><nav aria-label="MES Workspace"><a href="#dispatch">Shop floor overview</a><a href="#trace">Material traceability</a><a href="#workflow">Production operations</a><Link href="/mes/industrial">Equipment and AIoT ↗</Link></nav></div>
    <div className={styles.content}>
      <header className={styles.pageHeader}><div><p>Manufacturing / Production control</p><h1>Manufacturing workspace <span>Shop floor overview</span></h1></div><div className={styles.headerActions}><span role="status">{loading ? "Updating data…" : updatedAt ? `Refresh ${updatedAt}` : "Not loaded"}</span><button onClick={fetchData} disabled={loading}><RotateCcw size={14}/>Refresh</button><a href="#workflow" className={styles.primary}>Production operations</a></div></header>
      {error&&<div role="alert" className={styles.error}><AlertTriangle size={15}/>{error}</div>}
      {reportSuccess&&<div role="status" className={styles.notice}><CheckCircle size={15}/>{reportSuccess}</div>}
      {loading&&!data&&<p role="status" className={styles.notice}>Loading work orders, materials and production records…</p>}
      <section className={styles.metrics} aria-label="Organization production summary">{[
        ["Work orders",orders.length,"All work orders"],["In progress",orders.filter((w:any)=>w.status==="in_progress").length,"Started"],
        ["Good units completed",good,`Target ${target} units`],["Scrap quantity",scrap,"Total reported"],["Production yield",good+scrap?`${(good/(good+scrap)*100).toFixed(1)}%`:"—","Good / reported units"],
        ["Materials pending",orders.filter((w:any)=>!w.materialsStaged&&!["completed","closed"].includes(w.status)).length,"Work orders awaiting materials"],
      ].map(([label,value,hint])=><div key={label}><p>{label}</p><strong>{data?value:"—"}</strong><small>{hint}</small></div>)}</section>
      <div className={styles.workspace}>
        <div className={styles.overview}>
          <section id="dispatch" className={styles.panel} aria-label="Shop floor work orders">
            {panelTitle("Work orders",orders.length)}
            <div className={styles.filters}><label>Search work orders<input aria-label="Search work order or product" placeholder="Work order / Product" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Work order status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(statusNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><span>{visibleOrders.length} / {orders.length} records</span></div>
            <div className={styles.tableScroll}><table><thead><tr>{["Work order / Product","Status","Target","Good","Scrap","Completion","Materials","Actions"].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{visibleOrders.map((wo:any)=>{
              const progress=wo.targetQuantity?Math.min(100,(wo.completedQuantity+wo.scrappedQuantity)/wo.targetQuantity*100):0;
              return <tr key={wo.id} className={selectedWo===wo.id?styles.selected:""}><td><b className={styles.orderNo}>{wo.orderNo}</b><small className={styles.subline}>{productName(wo.productId)}</small></td><td>{badge(wo.status)}</td><td className={styles.number}>{wo.targetQuantity}</td><td className={`${styles.number} ${styles.good}`}>{wo.completedQuantity}</td><td className={`${styles.number} ${wo.scrappedQuantity?styles.bad:""}`}>{wo.scrappedQuantity}</td><td><div className={styles.progress}><span style={{width:`${progress}%`}}/></div><small>{progress.toFixed(0)}%</small></td><td><span className={wo.materialsStaged?styles.good:styles.warning}>{wo.materialsStaged?"✓ Ready":"△ Materials pending"}</span></td><td><button aria-pressed={selectedWo===wo.id} aria-label={`Select ${wo.orderNo}`} onClick={()=>{setSelectedWo(wo.id);setReportSuccess(null);}}>Select</button></td></tr>;
            })}</tbody></table></div>{!visibleOrders.length&&<p className={styles.empty}>{loading?"Loading data":"No matching work orders"}</p>}
            <div className={styles.tableFooter}><span>Select a work order to report production and inspect material inputs.</span><span>Quantity unit: pieces</span></div>
          </section>
          <div className={styles.detailGrid}>
            <section id="trace" className={styles.panel} aria-label="Material lots">{panelTitle("Material lots",data?.lots?.length??0)}<div className={styles.smallScroll}><table><thead><tr><th scope="col">Lot / Material</th><th scope="col">Received</th><th scope="col">Available balance</th><th scope="col">Status</th></tr></thead><tbody>{data?.lots?.map((lot:any)=><tr key={lot.id}><td><b>{lot.lotNumber}</b><small className={styles.subline}>{lot.materialSku}</small></td><td className={styles.number}>{lot.initialQuantity}</td><td className={`${styles.number} ${styles.good}`}>{lot.currentQuantity}</td><td>{["active","available"].includes(lot.status)?"Available":lot.status==="depleted"?"Exhausted":lot.status==="quarantined"?"Quarantined":lot.status}</td></tr>)}</tbody></table>{!data?.lots?.length&&<p className={styles.empty}>No material lots</p>}</div></section>
            <section className={styles.panel} aria-label="Recent production reports">{panelTitle("Recent production reports",data?.reports?.length??0)}<div className={styles.smallScroll}><table><thead><tr><th scope="col">Work order / Time</th><th scope="col">Good</th><th scope="col">Scrap</th></tr></thead><tbody>{[...(data?.reports??[])].sort((a:any,b:any)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20).map((r:any)=><tr key={r.id}><td><b>{orders.find((w:any)=>w.id===r.workOrderId)?.orderNo??"—"}</b><small className={styles.subline}>{stamp(r.createdAt)}</small></td><td className={`${styles.number} ${styles.good}`}>{r.goodQuantity}</td><td className={styles.number}>{r.scrapQuantity}</td></tr>)}</tbody></table>{!data?.reports?.length&&<p className={styles.empty}>Submitted production reports will appear here.</p>}</div></section>
          </div>
          <section className={styles.panel} aria-label="Selected work order traceability">{panelTitle("Material input traceability",materials.length)}<div className={styles.traceRows}>{materials.map((m:any)=><div key={m.id}><b>{data?.lots?.find((l:any)=>l.id===m.materialLotId)?.lotNumber??"—"}</b><span>{m.materialSku}</span><span>Material issued {m.issuedQuantity}</span><span>Material returned {m.returnedQuantity}</span><strong>Net consumption {m.netQuantity}</strong></div>)}{!materials.length&&<p className={styles.empty}>No material movements for this work order.</p>}</div></section>
      <section aria-label="Work centers and downtime" className={`${styles.panel} ${styles.centers}`}>{panelTitle("Work centers and downtime",data?.workCenters?.length??0)}<div className={styles.centerGrid}>{data?.workCenters?.map((center:any)=><div key={center.id}><Factory size={16}/><b>{center.name}</b><span>{center.code}</span><span>Capacity {center.capacityMinutesPerDay} min/day</span><span>Downtime records {(data.downtimeEvents??[]).filter((d:any)=>d.workCenterId===center.id).length} records</span></div>)}</div></section>
        </div>
        <aside className={styles.sidebar} aria-label="Work order operations and quality">
          <section className={styles.panel}>{panelTitle("Work order details and reporting")}<div className={styles.selectedInfo}><span>Currently selected</span><strong>{selected?.orderNo??"Select a work order"}</strong>{selected&&badge(selected.status)}<dl><div><dt>Product</dt><dd>{selected?productName(selected.productId):"—"}</dd></div><div><dt>Target / Reported</dt><dd>{selected?`${selected.targetQuantity} / ${selected.completedQuantity+selected.scrappedQuantity}`:"—"}</dd></div><div><dt>Remaining</dt><dd>{selected?Math.max(0,selected.targetQuantity-selected.completedQuantity-selected.scrappedQuantity):"—"}</dd></div></dl></div>
          <form className={styles.reportForm} onSubmit={handleReport}><label htmlFor="mes-report-order">Work order<select id="mes-report-order" value={selectedWo} onChange={e=>setSelectedWo(e.target.value)}><option value="">Select</option>{orders.map((w:any)=><option key={w.id} value={w.id}>{w.orderNo}</option>)}</select></label><div className={styles.quantityGrid}><label htmlFor="mes-good">Good quantity<input id="mes-good" type="number" min="0" value={goodQty} onChange={e=>setGoodQty(Math.max(0,parseInt(e.target.value)||0))} required/></label><label htmlFor="mes-scrap">Scrap quantity<input id="mes-scrap" type="number" min="0" value={scrapQty} onChange={e=>setScrapQty(Math.max(0,parseInt(e.target.value)||0))}/></label></div><label htmlFor="mes-note">Notes / Exceptions<input id="mes-note" value={reportNote} onChange={e=>setReportNote(e.target.value)} placeholder="Enter batch notes"/></label><button className={styles.primary} disabled={reporting||!selected||selected.status!=="in_progress"} type="submit">{reporting?"Submitting report…":"Submit production report"}</button><p>{selected?.status!=="in_progress"?"Materials must be ready and the work order started before reporting.":"Reporting updates work order totals and traceability records."} <a href="#workflow">Go to production operations ↓</a></p></form></section>
          <section className={styles.panel} aria-label="Quality checks">{panelTitle("Quality checks",quality.length)}<div className={styles.smallScroll}><table><thead><tr><th scope="col">Work order</th><th scope="col">Sample / Defects</th><th scope="col">Result</th></tr></thead><tbody>{quality.map((q:any)=><tr key={q.id}><td>{orders.find((w:any)=>w.id===q.workOrderId)?.orderNo??"—"}</td><td className={styles.number}>{q.sampleQuantity} / {q.failedQuantity}</td><td><span className={q.status==="quarantined"?styles.bad:styles.good}>{q.status==="quarantined"?"Quarantined":"Released"}</span></td></tr>)}</tbody></table>{!quality.length&&<p className={styles.empty}>No quality checks recorded.</p>}</div></section>
        </aside>
      </div>

      <div id="workflow" className={styles.operations}>{data&&<MesOperations data={data} onSaved={fetchData}/>}</div>
      <details className={styles.fixture}><summary>OEE Calculation example · Fixed demo data, not live equipment efficiency</summary><p>OEE {data?.oee?.oeePercent??"—"}% · Availability {data?.oee?.availabilityPercent??"—"}% · Performance {data?.oee?.performancePercent??"—"}% · Quality {data?.oee?.qualityPercent??"—"}%</p><p>Scheduled 480 min / Running 360 min / Total 300 units / Good 270 units.</p></details>
      <footer className={styles.footer}>ForgeFlow · Manufacturing executionWorkspace <span>Current organization · Quantities are cumulative per work order, not daily output</span></footer>
    </div>
  </main>;
}
