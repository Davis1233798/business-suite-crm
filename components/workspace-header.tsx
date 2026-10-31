import { ArrowUpRight, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

export function WorkspaceHeader({ brand, eyebrow, title, description, onRefresh, busy, children }: {
  brand: string; eyebrow: string; title: string; description: string;
  onRefresh?: () => void; busy?: boolean; children?: ReactNode;
}) {
  return <header className="workspace-header">
    <div className="workspace-heading"><p className="workspace-eyebrow">{brand} <span>/</span> {eyebrow}</p><h1>{title}</h1><p className="workspace-description">{description}</p></div>
    <div className="workspace-actions">{children}{onRefresh && <button type="button" onClick={onRefresh} disabled={busy} className="workspace-secondary"><RotateCcw size={15} className={busy ? "animate-spin" : undefined}/>{busy ? "Refreshing…" : "Refresh data"}</button>}</div>
  </header>;
}

export function WorkspaceLinks({ links }: { links: { href: string; label: string }[] }) {
  return <nav className="workspace-links" aria-label="Page workspace">{links.map(link => <a key={link.href} href={link.href}>{link.label}<ArrowUpRight size={13}/></a>)}</nav>;
}

export function WorkspaceLoading({ name, error, onRetry }: { name: string; error?: string | null; onRetry: () => void }) {
  return <main className="suite-page"><WorkspaceHeader brand={name} eyebrow="WORKSPACE" title={error ? "Workspace temporarily unavailable" : "Preparing your workspace"} description={error || "Loading this demo workspace. Please wait."}/><section className="workspace-loading" aria-busy={!error}>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={onRetry} className="workspace-secondary">Reload</button></div> : <><p role="status">Loading {name}…</p><div className="loading-grid" aria-hidden="true">{[1,2,3].map(n=><div key={n} className="loading-block"/>)}</div></>}
  </section></main>;
}
