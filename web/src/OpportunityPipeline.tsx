import React,{useRef,useState} from 'react';
import {tr} from './locale';
type Row=Record<string,any>;
export function OpportunityPipeline({data,onReload}:{data:Record<string,Row[]>;onReload:()=>Promise<void>}){
 const [opportunity,setOpportunity]=useState(''),[stage,setStage]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const retry=useRef({signature:'',key:''});
 const selected=(data.opportunities||[]).find(row=>row.id===opportunity);
 const target=(data.stages||[]).find(row=>row.id===stage);
 const closing=!!(target?.isWon||target?.isLost);
 const valid=!!selected&&!!target&&selected.stageId!==stage&&(!closing||!!reason.trim());
 async function submit(){
  if(busy||!valid)return;
  const payload={opportunityId:opportunity,expectedStageId:selected!.stageId,stageId:stage,reason:reason.trim()};
  const signature=JSON.stringify(payload);
  if(retry.current.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
  setBusy(true);setError('');setMessage('');
  try{
   const response=await fetch('/api/stations/crm/opportunity-stage',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:retry.current.key})});
   const body=await response.json() as {success:boolean;error?:{message?:string}};
   if(!response.ok||!body.success)throw new Error(body.error?.message||`HTTP ${response.status}`);
   retry.current={signature:'',key:''};setStage('');setReason('');setMessage(tr('Opportunity stage updated'));
   try{await onReload()}catch{setError(tr('Saved, but the display could not be refreshed. Reload before submitting another operation.'))}
  }catch(failure){setError((failure as Error).message)}finally{setBusy(false)}
 }
 return <section className="panel" role="region" aria-label={tr('Opportunity pipeline')}>
  <h2>{tr('Opportunity pipeline')}</h2><p>{tr('Stage changes use the current saved stage to prevent overwriting another operator.')}</p>
  <form className="form-grid" onSubmit={event=>{event.preventDefault();void submit()}}>
   <label>{tr('Opportunity')}<select aria-label={tr('Opportunity')} required disabled={busy} value={opportunity} onChange={event=>{setOpportunity(event.target.value);setStage('');setReason('')}}><option value="">{tr('Select an item')}</option>{(data.opportunities||[]).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   {selected&&<p>{tr('Current stage')}: {(data.stages||[]).find(row=>row.id===selected.stageId)?.name||selected.stageId} · {tr(selected.status)} · {tr('Weighted amount')}: {selected.weightedAmount}</p>}
   <label>{tr('Target stage')}<select aria-label={tr('Target stage')} required disabled={busy||!selected} value={stage} onChange={event=>setStage(event.target.value)}><option value="">{tr('Select an item')}</option>{(data.stages||[]).filter(row=>row.id!==selected?.stageId).map(row=><option key={row.id} value={row.id}>{row.name} · {row.probability}%</option>)}</select></label>
   <label>{tr('Transition reason')}<textarea maxLength={500} required={closing} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}/></label>
   <button disabled={busy||!valid}>{tr('Update stage')}</button>
  </form>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
