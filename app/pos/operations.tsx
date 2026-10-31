"use client";
import { useState } from "react";

type Props = { data: any; cart: any[]; setCart: (cart: any[]) => void; refresh: () => void };
const field = "w-full rounded-lg border border-stone-300 bg-white p-2 text-sm";
const button = "rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold hover:bg-stone-100 disabled:opacity-40";
export default function PosOperations({ data, cart, setCart, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cartName, setCartName] = useState("Guest cart");
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
      if (!json.success) throw new Error(json.error?.message || "Operation failed");
      if (payload.action === "hold") setCart([]);
      if (payload.action === "retrieve") {
        const restored = json.data.items.map((line: any) => ({ item: data.catalogItems.find((item: any) => item.barcode === line.barcode), quantity: line.quantity, lineDiscount: line.lineDiscount || 0 }));
        if (restored.some((line: any) => !line.item)) throw new Error("A held item is inactive. Contact an administrator.");
        setCart(restored);
      }
      if (payload.action === "receipt") setReceipt(json.data);
      if (payload.action === "refund") setReturns({});
      setMessage(payload.action === "close" ? `Shift closed. Expected cash:  $${json.data.expectedCash}, variance:  $${json.data.discrepancy}` : payload.action === "refund" ? `Refund complete: $${json.data.totalRefundAmount}` : "Operation complete");
      refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return <section className="space-y-5">
    <h2 className="text-lg font-bold">Held carts, shifts and refunds</h2>
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="grid gap-5 md:grid-cols-2">
      <article className="space-y-3 rounded-xl border bg-white p-5">
        <h3 className="font-semibold">Hold cart</h3>
        <label className="block text-xs">Held cart name<input className={field} value={cartName} maxLength={80} onChange={event => setCartName(event.target.value)} /></label>
        <button className={button} disabled={busy || !cart.length || !cartName.trim()} onClick={() => action({ action: "hold", storeId: data.stores[0]?.id, cartName, items: cart.map(line => ({ barcode: line.item.barcode, quantity: line.quantity, lineDiscount: line.lineDiscount })) })}>Hold and clear cart</button>
        <p className="text-xs text-stone-500">Holding does not reserve stock. Recall into an empty cart and check out at current prices.</p>
        {!data.heldCarts.length && <p className="text-sm text-stone-400">No held carts</p>}
        {data.heldCarts.map((held: any) => <div key={held.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm"><span className="min-w-0 break-words">{held.cartName}</span><button className={button} disabled={busy || cart.length > 0} onClick={() => action({ action: "retrieve", cartId: held.id })}>Recall</button></div>)}
      </article>
      <article className="space-y-3 rounded-xl border bg-white p-5">
        <h3 className="font-semibold">{openShift ? "Cash count and shift closing" : "Open new shift"}</h3>
        <p className="break-all text-xs text-stone-500">{openShift ? `Current shift ${openShift.id}, opening cash:  $${openShift.openingCash}` : "No open shift. Enter opening cash first."}</p>
        <label className="block text-xs">{openShift ? "Counted cash TWD" : "Opening cash TWD"}<input type="number" min={0} step={1} className={field} value={cash} onChange={event => setCash(Number(event.target.value))} /></label>
        {openShift && <label className="block text-xs">Variance notes (required for discrepancies)<input className={field} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} /></label>}
        <button className={button} disabled={busy || !Number.isSafeInteger(cash) || cash < 0} onClick={() => action(openShift ? { action: "close", shiftId: openShift.id, closingCash: cash, notes } : { action: "open", registerId: data.registers[0]?.id, openingCash: cash })}>{openShift ? "Close shift" : "Open shift"}</button>
      </article>
    </div>
    <article className="space-y-4 rounded-xl border bg-white p-5">
      <h3 className="font-semibold">Receipts and refunds</h3>
      <label className="block text-xs">Original sale<select className={field} value={selectedSale} onChange={event => { setSelectedSale(event.target.value); setReturns({}); setReceipt(null); }}><option value="">Select a sale</option>{data.sales.map((entry: any) => <option key={entry.id} value={entry.id}>{entry.receiptNumber} · ${entry.totalAmount}</option>)}</select></label>
      {!data.sales.length && <p className="text-sm text-stone-400">Receipts and refunds are available after the first sale.</p>}
      {sale && <>
        <button className={button} disabled={busy} onClick={() => action({ action: "receipt", receiptNumber: sale.receiptNumber })}>View reprinted receipt</button>
        {lines.map((line: any) => <div key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm"><span>{line.name} · Purchased {line.quantity} · Returned {line.refundedQuantity}</span><label className="text-xs">Return quantity<input type="number" min={0} max={line.quantity - line.refundedQuantity} step={1} className="ml-2 w-20 rounded border p-2" value={returns[line.id] || 0} onChange={event => setReturns({ ...returns, [line.id]: Number(event.target.value) })} /></label></div>)}
        <label className="block text-xs">Refund reason (manager access)<input className={field} value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} /></label>
        <button className={button} disabled={busy || !notes.trim() || !Object.values(returns).some(quantity => quantity > 0)} onClick={() => action({ action: "refund", saleId: sale.id, reason: notes, lineReturns: Object.entries(returns).filter(([, quantity]) => quantity > 0).map(([lineId, quantity]) => ({ lineId, quantity })) })}>Confirm return and cash refund</button>
      </>}
      {receipt && <div className="rounded-lg border-2 border-dashed bg-stone-50 p-4 font-mono text-sm"><strong>[REPRINTED RECEIPT]{receipt.receiptNumber}</strong><p>Cash transaction demo · Not a tax invoice</p>{receipt.lines.map((line: any) => <p key={line.id}>{line.name} × {line.quantity}: ${line.lineTotal}</p>)}<p>Total ${receipt.totalAmount} · Tendered ${receipt.tenderAmount} · Change ${receipt.changeAmount}</p></div>}
    </article>
  </section>;
}
