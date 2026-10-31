"use client";
import { useState } from "react";
import Link from "next/link";
import theme from "@/components/infrastructure-theme.module.css";

type Reading = { time: string; device: string; value: number; anomaly: boolean; assessment?: {status:string; samples:number; score:number|null; threshold:number|null; model_id:string|null; decision_method:string} | null };
type ProjectedOrder = {revision:number;order:{id:string;orderNo:string;status:string;targetQuantity:number;completedQuantity:number;scrappedQuantity:number};quality:{failedQuantity:number}};
const orderStates:Record<string,string>={draft:"草稿",released:"已下達",in_progress:"生產中",completed:"已完成",closed:"已結案"};
export default function IndustrialPage() {
  const [message, setMessage] = useState('更新量測以讀取目前組織的設備紀錄。');
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
      if (!response.ok) throw new Error(data.status === 'not_configured' ? '設備資料服務尚未連接，請聯絡環境管理員。' : '設備資料服務暫時無法使用，請稍後重試。');
      if (!Array.isArray(data.measurements)||!Array.isArray(data.workOrders)) throw new Error('工業資料格式有誤。');
      setRows(data.measurements);
      setOrders(data.workOrders);
      setLoaded(true);
      setMessage(`已更新 ${data.measurements.length} 筆量測及 ${data.workOrders.length} 筆工單摘要。`);
    } catch (e) { setError(true); setMessage(e instanceof Error ? e.message : '連線失敗，請稍後重試。'); }
    finally { setLoading(false); }
  }
  return <main data-site="mes" className={`${theme.mes} min-h-screen`}><div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
    <Link href="/mes" className="inline-flex text-primary text-sm">← ForgeFlow 製造工作區</Link>
    <header className="flex flex-wrap justify-between gap-4 border-b border-border pb-6"><div><p className="text-xs text-stone-600 tracking-widest">FORGEFLOW / EQUIPMENT</p><h1 className="text-3xl font-semibold mt-2">設備量測與異常追蹤</h1><p className="text-sm text-stone-600 mt-2">追溯最近 100 筆設備訊號，掌握生產狀態。</p></div><button disabled={loading} onClick={load} className="inline-flex bg-primary text-white rounded-lg px-5 py-3 self-center">{loading ? '更新中…' : '更新量測'}</button></header>
    <div className="grid sm:grid-cols-3 gap-4">{[['量測筆數', rows.length], ['異常訊號', rows.filter(r => r.anomaly).length], ['設備數', new Set(rows.map(r => r.device)).size]].map(([label, value]) => <section key={label} className="border rounded-xl p-5"><p className="text-xs text-stone-600">{label}</p><p className="text-3xl tabular-nums font-semibold mt-2">{loaded ? value : '—'}</p></section>)}</div>
    <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-red-800' : 'text-stone-600'}`}>{message}</p>
    <section className="border rounded-xl overflow-hidden"><h2 className="font-semibold p-5 border-b border-border">量測紀錄</h2><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th scope="col">量測時間（台北）</th><th scope="col">設備</th><th scope="col">量測值</th><th scope="col">異常判定</th><th scope="col">模型依據</th></tr></thead><tbody>{rows.map((r,i) => <tr key={`${r.device}:${r.time}:${i}`} className="border-t border-border"><td>{new Date(r.time).toLocaleString('zh-TW', {timeZone:'Asia/Taipei'})}</td><td>{r.device}</td><td className="tabular-nums">{r.value}</td><td><span className={r.anomaly ? 'text-amber-800' : 'text-stone-600'}>{r.anomaly ? '⚠ 異常訊號' : '無異常標記'}</span></td><td className="text-xs text-stone-600">{r.assessment?.status === 'ready' ? <span title={r.assessment.model_id ?? undefined}>Isolation Forest · {r.assessment.samples} 筆<br/>分數 {r.assessment.score?.toFixed(3)}／門檻 {r.assessment.threshold?.toFixed(3)}</span> : r.assessment ? `${r.assessment.status === 'insufficient_variation' ? '訊號變化不足' : '模型暖機'} · ${r.assessment.samples} 筆` : '既有統計紀錄'}</td></tr>)}</tbody></table></div>{!rows.length && <p className="text-sm text-stone-600 p-8 text-center">{loaded ? '目前沒有設備量測資料。' : '更新量測後，紀錄將顯示於此。'}</p>}</section>
    <p className="text-xs text-stone-600">每台設備以之前最多 256 筆量測訓練 Isolation Forest，至少需要 64 筆且訊號有變化；暖機期間沿用統計基線。分數高於門檻代表較不尋常，供人工檢查參考。模型尚未以真實工廠故障資料驗證。</p>
    <section className="border rounded-xl overflow-hidden"><div className="p-5 border-b border-border"><h2 className="font-semibold">工單同步摘要</h2><p className="text-sm text-stone-600 mt-2 leading-7">由工單、報工與品檢異動建立的查詢摘要，每分鐘更新。執行作業前請以製造工作區的即時狀態為準。</p></div><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th scope="col">工單</th><th scope="col">生產狀態</th><th scope="col">良品／目標</th><th scope="col">報廢</th><th scope="col">品檢不良</th></tr></thead><tbody>{orders.map(({order,quality})=><tr key={order.id} className="border-t border-border"><td>{order.orderNo}</td><td>{orderStates[order.status]??order.status}</td><td className="tabular-nums">{order.completedQuantity}／{order.targetQuantity}</td><td className="tabular-nums">{order.scrappedQuantity}</td><td className="tabular-nums">{quality.failedQuantity}</td></tr>)}</tbody></table></div>{!orders.length&&<p className="text-sm text-stone-600 p-8 text-center">{loaded?"尚無已同步工單，請等待下一輪同步後更新。":"更新後顯示已同步的工單摘要。"}</p>}</section>
  </div></main>;
}
