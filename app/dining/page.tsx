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
const money = (n: number) => new Intl.NumberFormat("zh-TW", {style: "currency", currency: "TWD", maximumFractionDigits: 0}).format(n);
const button = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
const field = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm";
const statuses: Record<string, string> = {received: "待製作", cooking: "製作中", done: "待送餐", served: "已送餐", pending: "待製作", preparing: "製作中", ready: "待送餐", cancelled: "已退菜"};
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
  const [category, setCategory] = useState("全部");
  const [station, setStation] = useState("全部");
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
      if (!response.ok || !json.success) throw new Error(json.error?.message || "資料載入失敗");
      setData(json.data);
      setTableId(current => current || json.data.sessions.find((s: Session) => s.status === "active")?.tableId || json.data.tables[0]?.id || "");
      setReservationTable(current => current || json.data.tables[0]?.id || "");
    } catch(e) {setError(e instanceof Error ? e.message : "無法連線，請重試");}
    finally {setLoading(false);}
  }
  useEffect(() => {void load();}, []);

  async function mutate(path: string, body: unknown, message: string, onSuccess?: () => void) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/dining/${path}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      const json = await response.json() as Envelope<unknown>;
      if (!response.ok || !json.success) throw new Error(`${json.error?.message || "操作失敗"}${json.request_id ? `（追蹤編號 ${json.request_id}）` : ""}`);
      setNotice(message); onSuccess?.(); await load();
    } catch(e) {setError(e instanceof Error ? e.message : "無法連線，請重試");}
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
    const mods = item.category === "飲品" ? data.modifierGroups.flatMap(g => (selectedMods[g.id] || []).map(optionId => ({groupId: g.id, optionId}))) : [];
    if (item.category === "飲品" && data.modifierGroups.some(g => g.isRequired && !(selectedMods[g.id]?.length))) {setError("請先選擇飲品的必選規格"); return;}
    const options = mods.map(m => data.modifierOptions.find(o => o.id === m.optionId)!).filter(Boolean);
    const key = `${item.id}:${mods.map(m => m.optionId).sort().join(",")}`;
    setCart(current => current.some(i => i.key === key) ? current.map(i => i.key === key ? {...i, quantity: i.quantity + 1} : i) : [...current, {key, menuItemId: item.id, name: item.name, unitPrice: item.price + options.reduce((s, o) => s + o.additionalPrice, 0), quantity: 1, modifiers: mods, description: options.map(o => o.name).join("、")}]);
    setError("");
  }

  async function reserve(event: FormEvent) {
    event.preventDefault();
    // datetime-local denotes a Taipei wall-clock value, independent of browser timezone.
    const instant = new Date(`${reservationTime}:00+08:00`).toISOString();
    await mutate("reservation", {tableId: reservationTable, customerName: reservationName, customerPhone: reservationPhone, guestCount: reservationGuests, reservationTime: instant}, "預約已建立", () => {setReservationName(""); setReservationPhone("");});
  }

  return <main data-site="dining" data-dining-view={tab} className="suite-page suite-dining space-y-6">
    <WorkspaceHeader brand="TableCraft" eyebrow="餐飲營運 / SERVICE" title="每一桌，都好好款待。" description="前場點餐、後場出餐與帳單結算，接住每一次服務。" onRefresh={() => void load()} busy={busy || loading}><span className="dining-service-tag"><UtensilsCrossed size={15}/>餐飲工作區</span></WorkspaceHeader>
    <p className="workspace-note">展示環境 · 刷卡為模擬流程，不會實際扣款。</p>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span className="break-all">{error}</span><button className="underline" onClick={() => void load()}>重試載入</button></div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
    {data && <>
      <section aria-label="營運概況" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
        ["使用中桌位", `${data.sessions.filter(s => s.status === "active").length} / ${data.tables.length}`],
        ["待出餐品項", data.kdsTickets.filter(t => t.status !== "served").length],
        ["預約筆數", data.reservations.filter(r => r.status === "confirmed").length],
        ["已收款合計", money(data.bills.filter(b => b.status === "paid").reduce((s, b) => s + b.finalAmount, 0))],
      ].map(([name, value]) => <div key={name} className="rounded-xl border border-stone-200 bg-white p-4"><p className="text-xs text-stone-500">{name}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</section>
      <nav aria-label="餐飲工作區" className="dining-tabs flex gap-2 overflow-x-auto border-b border-stone-200 pb-3">{[["floor", "桌位與點餐", Armchair], ["kitchen", "廚房 KDS", ChefHat], ["billing", "帳單與分帳", Receipt], ["reservations", "訂位管理", CalendarDays]].map(([id, label, Icon]) => {const TabIcon = Icon as typeof Armchair; return <button key={String(id)} onClick={() => setTab(String(id))} aria-current={tab === id ? "page" : undefined} className={`${button} shrink-0 ${tab === id ? "bg-primary text-white" : "bg-white text-stone-600 hover:bg-stone-100"}`}><TabIcon size={16}/>{String(label)}</button>;})}</nav>
      {((tab === "floor" && orderMode === "dine_in") || tab === "billing") && <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">{data.tables.map(t => {const active = data.sessions.find(s => s.tableId === t.id && s.status === "active"); return <button key={t.id} disabled={busy} onClick={() => {if(t.id !== tableId) setCart([]); setTableId(t.id);}} className={`rounded-xl border p-5 text-left ${t.id === tableId ? "border-primary bg-[#d4e9e2] ring-1 ring-primary" : "border-stone-200 bg-white"}`}><div className="flex items-center justify-between"><strong className="text-xl">{t.tableNumber}</strong><span className={`rounded-full px-2 py-1 text-xs ${active ? "bg-orange-100 text-orange-800" : "bg-emerald-50 text-emerald-700"}`}>{active ? "用餐中" : t.status === "vacant" ? "空桌" : "暫不可用"}</span></div><p className="mt-3 text-xs text-stone-500">{t.capacity} 人座{active && ` · ${active.guestCount} 位用餐`}</p></button>;})}</section>}
      {tab === "floor" && <>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4"><span className="text-sm font-medium">點餐方式</span>{(["dine_in", "takeout"] as const).map(mode => <button key={mode} disabled={busy} onClick={() => {setOrderMode(mode); setCart([]);}} className={`${button} ${orderMode === mode ? "bg-primary text-white" : "bg-stone-100 text-stone-600"}`}>{mode === "dine_in" ? "內用" : "外帶預付"}</button>)}<span className="text-xs text-stone-500">外帶不收服務費，收款後產生取餐號並送至廚房。</span></div>
        {orderMode === "dine_in" && !session && table && <form onSubmit={e => {e.preventDefault(); void mutate("session", {tableId, guestCount: guests}, `${table.tableNumber} 已開桌`);}} className="flex flex-wrap items-end gap-4 rounded-xl border border-stone-200 bg-white p-5"><label className="text-sm">{table.tableNumber} 開桌人數<input className={`${field} mt-2 max-w-32`} type="number" min={1} max={table.capacity} value={guests} onChange={e => setGuests(Number(e.target.value))}/></label><button disabled={busy || table.status !== "vacant"} className={`${button} bg-primary text-white`}>開始用餐</button></form>}
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]"><section className="space-y-4"><div className="flex flex-wrap gap-2">{["全部", ...new Set(data.menuItems.map(i => i.category))].map(c => <button key={c} className={`${button} ${category === c ? "bg-[#d4e9e2] text-[#1e3932]" : "bg-white text-stone-500"}`} onClick={() => setCategory(c)}>{c}</button>)}</div><div className="grid gap-4 sm:grid-cols-2">{data.menuItems.filter(i => category === "全部" || category === i.category).map(item => <article key={item.id} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5"><span className="text-xs text-orange-700">{item.category}</span><h2 className="mt-2 text-lg font-semibold">{item.name}</h2><p className="my-4 text-xl font-bold">{money(item.price)}</p>{item.category === "飲品" && data.modifierGroups.map(g => <fieldset key={g.id} className="mb-4"><legend className="mb-2 text-xs font-semibold text-stone-600">{g.name}</legend><div className="flex flex-wrap gap-2">{data.modifierOptions.filter(o => o.groupId === g.id).map(o => <label key={o.id} className="flex items-center gap-1 rounded-lg bg-stone-50 px-2 py-1.5 text-xs"><input type={g.maxSelection === 1 ? "radio" : "checkbox"} name={g.id} checked={(selectedMods[g.id] || []).includes(o.id)} onChange={e => setSelectedMods(current => ({...current, [g.id]: g.maxSelection === 1 ? [o.id] : e.target.checked ? [...(current[g.id] || []), o.id] : (current[g.id] || []).filter(id => id !== o.id)}))}/>{o.name}{o.additionalPrice > 0 && ` +${o.additionalPrice}`}</label>)}</div></fieldset>)}<button disabled={(orderMode === "dine_in" && !session) || item.isSoldOut || busy} onClick={() => add(item)} className={`${button} mt-auto bg-primary text-white`}><Plus size={16}/>{item.isSoldOut ? "今日售完" : "加入點餐單"}</button></article>)}</div></section>
        <aside className="dining-order h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">{orderMode === "takeout" ? "外帶預付" : table?.tableNumber || "請選桌位"} · 本次點餐</h2>{orderMode === "dine_in" && !session && <p className="text-sm text-orange-700">先選擇使用中的桌位，或開桌後開始點餐。</p>}{!cart.length && <p className="py-6 text-center text-sm text-stone-400">尚未加入餐點</p>}{cart.map(line => <div key={line.key} className="border-b border-stone-100 pb-4"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium">{line.name}</p><p className="mt-1 text-xs text-stone-400">{line.description}</p></div><span className="text-sm">{money(line.unitPrice * line.quantity)}</span></div><div className="mt-3 flex items-center gap-3"><button aria-label={`減少${line.name}`} disabled={busy} onClick={() => setCart(current => current.flatMap(i => i.key !== line.key ? [i] : i.quantity > 1 ? [{...i, quantity: i.quantity - 1}] : []))} className="rounded-lg border p-1.5"><Minus size={14}/></button><span className="text-sm">{line.quantity}</span><button aria-label={`增加${line.name}`} disabled={busy || line.quantity >= 100} onClick={() => setCart(current => current.map(i => i.key === line.key ? {...i, quantity: i.quantity + 1} : i))} className="rounded-lg border p-1.5"><Plus size={14}/></button></div></div>)}<div className="flex justify-between text-sm"><span>餐點小計</span><span>{money(cartTotal)}</span></div><div className="flex justify-between text-xs text-stone-500"><span>服務費 {orderMode === "takeout" ? 0 : rate}%（結帳時計算）</span><span>{money(orderMode === "takeout" ? 0 : Math.round(cartTotal * rate / 100))}</span></div>{orderMode === "takeout" && <label className="block text-sm">外帶付款<select className={`${field} mt-2`} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">現金（展示記帳）</option><option value="mock_card">模擬刷卡（不實際扣款）</option></select></label>}<button disabled={busy || (orderMode === "dine_in" && !session) || !cart.length} onClick={() => void mutate(orderMode === "takeout" ? "takeout" : "order", {sessionToken: session?.sessionToken, paymentMethod: method, items: cart.map(({menuItemId, quantity, modifiers}) => ({menuItemId, quantity, modifiers})), idempotencyKey: orderKey.current}, orderMode === "takeout" ? "外帶收款完成，取餐號請見下方外帶紀錄" : "餐點已送至廚房", () => setCart([]))} className={`${button} w-full bg-primary text-white`}>{busy ? "處理中…" : orderMode === "takeout" ? `確認收款 ${money(cartTotal)} 並送單` : "確認送單"}</button></aside></div>
        {orderMode === "takeout" && <TakeoutHistory orders={data.orders.filter(o => o.orderType === "takeout")} bills={data.bills} busy={busy} onRefund={(orderId, reason) => void mutate("takeout/refund", {orderId, reason}, "外帶訂單已全額退款（展示記帳），並取消廚房出餐")} />}
      </>}
      {tab === "kitchen" && <section className="space-y-5"><div className="flex flex-wrap items-center gap-3"><label htmlFor="station" className="text-sm font-medium">出餐站</label><select id="station" value={station} onChange={e => setStation(e.target.value)} className={`${field} max-w-56`}>{["全部", ...new Set(data.kdsTickets.map(t => t.station))].map(s => <option key={s}>{s}</option>)}</select><p className="text-xs text-stone-500">接單 → 製作中 → 完成 → 送餐；更新後會同步帳單明細。</p></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.kdsTickets.filter(t => t.status !== "served" && (station === "全部" || t.station === station)).map(ticket => {const order = data.orders.find(o => o.id === ticket.orderId); const sess = data.sessions.find(s => s.id === order?.sessionId); const tableName = order?.orderType === "takeout" ? `外帶 ${order.takeoutNumber}` : data.tables.find(t => t.id === sess?.tableId)?.tableNumber; return <article key={ticket.id} className="rounded-xl border border-stone-200 bg-white p-5"><div className="flex items-center justify-between"><span className="break-all font-bold">{order?.orderType === "takeout" ? tableName : `桌 ${tableName || "—"}`}</span><span className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-800">{statuses[ticket.status]}</span></div>{ticket.urgentFlag && <p role="status" className="mt-3 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">服務人員催單 · 請優先處理</p>}<h2 className="mt-4 font-semibold">{ticket.itemName} × {ticket.quantity}</h2><p className="mt-2 min-h-5 text-xs text-stone-500">{ticket.modifiersText || "無加料"}</p><p className="my-4 text-xs text-stone-400">{ticket.station}</p><button disabled={busy || ticket.urgentFlag} onClick={() => void mutate("kds/urge", {ticketId: ticket.id}, "催單通知已送至廚房")} className={`${button} mb-3 w-full border border-orange-200 text-orange-800`}>{ticket.urgentFlag ? "已通知優先處理" : "催單通知"}</button><button disabled={busy || !next[ticket.status]} onClick={() => void mutate("kds/status", {ticketId: ticket.id, newStatus: next[ticket.status]}, "出餐狀態已更新")} className={`${button} w-full bg-primary text-white`}>{ticket.status === "received" ? "開始製作" : ticket.status === "cooking" ? "標記完成" : "確認送餐"}</button></article>;})}</div>{!data.kdsTickets.some(t => t.status !== "served" && (station === "全部" || t.station === station)) && <p className="rounded-xl border border-dashed p-10 text-center text-stone-500">目前沒有待出餐項目</p>}</section>}
      {tab === "billing" && <section className="grid gap-6 lg:grid-cols-[1fr_340px]"><div className="space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">{table?.tableNumber} 桌 · 消費明細</h2>{!session ? <p className="py-8 text-sm text-stone-500">此桌目前沒有使用中帳單。</p> : !items.length ? <p className="py-8 text-sm text-stone-500">尚未點餐</p> : items.map(i => <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 py-3"><div><p className={`text-sm font-medium ${i.status === "cancelled" ? "line-through text-stone-400" : ""}`}>{i.itemName} × {i.quantity}</p><p className="mt-1 text-xs text-stone-500">{statuses[i.status] || i.status}</p></div><div className="flex items-center gap-3"><span className="text-sm">{money(i.status === "cancelled" ? 0 : i.lineTotal)}</span>{i.status !== "cancelled" && <button disabled={busy || !reason.trim()} onClick={() => void mutate("cancel", {orderItemId: i.id, reason}, "已退菜，帳單金額已重新計算")} aria-label={`退菜${i.itemName}`} className="rounded-lg p-2 text-red-700 disabled:opacity-30"><Trash2 size={16}/></button>}</div></div>)}<label className="block text-xs text-stone-600">退菜原因（填寫後可按餐點右側退菜；製作中需主管權限）<input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className={`${field} mt-2`} placeholder="例如：顧客更換餐點"/></label></div><aside className="h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">分帳結帳</h2><div className="flex justify-between text-sm"><span>有效餐點</span><span>{money(subtotal)}</span></div><div className="flex justify-between text-sm"><span>服務費 {rate}%</span><span>{money(fee)}</span></div><div className="flex justify-between border-t pt-4 text-xl font-bold"><span>應收</span><span>{money(total)}</span></div><label className="block text-sm">均分人數<select className={`${field} mt-2`} value={splitCount} onChange={e => setSplitCount(Number(e.target.value))}>{[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} 人</option>)}</select></label><label className="block text-sm">付款方式<select className={`${field} mt-2`} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">現金（展示記帳）</option><option value="mock_card">模擬刷卡（不實際扣款）</option></select></label>{splits.map(s => <div key={s.splitIndex} className="flex justify-between text-xs text-stone-500"><span>第 {s.splitIndex} 人</span><span>{money(s.amount)}</span></div>)}<button disabled={busy || !session || total <= 0 || splits.some(s => s.amount <= 0)} onClick={() => void mutate("bill/pay", {sessionId: session?.id, splits}, "結帳完成，桌位已釋出")} className={`${button} w-full bg-primary text-white`}>{busy ? "處理中…" : "確認收款並結帳"}</button><p className="text-xs leading-relaxed text-stone-400">結帳將一次完成全部分單並關閉桌次；原點餐憑證隨即失效。</p></aside></section>}
      {tab === "reservations" && <section className="grid gap-6 lg:grid-cols-[340px_1fr]"><form onSubmit={e => void reserve(e)} className="h-fit space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-bold">新增訂位</h2><p className="text-xs leading-relaxed text-stone-500">每筆訂位保留90分鐘，同桌重疊時段不可預約。</p><label className="block text-sm">桌位<select className={`${field} mt-2`} value={reservationTable} onChange={e => setReservationTable(e.target.value)}>{data.tables.map(t => <option key={t.id} value={t.id}>{t.tableNumber} · {t.capacity} 人座</option>)}</select></label><label className="block text-sm">顧客姓名<input className={`${field} mt-2`} required maxLength={100} value={reservationName} onChange={e => setReservationName(e.target.value)}/></label><label className="block text-sm">聯絡電話<input className={`${field} mt-2`} type="tel" required minLength={3} maxLength={30} value={reservationPhone} onChange={e => setReservationPhone(e.target.value)}/></label><label className="block text-sm">人數<input className={`${field} mt-2`} type="number" min={1} max={data.tables.find(t => t.id === reservationTable)?.capacity || 100} required value={reservationGuests} onChange={e => setReservationGuests(Number(e.target.value))}/></label><label className="block text-sm">用餐時間（台北）<input className={`${field} mt-2`} type="datetime-local" required value={reservationTime} onChange={e => setReservationTime(e.target.value)}/></label><button disabled={busy} className={`${button} w-full bg-primary text-white`}>建立預約</button></form><div className="space-y-3">{!data.reservations.length && <p className="rounded-xl border border-dashed p-8 text-center text-stone-500">尚無預約</p>}{data.reservations.map(r => <article key={r.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5"><div><h2 className="font-semibold">{r.customerName} · {r.guestCount} 位</h2><p className="mt-2 text-sm text-stone-500">{new Date(r.reservationTime.includes("T") ? r.reservationTime : `${r.reservationTime.replace(" ", "T")}:00+08:00`).toLocaleString("zh-TW", {timeZone: "Asia/Taipei"})}</p></div><span className="rounded-lg bg-stone-100 px-3 py-2 text-sm">{data.tables.find(t => t.id === r.tableId)?.tableNumber} 桌 · {r.status === "confirmed" ? "已確認" : r.status}</span></article>)}</div></section>}
    </>}
    {!data && <div className="rounded-xl border border-dashed p-12 text-center text-stone-500">{loading ? "正在載入餐廳營運資料…" : "目前無法載入資料，請按重新整理。"}</div>}
  </main>;
}
