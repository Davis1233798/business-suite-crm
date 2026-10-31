import React, {useState} from "react";

type Outcome = {ok: boolean; status: string; ms: number};
const total = 48, workers = 8;
export function TrafficLab({site}:{site:string}) {
  const [running,setRunning] = useState(false);
  const [completed,setCompleted] = useState(0);
  const [results,setResults] = useState<Outcome[]>([]);
  async function run() {
    setRunning(true); setCompleted(0); setResults([]);
    let next=0; const outcomes:Outcome[]=[];
    const started=performance.now();
    await Promise.all(Array.from({length:workers},async()=>{
      while(true) {
        const index=next++; if(index>=total) break;
        const start=performance.now();
        try {
          const response=await fetch(`/api/stations/${site}/data?view=back`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});
          const body=await response.json() as {success?:boolean};
          outcomes.push({ok:response.ok && body.success===true,status:String(response.status),ms:performance.now()-start});
        } catch { outcomes.push({ok:false,status:'network/timeout',ms:performance.now()-start}); }
        setCompleted(outcomes.length);
      }
    }));
    setResults([...outcomes, {ok:true,status:'duration',ms:performance.now()-started}]); setRunning(false);
  }
  const samples=results.filter(r=>r.status!=='duration');
  const duration=results.find(r=>r.status==='duration')?.ms || 0;
  const timings=samples.map(r=>r.ms).sort((a,b)=>a-b);
  const p95=timings.length ? Math.round(timings[Math.ceil(timings.length*.95)-1]) : 0;
  const statuses=samples.reduce<Record<string,number>>((m,r)=>(m[r.status]=(m[r.status]||0)+1,m),{});
  return <section className="traffic-lab" aria-label="Concurrency lab"><div><p className="eyebrow">LIVE CONCURRENCY LAB / READ-ONLY</p><h2>{site==='mes'?'Manufacturing under concurrent reads':'Commerce under concurrent reads'}</h2><p>Run {total} real requests against this signed-in workspace, with up to {workers} in flight. Requests use your current permissions and do not create orders or production reports.</p><button type="button" disabled={running} onClick={run}>{running?`Running ${completed}/${total}…`:'Run bounded read test'}</button></div><div className="traffic-results" aria-live="polite">{samples.length>0?<><div><small>Completed</small><strong>{samples.length}/{total}</strong></div><div><small>Successful</small><strong>{samples.filter(r=>r.ok).length}</strong></div><div><small>p95 latency</small><strong>{p95} ms</strong></div><div><small>Observed rate</small><strong>{duration? (samples.length*1000/duration).toFixed(1):'—'} req/s</strong></div><p>HTTP outcomes: {Object.entries(statuses).map(([status,n])=>`${status}: ${n}`).join(' · ')}</p></>:<p>No run yet. Results are measured in your browser against the current service.</p>}</div><p className="traffic-boundary">This is a small read-only diagnostic, not a high-traffic capacity benchmark. The Go migration preview currently reads SQLite and does not implement order or production transaction writes, queue-depth telemetry, or autoscaling. For write-race verification, use the repository's isolated integration tests and commerce load script.</p></section>;
}
