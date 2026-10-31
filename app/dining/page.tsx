"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspace-header";
import { TakeoutHistory } from "./takeout-history";
import { UtensilsCrossed, ChefHat, Plus, Minus, RefreshCw, ArrowLeft, Receipt, Armchair, CalendarDays, Trash2 } from "lucide-react";

type Table = { id: string; tableNumber: string; capacity: number; status: string };
type Session = { id: string; tableId: string; sessionToken: string; guestCount: number; status: string };
type Menu = { id: string; name: string; category: string; price: number; isSoldOut: boolean };
type ModifierGroup = {id: string; name: string; isRequired: boolean; maxSelection: number};
type Modifier = {id: string; groupId: string; name: string; additionalPrice: number};
type Order = {id: string; sessionId: string | null; orderType: string; takeoutNumber: string | null; totalAmount: number; status: string};
type OrderItem = {id: string; orderId: string; itemName: string; quantity: number; lineTotal: number; status: string};
type Ticket = {id: string; orderId: string; orderItemId: string; station: string; itemName: string; quantity: number; modifiersText: string; status: string; urgentFlag: boolean};
type Reservation = {id: string; tableId: string; customerName: string; guestCount: number; reservationTime: string; status: string};
type Data = {tables: Table[]; sessions: Session[]; menuItems: Menu[]; modifierGroups: ModifierGroup[]; modifierOptions: Modifier[]; orders: Order[]; orderItems: OrderItem[]; kdsTickets: Ticket[]; reservations: Reservation[]; locations: {name: string; serviceFeeRate: number}[]; bills: {id: string; orderId: string | null; finalAmount: number; paidAmount: number; status: string}[]};
type CartLine = {key: string; menuItemId: string; name: string; quantity: number; unitPrice: number; modifiers: {groupId: string; optionId: string}[]; description: string};
type Envelope<T> = {success: boolean; data: T; error?: {message: string}; request_id?: string};
const money = (n: number) => new Intl.NumberFormat("en-US", {style: "currency", currency: "TWD", maximumFractionDigits: 0}).format(n);
const button = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const field = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm";
const statuses: Record<string, string> = {received: "Queued", cooking: "Preparing", done: "Ready", served: "Served", pending: "Queued", preparing: "Preparing", ready: "Ready", cancelled: "Voided"};
const next: Record<string, "cooking" | "done" | "served"> = {received: "cooking", cooking: "done", done: "served"};

export default function DiningPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("floor");
  const [orderMode, setOrderMode] = useState<"dine_in" | "takeout">("dine_in");
  const [tableId, setTableId] = useState("");
  const [guests, setGuests] = useState(2);
  const [cart, setCart] = useState<CartLine[]>([]);
  const orderKey = useRef("");
  useEffect(() => {orderKey.current = crypto.randomUUID();}, [cart]);
  const [selectedMods, setSelectedMods] = useState<Record<string, string[]>>({});
  const [category, setCategory] = useState("All");
  const [station, setStation] = useState("All");
  const [splitCount, setSplitCount] = useState(1);
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [reservationTable, setReservationTable] = useState("");
  const [reservationName, setReservationName] = useState("");
  const [reservationPhone, setReservationPhone] = useState("");
  const [reservationGuests, setReservationGuests] = useState(2);
  const [reservationTime, setReservationTime] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/dining/data", {cache: "no-store"});
      const json = await response.json() as Envelope<Data>;
      if (!response.ok || !json.success) throw new Error(json.error?.message || "Unable to load data");
      setData(json.data);
      setTableId(current => current || json.data.sessions.find((s: Session) => s.status === "active")?.tableId || json.data.tables[0]?.id || "");
      setReservationTable(current => current || json.data.tables[0]?.id || "");
    } catch(e) {setError(e instanceof Error ? e.message : "Connection failed. Please retry.");}
    finally {setLoading(false);}
  }
  useEffect(() => {void load();}, []);

  async function mutate(path: string, body: unknown, message: string, onSuccess?: () => void) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/dining/${path}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      const json = await response.json() as Envelope<unknown>;
      if (!response.ok || !json.success) throw new Error(`${json.error?.message || "Operation failed"}${json.request_id ? `(trace ID  ${json.request_id})` : ""}`);
      setNotice(message); onSuccess?.(); await load();
    } catch(e) {setError(e instanceof Error ? e.message : "Connection failed. Please retry.");}
    finally {setBusy(false);}
  }

  const table = data?.tables.find(t => t.id === tableId);
  const session = data?.sessions.find(s => s.tableId === tableId && s.status === "active");
  const orderIds = new Set(data?.orders.filter(o => o.sessionId === session?.id).map(o => o.id));
  const items = data?.orderItems.filter(i => orderIds.has(i.orderId)) || [];
  const subtotal = items.filter(i => i.status !== "cancelled").reduce((sum, i) => sum + i.lineTotal, 0);
  const rate = data?.locations[0]?.serviceFeeRate ?? 10;
  const fee = Math.round(subtotal * rate / 100);
  const total = subtotal + fee;
  const cartTotal = cart.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const splits = Array.from({length: splitCount}, (_, index) => ({splitIndex: index + 1, amount: Math.floor(total / splitCount) + (index < total % splitCount ? 1 : 0), paymentMethod: method}));

  function add(item: Menu) {
    if (!data) return;
    const mods = item.category === "Drinks" ? data.modifierGroups.flatMap(g => (selectedMods[g.id] || []).map(optionId => ({groupId: g.id, optionId}))) : [];
    if (item.category === "Drinks" && data.modifierGroups.some(g => g.isRequired && !(selectedMods[g.id]?.length))) {setError("Select the required drink options first"); return;}
    const options = mods.map(m => data.modifierOptions.find(o => o.id === m.optionId)!).filter(Boolean);
    const key = `${item.id}:${mods.map(m => m.optionId).sort().join(",")}`;
    setCart(current => current.some(i => i.key === key) ? current.map(i => i.key === key ? {...i, quantity: i.quantity + 1} : i) : [...current, {key, menuItemId: item.id, name: item.name, unitPrice: item.price + options.reduce((s, o) => s + o.additionalPrice, 0), quantity: 1, modifiers: mods, description: options.map(o => o.name).join(", ")}]);
    setError("");
  }

  async function reserve(event: FormEvent) {
    event.preventDefault();
    // datetime-local denotes a Taipei wall-clock value, independent of browser timezone.
    const instant = new Date(`${reservationTime}:00+08:00`).toISOString();
    await mutate("reservation", {tableId: reservationTable, customerName: reservationName, customerPhone: reservationPhone, guestCount: reservationGuests, reservationTime: instant}, "Reservation created", () => {setReservationName(""); setReservationPhone("");});
  }

  return <main data-site="dining" data-dining-view={tab} className="suite-page suite-dining space-y-6">
    <WorkspaceHeader brand="TableCraft" eyebrow="Dining operations / SERVICE" title="Care for every table." description="Connect front-of-house orders, kitchen service and billing." onRefresh={() => void load()} busy={busy || loading}><span className="dining-service-tag"><UtensilsCrossed size={15}/>Dining workspace</span></WorkspaceHeader>
    <p className="workspace-note">Demo workspace · Card payments are simulated. No actual charges.</p>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span className="break-all">{error}</span><button className="underline" onClick={() => void load()}>Retry loading</button></div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
    {data && <>
      <section aria-label="Operations overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        ["Occupied tables", `${data.sessions.filter(s => s.status === "active").length} / ${data.tables.length}`],
        ["Pending kitchen items", data.kdsTickets.filter(t => t.status !== "served").length],
        ["Reservations", data.reservations.filter(r => r.status === "confirmed").length],
        ["Total collected", money(data.bills.filter(b => b.status === "paid").reduce((s, b) => s + b.finalAmount, 0))],
      ].map(([name, value]) => <div key={name} className="rounded-xl border border-stone-200 bg-white p-4"><p className="text-xs text-stone-500">{name}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</section>
      <nav aria-label="Dining workspace" className="dining-tabs flex gap-2 overflow-x-auto border-b border-stone-200 pb-3">{[["floor", "Tables and ordering", Armchair], ["kitchen", "Kitchen KDS", ChefHat], ["billing", "Bills and splits", Receipt], ["reservations", "Reservations", CalendarDays]].map(([id, label, Icon]) => {const TabIcon = Icon as typeof Armchair; return <button key={String(id)} onClick={() => setTab(String(id))} aria-current={tab === id ? "page" : undefined} className={`${button} shrink-0 ${tab === id ? "bg-primary text-white" : "bg-white text-stone-600 hover:bg-stone-100"}`}><TabIcon size={16}/>{String(label)}</button>;})}</nav>
      {((tab === "floor" && orderMode === "dine_in") || tab === "billing") && <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">{data.tables.map(t => {const active = data.sessions.find(s => s.tableId === t.id && s.status === "active"); return <button key={t.id} disabled={busy} onClick={() => {if(t.id !== tableId) setCart([]); setTableId(t.id);}} className={`rounded-xl border p-5 text-left ${t.id === tableId ? "border-primary bg-[#d4e9e2] ring-1 ring-primary" : "border-stone-200 bg-white"}`}><div className="flex items-center justify-between"><strong className="text-xl">{t.tableNumber}</strong><span className={`rounded-full px-2 py-1 text-xs ${active ? "bg-orange-100 text-orange-800" : "bg-emerald-50 text-emerald-700"}`}>{active ? "Occupied" : t.status === "vacant" ? "Available" : "Unavailable"}</span></div><p className="mt-3 text-xs text-stone-500">{t.capacity} seats{active && ` · ${active.guestCount} guests`}</p></button>;})}</section>}
      {tab === "floor" && <>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4"><span className="text-sm font-medium">Order type</span>{(["dine_in", "takeout"] as const).map(mode => <button key={mode} disabled={busy} onClick={() => {setOrderMode(mode); setCart([]);}} className={`${button} ${orderMode === mode ? "bg-primary text-white" : "bg-stone-100 text-stone-600"}`}>{mode === "dine_in" ? "Dine in" : "Prepaid takeout"}</button>)}<span className="text-xs text-stone-500">Takeout has no service fee. Payment creates a pickup number and sends the order to the kitchen.</span></div>
        {orderMode === "dine_in" && !session && table && <form onSubmit={e => {e.preventDefault(); void mutate("session", {tableId, guestCount: guests}, `${table.tableNumber} Table opened`);}} className="flex flex-wrap items-end gap-4 rounded-xl border border-stone-200 bg-white p-5"><label className="text-sm">{table.tableNumber} Party size<input className={`${field} mt-2 max-w-32`} type="number" min={1} max={table.capacity} value={guests} onChange={e => setGuests(Number(e.target.value))}/></label><button disabled={busy || table.status !== "vacant"} className={`${button} bg-primary text-white`}>Open table</button></form>}
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]"><section className="space-y-4"><div className="flex flex-wrap gap-2">{["All", ...new Set(data.menuItems.map(i => i.category))].map(c => <button key={c} className={`${button} ${category === c ? "bg-[#d4e9e2] text-[#1e3932]" : "bg-white text-stone-500"}`} onClick={() => setCategory(c)}>{c}</button>)}</div><div className="grid gap-4 sm:grid-cols-2">{data.menuItems.filter(i => category === "All" || category === i.category).map(item => <article key={item.id} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5"><span className="text-xs text-orange-700">{item.category}</span><h2 className="mt-2 text-lg font-semibold">{item.name}</h2><p className="my-4 text-xl font-bold">{money(item.price)}</p>{item.category === "Drinks" && data.modifierGroups.map(g => <fieldset key={g.id} className="mb-4"><legend className="mb-2 text-xs font-semibold text-stone-600">{g.name}</legend><div className="flex flex-wrap gap-2">{data.modifierOptions.filter(o => o.groupId === g.id).map(o => <label key={o.id} className="flex items-center gap-1 rounded-lg bg-stone-50 px-2 py-1.5 text-xs"><input type={g.maxSelection === 1 ? "radio" : "checkbox"} name={g.id} checked={(selectedMods[g.id] || []).includes(o.id)} onChange={e => setSelectedMods(current => ({...current, [g.id]: g.maxSelection === 1 ? [o.id] : e.target.checked ? [...(current[g.id] || []), o.id] : (current[g.id] || []).filter(id => id !== o.id)}))}/>{o.name}{o.additionalPrice > 0 && ` +${o.additionalPrice}`}</label>)}</div></fieldset>)}<button disabled={(orderMode === "dine_in" && !session) || item.isSoldOut || busy} onClick={() => add(item)} className={`${button} mt-auto bg-primary text-white`}><Plus size={16}/>{item.isSoldOut ? "Sold out today" : "Add to order"}</button></article>)}</div></section>
        <aside className="dining-order h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">{orderMode === "takeout" ? "Prepaid takeout" : table?.tableNumber || "Select a table"} · Current order</h2>{orderMode === "dine_in" && !session && <p className="text-sm text-orange-700">Select an occupied table or open a table to begin ordering.</p>}{!cart.length && <p className="py-6 text-center text-sm text-stone-400">No items added</p>}{cart.map(line => <div key={line.key} className="border-b border-stone-100 pb-4"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium">{line.name}</p><p className="mt-1 text-xs text-stone-400">{line.description}</p></div><span className="text-sm">{money(line.unitPrice * line.quantity)}</span></div><div className="mt-3 flex items-center gap-3"><button aria-label={`Decrease ${line.name}`} disabled={busy} onClick={() => setCart(current => current.flatMap(i => i.key !== line.key ? [i] : i.quantity > 1 ? [{...i, quantity: i.quantity - 1}] : []))} className="rounded-lg border p-1.5"><Minus size={14}/></button><span className="text-sm">{line.quantity}</span><button aria-label={`Increase ${line.name}`} disabled={busy || line.quantity >= 100} onClick={() => setCart(current => current.map(i => i.key === line.key ? {...i, quantity: i.quantity + 1} : i))} className="rounded-lg border p-1.5"><Plus size={14}/></button></div></div>)}<div className="flex justify-between text-sm"><span>Food subtotal</span><span>{money(cartTotal)}</span></div><div className="flex justify-between text-xs text-stone-500"><span>Service charge {orderMode === "takeout" ? 0 : rate}%(calculated at checkout)</span><span>{money(orderMode === "takeout" ? 0 : Math.round(cartTotal * rate / 100))}</span></div>{orderMode === "takeout" && <label className="block text-sm">Takeout payment<select className={`${field} mt-2`} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Cash (demo ledger)</option><option value="mock_card">Simulated card (no charges)</option></select></label>}<button disabled={busy || (orderMode === "dine_in" && !session) || !cart.length} onClick={() => void mutate(orderMode === "takeout" ? "takeout" : "order", {sessionToken: session?.sessionToken, paymentMethod: method, items: cart.map(({menuItemId, quantity, modifiers}) => ({menuItemId, quantity, modifiers})), idempotencyKey: orderKey.current}, orderMode === "takeout" ? "Takeout paid. See pickup number in the takeout records below." : "Order sent to kitchen", () => setCart([]))} className={`${button} w-full bg-primary text-white`}>{busy ? "Processing…" : orderMode === "takeout" ? `Confirm payment ${money(cartTotal)} and send order` : "Confirm order"}</button></aside></div>
        {orderMode === "takeout" && <TakeoutHistory orders={data.orders.filter(o => o.orderType === "takeout")} bills={data.bills} busy={busy} onRefund={(orderId, reason) => void mutate("takeout/refund", {orderId, reason}, "Takeout fully refunded in demo ledger. Kitchen order canceled.")} />}
      </>}
      {tab === "kitchen" && <section className="space-y-5"><div className="flex flex-wrap items-center gap-3"><label htmlFor="station" className="text-sm font-medium">Kitchen station</label><select id="station" value={station} onChange={e => setStation(e.target.value)} className={`${field} max-w-56`}>{["All", ...new Set(data.kdsTickets.map(t => t.station))].map(s => <option key={s}>{s}</option>)}</select><p className="text-xs text-stone-500">Queued → Preparing → Ready → Served. Updates synchronize bill details.</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.kdsTickets.filter(t => t.status !== "served" && (station === "All" || t.station === station)).map(ticket => {const order = data.orders.find(o => o.id === ticket.orderId); const sess = data.sessions.find(s => s.id === order?.sessionId); const tableName = order?.orderType === "takeout" ? `Takeout ${order.takeoutNumber}` : data.tables.find(t => t.id === sess?.tableId)?.tableNumber; return <article key={ticket.id} className="rounded-xl border border-stone-200 bg-white p-5"><div className="flex items-center justify-between"><span className="break-all font-bold">{order?.orderType === "takeout" ? tableName : `table ${tableName || "—"}`}</span><span className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-800">{statuses[ticket.status]}</span></div>{ticket.urgentFlag && <p role="status" className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">Service team requested priority</p>}<h2 className="mt-4 font-semibold">{ticket.itemName} × {ticket.quantity}</h2><p className="mt-2 min-h-5 text-xs text-stone-500">{ticket.modifiersText || "No extras"}</p><p className="my-4 text-xs text-stone-400">{ticket.station}</p><button disabled={busy || ticket.urgentFlag} onClick={() => void mutate("kds/urge", {ticketId: ticket.id}, "Priority request sent to kitchen")} className={`${button} mb-3 w-full border border-orange-200 text-orange-800`}>{ticket.urgentFlag ? "Priority requested" : "Request priority"}</button><button disabled={busy || !next[ticket.status]} onClick={() => void mutate("kds/status", {ticketId: ticket.id, newStatus: next[ticket.status]}, "Kitchen status updated")} className={`${button} w-full bg-primary text-white`}>{ticket.status === "received" ? "Start preparation" : ticket.status === "cooking" ? "Mark ready" : "Mark served"}</button></article>;})}</div>{!data.kdsTickets.some(t => t.status !== "served" && (station === "All" || t.station === station)) && <p className="rounded-xl border border-dashed p-10 text-center text-stone-500">No pending kitchen items</p>}</section>}
      {tab === "billing" && <section className="grid gap-6 lg:grid-cols-[1fr_340px]"><div className="space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">{table?.tableNumber} table · Bill details</h2>{!session ? <p className="py-8 text-sm text-stone-500">No open bill for this table.</p> : !items.length ? <p className="py-8 text-sm text-stone-500">No items ordered</p> : items.map(i => <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 py-3"><div><p className={`text-sm font-medium ${i.status === "cancelled" ? "line-through text-stone-400" : ""}`}>{i.itemName} × {i.quantity}</p><p className="mt-1 text-xs text-stone-500">{statuses[i.status] || i.status}</p></div><div className="flex items-center gap-3"><span className="text-sm">{money(i.status === "cancelled" ? 0 : i.lineTotal)}</span>{i.status !== "cancelled" && <button disabled={busy || !reason.trim()} onClick={() => void mutate("cancel", {orderItemId: i.id, reason}, "Item voided. Bill recalculated.")} aria-label={`Void item${i.itemName}`} className="rounded-lg p-2 text-red-700 disabled:opacity-30"><Trash2 size={16}/></button>}</div></div>)}<label className="block text-xs text-stone-600">Void reason (preparing items require a manager)<input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className={`${field} mt-2`} placeholder="e.g. Customer changed their order"/></label></div><aside className="h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">Split bill checkout</h2><div className="flex justify-between text-sm"><span>Active items</span><span>{money(subtotal)}</span></div><div className="flex justify-between text-sm"><span>Service charge {rate}%</span><span>{money(fee)}</span></div><div className="flex justify-between border-t pt-4 text-xl font-bold"><span>Due</span><span>{money(total)}</span></div><label className="block text-sm">Split count<select className={`${field} mt-2`} value={splitCount} onChange={e => setSplitCount(Number(e.target.value))}>{[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} people</option>)}</select></label><label className="block text-sm">Payment method<select className={`${field} mt-2`} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Cash (demo ledger)</option><option value="mock_card">Simulated card (no charges)</option></select></label>{splits.map(s => <div key={s.splitIndex} className="flex justify-between text-xs text-stone-500"><span>Split  {s.splitIndex} people</span><span>{money(s.amount)}</span></div>)}<button disabled={busy || !session || total <= 0 || splits.some(s => s.amount <= 0)} onClick={() => void mutate("bill/pay", {sessionId: session?.id, splits}, "Checkout complete. Table released.")} className={`${button} w-full bg-primary text-white`}>{busy ? "Processing…" : "Collect payment and close bill"}</button><p className="text-xs leading-relaxed text-stone-400">Checkout settles all splits and closes the table session. The ordering token then expires.</p></aside></section>}
      {tab === "reservations" && <section className="grid gap-6 lg:grid-cols-[340px_1fr]"><form onSubmit={e => void reserve(e)} className="h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">New reservation</h2><p className="text-xs leading-relaxed text-stone-500">Reservations last 90 minutes. Overlapping reservations for the same table are blocked.</p><label className="block text-sm">Table<select className={`${field} mt-2`} value={reservationTable} onChange={e => setReservationTable(e.target.value)}>{data.tables.map(t => <option key={t.id} value={t.id}>{t.tableNumber} · {t.capacity} seats</option>)}</select></label><label className="block text-sm">Customer name<input className={`${field} mt-2`} required maxLength={100} value={reservationName} onChange={e => setReservationName(e.target.value)}/></label><label className="block text-sm">Phone<input className={`${field} mt-2`} type="tel" required minLength={3} maxLength={30} value={reservationPhone} onChange={e => setReservationPhone(e.target.value)}/></label><label className="block text-sm">Party size<input className={`${field} mt-2`} type="number" min={1} max={data.tables.find(t => t.id === reservationTable)?.capacity || 100} required value={reservationGuests} onChange={e => setReservationGuests(Number(e.target.value))}/></label><label className="block text-sm">Dining time (Taipei)<input className={`${field} mt-2`} type="datetime-local" required value={reservationTime} onChange={e => setReservationTime(e.target.value)}/></label><button disabled={busy} className={`${button} w-full bg-primary text-white`}>Create reservation</button></form><div className="space-y-3">{!data.reservations.length && <p className="rounded-xl border border-dashed p-8 text-center text-stone-500">No reservations</p>}{data.reservations.map(r => <article key={r.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5"><div><h2 className="font-semibold">{r.customerName} · {r.guestCount} guests</h2><p className="mt-2 text-sm text-stone-500">{new Date(r.reservationTime.includes("T") ? r.reservationTime : `${r.reservationTime.replace(" ", "T")}:00+08:00`).toLocaleString("en-US", {timeZone: "Asia/Taipei"})}</p></div><span className="rounded-lg bg-stone-100 px-3 py-2 text-sm">{data.tables.find(t => t.id === r.tableId)?.tableNumber} table · {r.status === "confirmed" ? "Confirmed" : r.status}</span></article>)}</div></section>}
    </>}
    {!data && <div className="rounded-xl border border-dashed p-12 text-center text-stone-500">{loading ? "Loading dining operations…" : "Unable to load data. Please refresh."}</div>}
  </main>;
}
