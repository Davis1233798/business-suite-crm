"use client";
import { useState } from "react";
export function WorkspaceTools() {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [table, setTable] = useState("pos_sales");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const restore = async () => {
    if (!file || !confirmed) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (file.size > 5_000_000) throw new Error("備份檔案上限 5 MB");
      const response = await fetch("/api/workspace/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      const json: any = await response.json();
      if (!json.success) throw new Error(json.error?.message || "還原失敗");
      setMessage(`還原完成：${json.data.restoredTables} 張資料表、${json.data.restoredRows} 筆資料。請重新整理正在操作的系統。`);
      setConfirmed(false);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
    <h2 className="text-lg font-bold text-stone-900">展示空間資料管理</h2>
    <p className="text-sm text-stone-600">初始資料由系統內建的虛構種子資料建立，並非真實企業或聯絡資料。匯出內容包含目前空間的種子資料及後續操作紀錄；既有空間不會自動替換舊資料。</p>
    <p className="text-sm text-stone-500">下載六套系統的完整業務資料快照。備份僅可還原至目前展示空間；角色身分與既有稽核紀錄不會被覆蓋。還原成功會清除舊交易重試快取。</p>
    <div className="flex flex-wrap items-center gap-3"><a className="rounded-lg bg-primary px-4 py-2 text-sm text-white" href="/api/workspace/backup" download>下載 JSON 備份</a><label className="text-sm">CSV 資料表 <select className="rounded-lg border p-2" value={table} onChange={event => setTable(event.target.value)}>{[["pos_sales", "POS 交易"], ["pos_refunds", "POS 退款"], ["erp_stock_ledger", "ERP 庫存異動"], ["erp_invoices", "ERP 帳單"], ["erp_journal_lines", "ERP 傳票明細"], ["mes_production_reports", "MES 報工"], ["crm_opportunities", "CRM 商機"], ["dining_orders", "餐飲訂單"], ["shop_orders", "電商訂單"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><a className="rounded-lg border px-4 py-2 text-sm" href={`/api/workspace/export?table=${table}`} download>匯出 CSV</a></div>
    <details className="rounded-lg border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-semibold">從備份還原（示範管理員）</summary><div className="mt-4 space-y-3"><label className="block text-sm">選擇目前空間的 JSON 備份（最多 5 MB）<input type="file" accept="application/json,.json" className="mt-2 block w-full text-xs" onChange={event => { setFile(event.target.files?.[0] || null); setConfirmed(false); }} /></label><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>我確認使用這份備份覆蓋目前展示空間的所有業務資料。</span></label><button disabled={busy || !file || !confirmed} onClick={restore} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "驗證並還原中…" : "確認還原"}</button></div></details>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
