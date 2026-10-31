"use client";
import { useState } from "react";
import Link from "next/link";
import theme from "@/components/infrastructure-theme.module.css";

type Reading = { time: string; device: string; value: number; anomaly: boolean; assessment?: {status:string; samples:number; score:number|null; threshold:number|null; model_id:string|null; decision_method:string} | null };
type ProjectedOrder = {revision:number;order:{id:string;orderNo:string;status:string;targetQuantity:number;completedQuantity:number;scrappedQuantity:number};quality:{failedQuantity:number}};
const orderStates:Record<string,string>={draft:"Draft",released:"Released",in_progress:"In progress",completed:"Completed",closed:"Closed"};
export default function IndustrialPage() {
  const [message, setMessage] = useState('Refresh measurements to read equipment records for this organization.');
  const [rows, setRows] = useState<Reading[]>([]);
  const [orders,setOrders] = useState<ProjectedOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/mes/industrial');
      const data = await response.json() as { status?: string; measurements?: Reading[];workOrders?:ProjectedOrder[] };
      if (!response.ok) throw new Error(data.status === 'not_configured' ? 'Equipment data service is not connected. Contact your administrator.' : 'Equipment data service is temporarily unavailable. Try again later.');
      if (!Array.isArray(data.measurements)||!Array.isArray(data.workOrders)) throw new Error('Invalid equipment data format.');
      setRows(data.measurements);
      setOrders(data.workOrders);
      setLoaded(true);
      setMessage(`Updated ${data.measurements.length} measurements and  ${data.workOrders.length} work order summaries.`);
    } catch (e) { setError(true); setMessage(e instanceof Error ? e.message : 'Connection failed. Try again later.'); }
    finally { setLoading(false); }
  }
  return <main data-site="mes" className={`${theme.mes} min-h-screen`}><div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <Link href="/mes" className="inline-flex text-primary text-sm">← ForgeFlow Manufacturing workspace</Link>
    <header className="flex flex-wrap justify-between gap-4 border-b border-border pb-6"><div><p className="text-xs text-stone-600 tracking-widest">FORGEFLOW / EQUIPMENT</p><h1 className="text-3xl font-semibold mt-2">Equipment measurements and anomaly tracking</h1><p className="text-sm text-stone-600 mt-2">Inspect the latest 100 equipment signals and production status.</p></div><button disabled={loading} onClick={load} className="inline-flex bg-primary text-white rounded-lg px-5 py-3 self-center">{loading ? 'Refreshing…' : 'Refresh measurements'}</button></header>
    <div className="grid sm:grid-cols-3 gap-4">{[['Measurements', rows.length], ['Anomaly signals', rows.filter(r => r.anomaly).length], ['Equipment count', new Set(rows.map(r => r.device)).size]].map(([label, value]) => <section key={label} className="border rounded-xl p-5"><p className="text-xs text-stone-600">{label}</p><p className="text-3xl tabular-nums font-semibold mt-2">{loaded ? value : '—'}</p></section>)}</div>
    <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-red-800' : 'text-stone-600'}`}>{message}</p>
    <section className="border rounded-xl overflow-hidden"><h2 className="font-semibold p-5 border-b border-border">Measurement history</h2><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th scope="col">Measurement time (Taipei)</th><th scope="col">Equipment</th><th scope="col">Value</th><th scope="col">Anomaly assessment</th><th scope="col">Model basis</th></tr></thead><tbody>{rows.map((r,i) => <tr key={`${r.device}:${r.time}:${i}`} className="border-t border-border"><td>{new Date(r.time).toLocaleString('en-US', {timeZone:'Asia/Taipei'})}</td><td>{r.device}</td><td className="tabular-nums">{r.value}</td><td><span className={r.anomaly ? 'text-amber-800' : 'text-stone-600'}>{r.anomaly ? '⚠ Anomaly signals' : 'No anomaly flag'}</span></td><td className="text-xs text-stone-600">{r.assessment?.status === 'ready' ? <span title={r.assessment.model_id ?? undefined}>Isolation Forest · {r.assessment.samples} records<br/>Score {r.assessment.score?.toFixed(3)}/ threshold {r.assessment.threshold?.toFixed(3)}</span> : r.assessment ? `${r.assessment.status === 'insufficient_variation' ? 'Insufficient signal variation' : 'Model warmup'} · ${r.assessment.samples} records` : 'Historical statistics'}</td></tr>)}</tbody></table></div>{!rows.length && <p className="text-sm text-stone-600 p-8 text-center">{loaded ? 'No equipment measurements available.' : 'Refresh measurements to display records here.'}</p>}</section>
    <p className="text-xs text-stone-600">Each equipment model uses up to 256 prior measurements for Isolation Forest, requiring at least 64 samples and varying signals. Warmup uses a statistical baseline. Scores above the threshold suggest unusual signals for human review. The model has not been validated against real factory failures.</p>
    <section className="border rounded-xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-semibold">Synchronized work order summary</h2><p className="text-sm text-stone-600 mt-2 leading-7">Read summaries from work orders, reports and quality changes refresh each minute. Check the manufacturing workspace for current state before operations.</p></div><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th scope="col">Work order</th><th scope="col">Production status</th><th scope="col">Good / Target</th><th scope="col">Scrap</th><th scope="col">Quality defects</th></tr></thead><tbody>{orders.map(({order,quality})=><tr key={order.id} className="border-t border-border"><td>{order.orderNo}</td><td>{orderStates[order.status]??order.status}</td><td className="tabular-nums">{order.completedQuantity}/{order.targetQuantity}</td><td className="tabular-nums">{order.scrappedQuantity}</td><td className="tabular-nums">{quality.failedQuantity}</td></tr>)}</tbody></table></div>{!orders.length&&<p className="text-sm text-stone-600 p-8 text-center">{loaded?"No synchronized work orders. Refresh after the next sync.":"Refresh to show synchronized work order summaries."}</p>}</section>
  </div></main>;
}
