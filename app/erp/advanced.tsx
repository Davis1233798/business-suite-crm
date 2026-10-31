"use client";
import { useState } from "react";
const input = "mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm";
const button = "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
export function ErpAdvanced({ data, onSaved }: { data: any; onSaved: () => void }) {
  const [mode, setMode] = useState("partner");
  const [kind, setKind] = useState("supplier");
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [invoiceKind, setInvoiceKind] = useState("payable"); const [orderId, setOrderId] = useState(""); const [dueDate, setDueDate] = useState("");
  const [itemId, setItemId] = useState(""); const [warehouseId, setWarehouseId] = useState(""); const [quantity, setQuantity] = useState(0); const [approved, setApproved] = useState(false);
  const [reason, setReason] = useState(""); const [receiptLineId, setReceiptLineId] = useState(""); const [periodId, setPeriodId] = useState("");
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [debit, setDebit] = useState("1100"); const [credit, setCredit] = useState("4100"); const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const stock = data.stockLedger.find((entry: any) => entry.itemId === itemId && entry.warehouseId === warehouseId)?.balanceAfter || 0;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    const body = mode === "partner" ? { action: mode, kind, code, name, ...(email ? { contactEmail: email } : {}) }
      : mode === "invoice" ? { action: mode, kind: invoiceKind, orderId, ...(dueDate ? { dueDate } : {}) }
      : mode === "count" ? { action: mode, itemId, warehouseId, expectedQuantity: stock, countedQuantity: quantity, reason, approved }
      : mode === "return" ? { action: mode, receiptLineId, quantity, reason }
      : mode === "closePeriod" ? { action: mode, periodId }
      : { action: "journal", entryDate: date, description: reason, lines: [{ accountCode: debit, accountName: debit, debitAmount: amount, creditAmount: 0 }, { accountCode: credit, accountName: credit, debitAmount: 0, creditAmount: amount }] };
    try {
      const response = await fetch("/api/erp/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json: any = await response.json(); if (!json.success) throw new Error(json.error?.message || "操作失敗");
      setMessage(json.data.message || `操作已完成 ${json.data.referenceDoc || json.data.entryNumber || ""}`); setApproved(false); onSaved();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="rounded-xl border bg-white p-6 space-y-4">
    <h2 className="text-lg font-bold">往來主檔、帳務與庫存更正</h2>
    <div className="flex flex-wrap gap-2">{[["partner", "供應商／客戶"], ["invoice", "建立應收應付"], ["return", "供應商退貨"], ["count", "核准盤點"], ["journal", "傳票過帳"], ["closePeriod", "期間關帳"]].map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setMessage(""); setError(""); }} className={`rounded-lg border px-3 py-2 text-xs ${mode === value ? "bg-primary text-white" : "bg-stone-50"}`}>{label}</button>)}</div>
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      {mode === "partner" && <><label className="block text-sm">類型<select className={input} value={kind} onChange={e => setKind(e.target.value)}><option value="supplier">供應商</option><option value="customer">客戶</option></select></label><label className="block text-sm">代碼<input required maxLength={100} className={input} value={code} onChange={e => setCode(e.target.value)} /></label><label className="block text-sm">名稱<input required maxLength={200} className={input} value={name} onChange={e => setName(e.target.value)} /></label><label className="block text-sm">聯絡 Email（選填）<input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} /></label></>}
      {mode === "invoice" && <><p className="text-sm text-stone-500">完成整單收貨或出貨後，按原訂單單價建立一次內部帳單，再於上方清單核銷。不開立電子發票。</p><label className="block text-sm">帳單類別<select className={input} value={invoiceKind} onChange={e => { setInvoiceKind(e.target.value); setOrderId(""); }}><option value="payable">應付帳款（採購）</option><option value="receivable">應收帳款（銷售）</option></select></label><label className="block text-sm">來源訂單<select required className={input} value={orderId} onChange={e => setOrderId(e.target.value)}><option value="">請選擇</option>{(invoiceKind === "payable" ? data.purchaseOrders : data.salesOrders).map((order: any) => <option key={order.id} value={order.id}>{order.poNumber || order.soNumber} · ${order.totalAmount}</option>)}</select></label><label className="block text-sm">到期日（選填）<input type="date" className={input} value={dueDate} onChange={e => setDueDate(e.target.value)} /></label></>}
      {mode === "return" && <><label className="block text-sm">原收貨明細<select required className={input} value={receiptLineId} onChange={e => setReceiptLineId(e.target.value)}><option value="">請選擇</option>{data.receiptLines?.map((line: any) => <option key={line.id} value={line.id}>{data.receipts?.find((receipt: any) => receipt.id === line.receiptId)?.receiptNumber} · {data.items.find((item: any) => item.id === line.itemId)?.name} · 原收 {line.quantity}</option>)}</select></label><label className="block text-sm">退貨數量<input type="number" required min={1} step={1} className={input} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label></>}
      {mode === "count" && <><label className="block text-sm">品項<select required className={input} value={itemId} onChange={e => setItemId(e.target.value)}><option value="">請選擇</option>{data.items.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-sm">倉庫<select required className={input} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">請選擇</option>{data.warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><p className="text-sm">目前帳面庫存：{stock}</p><label className="block text-sm">實際盤點數量<input required type="number" min={0} step={1} className={input} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" required checked={approved} onChange={e => setApproved(e.target.checked)} />以管理員身分核准差異 {quantity - stock} 件並過帳</label></>}
      {mode === "journal" && <><p className="text-sm text-stone-500">簡化雙分錄傳票。借貸同額，由後端驗證；已關帳期間禁止回寫。</p><label className="block text-sm">入帳日期<input required type="date" className={input} value={date} onChange={e => setDate(e.target.value)} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">借方科目代碼<input required className={input} value={debit} onChange={e => setDebit(e.target.value)} /></label><label className="block text-sm">貸方科目代碼<input required className={input} value={credit} onChange={e => setCredit(e.target.value)} /></label></div><label className="block text-sm">借貸金額 TWD<input type="number" required min={1} step={1} className={input} value={amount} onChange={e => setAmount(Number(e.target.value))} /></label></>}
      {["return", "count", "journal"].includes(mode) && <label className="block text-sm">{mode === "journal" ? "摘要" : "原因"}<input required maxLength={500} className={input} value={reason} onChange={e => setReason(e.target.value)} /></label>}
      {mode === "closePeriod" && <><p className="text-sm text-stone-500">管理員確認試算表平衡後關帳。展示版不提供解除關帳；可重置自己的展示空間。</p><label className="block text-sm">期間<select required className={input} value={periodId} onChange={e => setPeriodId(e.target.value)}><option value="">請選擇未關帳期間</option>{data.fiscalPeriods?.filter((period: any) => !period.isClosed).map((period: any) => <option key={period.id} value={period.id}>{period.periodCode} · {period.startDate}～{period.endDate}</option>)}</select></label></>}
      <button className={button} disabled={busy}>{busy ? "處理中…" : "確認執行"}</button>
    </form>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {mode === "journal" && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">日期</th><th className="p-2">傳票</th><th className="p-2">摘要</th></tr></thead><tbody>{data.journalEntries?.map((entry: any) => <tr key={entry.id} className="border-t"><td className="p-2">{entry.entryDate}</td><td className="p-2">{entry.entryNumber}</td><td className="p-2">{entry.description}</td></tr>)}</tbody></table></div>}
  </section>;
}
