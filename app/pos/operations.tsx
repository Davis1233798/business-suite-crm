"use client";
import { useState } from "react";

type Props = { data: any; cart: any[]; setCart: (cart: any[]) => void; refresh: () => void };
const field = "w-full rounded-lg border border-stone-300 bg-white p-2 text-sm";
const button = "rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold hover:bg-stone-100 disabled:opacity-40";
export default function PosOperations({ data, cart, setCart, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cartName, setCartName] = useState("訪客掛單");
  const [cash, setCash] = useState(1000);
  const [notes, setNotes] = useState("");
  const [selectedSale, setSelectedSale] = useState("");
  const [returns, setReturns] = useState<Record<string, number>>({});
  const [receipt, setReceipt] = useState<any>(null);
  const openShift = data.shifts.find((shift: any) => shift.status === "open");
  const sale = data.sales.find((entry: any) => entry.id === selectedSale);
  const lines = (data.saleLines || []).filter((line: any) => line.saleId === selectedSale);
  const action = async (payload: Record<string, unknown>) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/pos/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json: any = await response.json();
      if (!json.success) throw new Error(json.error?.message || "操作失敗");
      if (payload.action === "hold") setCart([]);
      if (payload.action === "retrieve") {
        const restored = json.data.items.map((line: any) => ({ item: data.catalogItems.find((item: any) => item.barcode === line.barcode), quantity: line.quantity, lineDiscount: line.lineDiscount || 0 }));
        if (restored.some((line: any) => !line.item)) throw new Error("掛單內商品已停用，請洽管理員");
        setCart(restored);
      }
      if (payload.action === "receipt") setReceipt(json.data);
      if (payload.action === "refund") setReturns({});
      setMessage(payload.action === "close" ? `結班完成，預期現金 $${json.data.expectedCash}，差異 $${json.data.discrepancy}` : payload.action === "refund" ? `退款完成：$${json.data.totalRefundAmount}` : "操作已完成");
      refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="space-y-5">
    <h2 className="text-lg font-bold">掛單、班結與售後</h2>
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="grid gap-5 md:grid-cols-2">
      <article className="space-y-3 rounded-xl border bg-white p-5">
        <h3 className="font-semibold">暫存購物籃</h3>
        <label className="block text-xs">掛單名稱<input className={field} value={cartName} maxLength={80} onChange={event => setCartName(event.target.value)} /></label>
        <button className={button} disabled={busy || !cart.length || !cartName.trim()} onClick={() => action({ action: "hold", storeId: data.stores[0]?.id, cartName, items: cart.map(line => ({ barcode: line.item.barcode, quantity: line.quantity, lineDiscount: line.lineDiscount })) })}>掛單並清空購物籃</button>
        <p className="text-xs text-stone-500">掛單不扣庫存。購物籃為空時可取回；取回後以目前售價結帳。</p>
        {!data.heldCarts.length && <p className="text-sm text-stone-400">目前沒有掛單</p>}
        {data.heldCarts.map((held: any) => <div key={held.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm"><span className="min-w-0 break-words">{held.cartName}</span><button className={button} disabled={busy || cart.length > 0} onClick={() => action({ action: "retrieve", cartId: held.id })}>取回</button></div>)}
      </article>
      <article className="space-y-3 rounded-xl border bg-white p-5">
        <h3 className="font-semibold">{openShift ? "現金盤點與結班" : "開啟新班別"}</h3>
        <p className="break-all text-xs text-stone-500">{openShift ? `目前班別 ${openShift.id}，準備金 $${openShift.openingCash}` : "目前沒有開啟的班別，請先輸入準備金。"}</p>
        <label className="block text-xs">{openShift ? "實點現金 TWD" : "開班準備金 TWD"}<input type="number" min={0} step={1} className={field} value={cash} onChange={event => setCash(Number(event.target.value))} /></label>
        {openShift && <label className="block text-xs">盤差說明（有差異必填）<input className={field} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} /></label>}
        <button className={button} disabled={busy || !Number.isSafeInteger(cash) || cash < 0} onClick={() => action(openShift ? { action: "close", shiftId: openShift.id, closingCash: cash, notes } : { action: "open", registerId: data.registers[0]?.id, openingCash: cash })}>{openShift ? "確認結班" : "確認開班"}</button>
      </article>
    </div>
    <article className="space-y-4 rounded-xl border bg-white p-5">
      <h3 className="font-semibold">收據查詢與退貨退款</h3>
      <label className="block text-xs">選擇原交易<select className={field} value={selectedSale} onChange={event => { setSelectedSale(event.target.value); setReturns({}); setReceipt(null); }}><option value="">請選擇交易</option>{data.sales.map((entry: any) => <option key={entry.id} value={entry.id}>{entry.receiptNumber} · ${entry.totalAmount}</option>)}</select></label>
      {!data.sales.length && <p className="text-sm text-stone-400">完成第一筆收銀後可查詢收據與辦理退款。</p>}
      {sale && <>
        <button className={button} disabled={busy} onClick={() => action({ action: "receipt", receiptNumber: sale.receiptNumber })}>查看重印收據</button>
        {lines.map((line: any) => <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"><span>{line.name} · 原購 {line.quantity} · 已退 {line.refundedQuantity}</span><label className="text-xs">本次退貨數量<input type="number" min={0} max={line.quantity - line.refundedQuantity} step={1} className="ml-2 w-20 rounded border p-2" value={returns[line.id] || 0} onChange={event => setReturns({ ...returns, [line.id]: Number(event.target.value) })} /></label></div>)}
        <label className="block text-xs">退款原因（店長權限）<input className={field} value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} /></label>
        <button className={button} disabled={busy || !notes.trim() || !Object.values(returns).some(quantity => quantity > 0)} onClick={() => action({ action: "refund", saleId: sale.id, reason: notes, lineReturns: Object.entries(returns).filter(([, quantity]) => quantity > 0).map(([lineId, quantity]) => ({ lineId, quantity })) })}>確認退貨與現金退款</button>
      </>}
      {receipt && <div className="rounded-lg border-2 border-dashed bg-stone-50 p-4 font-mono text-sm"><strong>【重印收據】{receipt.receiptNumber}</strong><p>現金交易展示 · 非電子發票</p>{receipt.lines.map((line: any) => <p key={line.id}>{line.name} × {line.quantity}：${line.lineTotal}</p>)}<p>合計 ${receipt.totalAmount} · 實收 ${receipt.tenderAmount} · 找零 ${receipt.changeAmount}</p></div>}
    </article>
  </section>;
}
