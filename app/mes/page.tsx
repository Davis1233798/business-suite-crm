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
        setUpdatedAt(new Date().toLocaleTimeString("zh-TW", {hour12:false}));
        if (json.data.workOrders.length > 0 && !selectedWo) {
          setSelectedWo(json.data.workOrders[0].id);
        }
      } else {
        setError(json.error?.message || "載入 MES 資料失敗");
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
          notes: reportNote || "現場正常報工",
          idempotencyKey: reportAttempt.current.key,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        reportAttempt.current = { signature: "", key: "" };
        setReportSuccess(`報工成功！良品: ${json.data.goodQuantity}，報廢: ${json.data.scrapQuantity}，累計完工: ${json.data.totalCompleted}`);
        fetchData();
      } else {
        setError(json.error?.message || "報工失敗");
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
  const statusNames: Record<string,string> = {draft:"草稿",released:"已下達",in_progress:"生產中",completed:"已完成",closed:"已結案"};
  const visibleOrders = orders.filter((wo:any) => (statusFilter === "all" || wo.status === statusFilter) &&
    `${wo.orderNo} ${productName(wo.productId)}`.toLowerCase().includes(query.toLowerCase()));
  const good = orders.reduce((n:number,w:any)=>n+w.completedQuantity,0);
  const scrap = orders.reduce((n:number,w:any)=>n+w.scrappedQuantity,0);
  const target = orders.reduce((n:number,w:any)=>n+w.targetQuantity,0);
  const quality = data?.qualityChecks ?? [];
  const materials = (data?.materials ?? []).filter((m:any)=>m.workOrderId===selectedWo);
  const stamp = (value:string) => value ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)?value:value.replace(" ","T")+"Z").toLocaleString("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}) : "—";
  const panelTitle = (title:string,count?:number) => <div className={styles.panelTitle}><h2>{title}</h2>{count!==undefined&&<span>{count} 筆</span>}</div>;
  const badge = (status:string) => <span className={`${styles.badge} ${status==="in_progress"?styles.active:status==="completed"||status==="closed"?styles.success:""}`}>{statusNames[status]??status}</span>;

  return <main data-site="mes" className={styles.shell}>
    <div className={styles.appBar}><span><Factory size={17}/> ForgeFlow <b>製造執行</b></span><nav aria-label="MES 工作區"><a href="#dispatch">現場總覽</a><a href="#trace">物料追溯</a><a href="#workflow">生產作業</a><Link href="/mes/industrial">設備與 AIoT ↗</Link></nav></div>
    <div className={styles.content}>
      <header className={styles.pageHeader}><div><p>製造管理 / 生產控制</p><h1>製造執行工作台 <span>現場總覽</span></h1></div><div className={styles.headerActions}><span role="status">{loading ? "資料更新中…" : updatedAt ? `更新 ${updatedAt}` : "尚未載入"}</span><button onClick={fetchData} disabled={loading}><RotateCcw size={14}/>重新整理</button><a href="#workflow" className={styles.primary}>生產作業</a></div></header>
      {error&&<div role="alert" className={styles.error}><AlertTriangle size={15}/>{error}</div>}
      {reportSuccess&&<div role="status" className={styles.notice}><CheckCircle size={15}/>{reportSuccess}</div>}
      {loading&&!data&&<p role="status" className={styles.notice}>正在載入工單、物料與生產紀錄…</p>}
      <section className={styles.metrics} aria-label="目前組織生產摘要">{[
        ["生產工單",orders.length,"全部工單"],["執行中",orders.filter((w:any)=>w.status==="in_progress").length,"已開工"],
        ["良品完成",good,`目標 ${target} 件`],["報廢數量",scrap,"累計報工"],["報工良率",good+scrap?`${(good/(good+scrap)*100).toFixed(1)}%`:"—","良品 / 已報總量"],
        ["待備料",orders.filter((w:any)=>!w.materialsStaged&&!["completed","closed"].includes(w.status)).length,"未齊套工單"],
      ].map(([label,value,hint])=><div key={label}><p>{label}</p><strong>{data?value:"—"}</strong><small>{hint}</small></div>)}</section>
      <div className={styles.workspace}>
        <div className={styles.overview}>
          <section id="dispatch" className={styles.panel} aria-label="現場工單">
            {panelTitle("生產工單",orders.length)}
            <div className={styles.filters}><label>搜尋工單<input aria-label="搜尋工單或產品" placeholder="工單編號 / 產品" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>工單狀態<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">全部狀態</option>{Object.entries(statusNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><span>{visibleOrders.length} / {orders.length} 筆</span></div>
            <div className={styles.tableScroll}><table><thead><tr>{["工單 / 產品","狀態","目標","良品","報廢","完成率","備料","操作"].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{visibleOrders.map((wo:any)=>{
              const progress=wo.targetQuantity?Math.min(100,(wo.completedQuantity+wo.scrappedQuantity)/wo.targetQuantity*100):0;
              return <tr key={wo.id} className={selectedWo===wo.id?styles.selected:""}><td><b className={styles.orderNo}>{wo.orderNo}</b><small className={styles.subline}>{productName(wo.productId)}</small></td><td>{badge(wo.status)}</td><td className={styles.number}>{wo.targetQuantity}</td><td className={`${styles.number} ${styles.good}`}>{wo.completedQuantity}</td><td className={`${styles.number} ${wo.scrappedQuantity?styles.bad:""}`}>{wo.scrappedQuantity}</td><td><div className={styles.progress}><span style={{width:`${progress}%`}}/></div><small>{progress.toFixed(0)}%</small></td><td><span className={wo.materialsStaged?styles.good:styles.warning}>{wo.materialsStaged?"✓ 已齊套":"△ 待備料"}</span></td><td><button aria-pressed={selectedWo===wo.id} aria-label={`選取 ${wo.orderNo}`} onClick={()=>{setSelectedWo(wo.id);setReportSuccess(null);}}>選取</button></td></tr>;
            })}</tbody></table></div>{!visibleOrders.length&&<p className={styles.empty}>{loading?"資料讀取中":"沒有符合條件的工單"}</p>}
            <div className={styles.tableFooter}><span>選取工單後，可在右側報工並查看投入物料。</span><span>數量單位：件</span></div>
          </section>
          <div className={styles.detailGrid}>
            <section id="trace" className={styles.panel} aria-label="原物料批號">{panelTitle("原物料批號",data?.lots?.length??0)}<div className={styles.smallScroll}><table><thead><tr><th scope="col">批號 / 物料</th><th scope="col">入庫</th><th scope="col">可用餘量</th><th scope="col">狀態</th></tr></thead><tbody>{data?.lots?.map((lot:any)=><tr key={lot.id}><td><b>{lot.lotNumber}</b><small className={styles.subline}>{lot.materialSku}</small></td><td className={styles.number}>{lot.initialQuantity}</td><td className={`${styles.number} ${styles.good}`}>{lot.currentQuantity}</td><td>{["active","available"].includes(lot.status)?"可用":lot.status==="depleted"?"已用盡":lot.status==="quarantined"?"隔離":lot.status}</td></tr>)}</tbody></table>{!data?.lots?.length&&<p className={styles.empty}>尚無原料批號</p>}</div></section>
            <section className={styles.panel} aria-label="最近報工">{panelTitle("最近報工",data?.reports?.length??0)}<div className={styles.smallScroll}><table><thead><tr><th scope="col">工單 / 時間</th><th scope="col">良品</th><th scope="col">報廢</th></tr></thead><tbody>{[...(data?.reports??[])].sort((a:any,b:any)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20).map((r:any)=><tr key={r.id}><td><b>{orders.find((w:any)=>w.id===r.workOrderId)?.orderNo??"—"}</b><small className={styles.subline}>{stamp(r.createdAt)}</small></td><td className={`${styles.number} ${styles.good}`}>{r.goodQuantity}</td><td className={styles.number}>{r.scrapQuantity}</td></tr>)}</tbody></table>{!data?.reports?.length&&<p className={styles.empty}>尚無報工紀錄，提交後會顯示於此。</p>}</div></section>
          </div>
          <section className={styles.panel} aria-label="選取工單投入追溯">{panelTitle("投入物料追溯",materials.length)}<div className={styles.traceRows}>{materials.map((m:any)=><div key={m.id}><b>{data?.lots?.find((l:any)=>l.id===m.materialLotId)?.lotNumber??"—"}</b><span>{m.materialSku}</span><span>領料 {m.issuedQuantity}</span><span>退料 {m.returnedQuantity}</span><strong>淨耗 {m.netQuantity}</strong></div>)}{!materials.length&&<p className={styles.empty}>所選工單尚無領料紀錄。</p>}</div></section>
      <section aria-label="工作中心與停機" className={`${styles.panel} ${styles.centers}`}>{panelTitle("工作中心與停機",data?.workCenters?.length??0)}<div className={styles.centerGrid}>{data?.workCenters?.map((center:any)=><div key={center.id}><Factory size={16}/><b>{center.name}</b><span>{center.code}</span><span>產能 {center.capacityMinutesPerDay} 分/日</span><span>停機紀錄 {(data.downtimeEvents??[]).filter((d:any)=>d.workCenterId===center.id).length} 筆</span></div>)}</div></section>
        </div>
        <aside className={styles.sidebar} aria-label="工單操作與品檢">
          <section className={styles.panel}>{panelTitle("工單詳情與報工")}<div className={styles.selectedInfo}><span>目前選取</span><strong>{selected?.orderNo??"請選取工單"}</strong>{selected&&badge(selected.status)}<dl><div><dt>產品</dt><dd>{selected?productName(selected.productId):"—"}</dd></div><div><dt>目標 / 已報</dt><dd>{selected?`${selected.targetQuantity} / ${selected.completedQuantity+selected.scrappedQuantity}`:"—"}</dd></div><div><dt>待完成</dt><dd>{selected?Math.max(0,selected.targetQuantity-selected.completedQuantity-selected.scrappedQuantity):"—"}</dd></div></dl></div>
          <form className={styles.reportForm} onSubmit={handleReport}><label htmlFor="mes-report-order">目標工單<select id="mes-report-order" value={selectedWo} onChange={e=>setSelectedWo(e.target.value)}><option value="">請選取</option>{orders.map((w:any)=><option key={w.id} value={w.id}>{w.orderNo}</option>)}</select></label><div className={styles.quantityGrid}><label htmlFor="mes-good">良品數量<input id="mes-good" type="number" min="0" value={goodQty} onChange={e=>setGoodQty(Math.max(0,parseInt(e.target.value)||0))} required/></label><label htmlFor="mes-scrap">報廢數量<input id="mes-scrap" type="number" min="0" value={scrapQty} onChange={e=>setScrapQty(Math.max(0,parseInt(e.target.value)||0))}/></label></div><label htmlFor="mes-note">備註 / 異常說明<input id="mes-note" value={reportNote} onChange={e=>setReportNote(e.target.value)} placeholder="輸入本批次紀錄"/></label><button className={styles.primary} disabled={reporting||!selected||selected.status!=="in_progress"} type="submit">{reporting?"報工送出中…":"確認送出報工"}</button><p>{selected?.status!=="in_progress"?"工單需完成齊套並開工後，才可提交報工。":"報工會更新工單累計數量與追溯紀錄。"} <a href="#workflow">前往生產作業 ↓</a></p></form></section>
          <section className={styles.panel} aria-label="品質檢查">{panelTitle("品質檢查",quality.length)}<div className={styles.smallScroll}><table><thead><tr><th scope="col">工單</th><th scope="col">抽檢 / 不良</th><th scope="col">結果</th></tr></thead><tbody>{quality.map((q:any)=><tr key={q.id}><td>{orders.find((w:any)=>w.id===q.workOrderId)?.orderNo??"—"}</td><td className={styles.number}>{q.sampleQuantity} / {q.failedQuantity}</td><td><span className={q.status==="quarantined"?styles.bad:styles.good}>{q.status==="quarantined"?"隔離":"放行"}</span></td></tr>)}</tbody></table>{!quality.length&&<p className={styles.empty}>尚無品質檢查紀錄。</p>}</div></section>
        </aside>
      </div>

      <div id="workflow" className={styles.operations}>{data&&<MesOperations data={data} onSaved={fetchData}/>}</div>
      <details className={styles.fixture}><summary>OEE 計算參考 · 固定測試資料，非即時設備效率</summary><p>OEE {data?.oee?.oeePercent??"—"}% · 稼動率 {data?.oee?.availabilityPercent??"—"}% · 表現率 {data?.oee?.performancePercent??"—"}% · 品質率 {data?.oee?.qualityPercent??"—"}%</p><p>排程 480 分鐘 / 運轉 360 分鐘 / 總量 300 件 / 良品 270 件。</p></details>
      <footer className={styles.footer}>ForgeFlow · 製造執行工作區 <span>目前組織資料 · 數量依工單累計，非今日產量</span></footer>
    </div>
  </main>;
}
