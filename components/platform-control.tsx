"use client";
import { useState } from "react";
import registry from "@/infra/sites.json";
import { LockKeyhole, ShieldCheck, Terminal } from "lucide-react";
import s from "./platform-dashboard.module.css";

type Service = { service: string; state: string; health: string };
type Plan = { plan_id: string; site: string; service: string; action: string; steps: {service:string;action:string}[]; affected_sites: string[]; expires_at: number };
const actions: Record<string,string> = {start:"啟動",stop:"停止",restart:"重新啟動"};
const states: Record<string,string> = {running:"運行中",exited:"已停止",created:"待啟動",restarting:"重新啟動中",missing:"尚未部署"};
const names = Object.fromEntries(registry.sites.map(site=>[site.id,site.name]));

export function PlatformControl() {
  const [token,setToken] = useState("");
  const [connected,setConnected] = useState(false);
  const [rows,setRows] = useState<Service[]>([]);
  const [site,setSite] = useState("mes");
  const [service,setService] = useState("collector");
  const [action,setAction] = useState("restart");
  const [plan,setPlan] = useState<Plan|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("使用獨立操作憑證連線；展示角色不能操作主機。");
  const [error,setError] = useState(false);
  const declared = registry.sites.find(item=>item.id===site)!;
  const services = [...new Set([...declared.services,"web"])];

  async function request<T>(operation: string, body?: object): Promise<T> {
    const response = await fetch(`/api/platform/control/${operation}`, {method:body ? "POST" : "GET",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:body ? JSON.stringify(body) : undefined});
    const value = await response.json() as {error?:string} & T;
    if (!response.ok) {
      if (response.status===401) setConnected(false);
      throw new Error(response.status===401 ? "操作憑證無效，請重新連線。" : response.status===410 ? "計畫已過期或已執行，請重新規劃。" : response.status===409 ? "服務狀態已改變，請更新狀態並重新規劃。" : "控制服務暫時無法完成操作，請更新狀態後查核。");
    }
    return value;
  }
  async function perform(task:()=>Promise<void>) {
    setBusy(true); setError(false);
    try { await task(); } catch (e) {setError(true);setMessage(e instanceof Error ? e.message : "連線中斷，請更新服務狀態。");}
    finally {setBusy(false);}
  }
  function refresh() {return perform(async()=>{const value=await request<{services:Service[]}>("status");setRows(value.services);setConnected(true);setPlan(null);setMessage(`已更新 ${value.services.length} 個受管服務。`);});}
  function createPlan() {return perform(async()=>{const value=await request<Plan>("plan",{site,service,action});setPlan(value);setMessage("計畫已建立，請核對操作及影響範圍。尚未改變服務狀態。");});}
  function apply() {
    if (!plan) return;
    const current=plan; setPlan(null);
    return perform(async()=>{const value=await request<{services:Service[]}>("apply",{plan_id:current.plan_id});setRows(value.services);setMessage(`${actions[current.action]}作業完成，已更新服務狀態。`);});
  }
  return <section className={s.control} aria-labelledby="platform-control-heading" aria-busy={busy}>
    <div className={s.controlBar}><Terminal size={15}/><h3 id="platform-control-heading">服務控制台</h3><span className={`${s.connection} ${connected?s.connected:""}`}>{connected?"憑證已驗證":"未連線"}</span></div>
    <div className={s.connectGrid}>
      <aside className={s.accessPanel}><p className={s.accessCaption}>PLAN BEFORE YOU APPLY.</p><h4>先看清影響，<br/>再執行變更。</h4><ol className={s.accessSteps}><li><span>01</span>讀取服務狀態</li><li><span>02</span>檢視影響範圍</li><li><span>03</span>執行單次計畫</li></ol></aside>
      <div className={s.authPanel}>
        {!connected&&<><span className={s.lockIcon}><LockKeyhole size={18} strokeWidth={1.5}/></span><h4>連線至基礎設施。</h4><p>使用環境管理員提供的操作憑證，取得即時狀態與控制權限。</p></>}
        {connected&&<><h4>操作連線已建立。</h4><p>更新狀態後，選擇分站、服務與操作以建立計畫。</p></>}
        <form onSubmit={event=>{event.preventDefault();void refresh();}} className={s.authForm}>
          <label className={`${s.field} ${s.tokenField}`}><span>操作憑證</span><input type="password" autoComplete="off" value={token} onChange={event=>{setToken(event.target.value);setConnected(false);setRows([]);setPlan(null);setError(false);setMessage("使用獨立操作憑證連線；展示角色不能操作主機。");}} className={s.input} placeholder="輸入平台操作憑證" required disabled={busy}/></label>
          <button disabled={busy||!token} className={s.primary}>{busy?"處理中…":connected?"更新狀態":"連線"}</button>
          {connected&&<button type="button" disabled={busy} onClick={()=>{setToken("");setConnected(false);setRows([]);setPlan(null);setMessage("已斷開操作連線。");}} className={s.secondary}>斷開連線</button>}
        </form>
        <div className={s.authNote}><ShieldCheck size={12}/>憑證僅用於本次連線，不儲存在瀏覽器。</div>
        <p className={`${s.message} ${error?s.error:""}`} role={error?"alert":"status"}>{message}</p>
      </div>
    </div>
    {connected&&<div className={s.operationBody}>
      <div className={s.tableWrap}><table className={s.table}><thead><tr><th scope="col">SERVICE</th><th scope="col">目前狀態</th><th scope="col">健康檢查</th></tr></thead><tbody>{rows.map(row=><tr key={row.service}><td>{row.service}</td><td>{states[row.state]??row.state}</td><td>{row.health==="healthy"?"正常":row.health==="unhealthy"?"異常":row.health==="starting"?"檢查中":"未設定"}</td></tr>)}</tbody></table>{!rows.length&&<p className={s.message}>目前沒有受管服務。</p>}</div>
      <form onSubmit={event=>{event.preventDefault();void createPlan();}} className={s.operationForm}>
        <label className={s.field}><span>分站</span><select className={s.input} disabled={busy} value={site} onChange={event=>{const next=registry.sites.find(item=>item.id===event.target.value)!;setSite(next.id);setService(next.services[0]??"web");setPlan(null);}}>{registry.sites.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className={s.field}><span>服務</span><select className={s.input} disabled={busy} value={service} onChange={event=>{setService(event.target.value);setPlan(null);}}>{services.map(name=><option key={name} value={name}>{name}{name==="web"?"（六站共用）":""}</option>)}</select></label>
        <label className={s.field}><span>操作</span><select className={s.input} disabled={busy} value={action} onChange={event=>{setAction(event.target.value);setPlan(null);}}>{Object.entries(actions).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <button disabled={busy} className={s.secondary}>建立操作計畫</button>
      </form>
      {plan&&<div className={s.plan}><h3>待執行計畫：{actions[plan.action]} {plan.service}</h3><p>影響分站：{plan.affected_sites.map(id=>names[id]??id).join("、")||"無狀態變更"}。有效至 {new Date(plan.expires_at*1000).toLocaleTimeString("zh-TW",{timeZone:"Asia/Taipei"})}（台北）。</p>{plan.service==="web"&&plan.action==="stop"&&<p className={s.warning}>停止主站入口 Web 後，所有網站入口也會離線；需透過 SSH 與 CLI 重新啟動。</p>}<ul>{plan.steps.map(step=><li key={step.service}>{actions[step.action]} {step.service}</li>)}</ul>{!plan.steps.length&&<p>服務已符合目標狀態，無需變更。</p>}<button type="button" disabled={busy} onClick={()=>void apply()} className={s.primary}>執行此計畫</button></div>}
    </div>}
  </section>;
}
