"use client";

import { WorkspaceHeader, WorkspaceLinks, WorkspaceLoading } from "@/components/workspace-header";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ErpAdvanced } from "./advanced";
import { ErpOperations } from "@/components/domain-operations";
import {
  Database,
  ArrowLeft,
  RotateCcw,
  Boxes,
  ArrowRightLeft,
  FileCheck2,
  DollarSign,
  Scale,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

export default function ErpPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Transfer form state
  const [transferItem, setTransferItem] = useState<string>("");
  const [fromWh, setFromWh] = useState<string>("");
  const [toWh, setToWh] = useState<string>("");
  const [transferQty, setTransferQty] = useState<number>(3);
  const [transferring, setTransferring] = useState(false);

  // Invoice payment state
  const [payAmount, setPayAmount] = useState<number>(600);
  const [paying, setPaying] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/erp/data");
      const json: any = await res.json();
      if (json.success) {
        setData(json.data);
        if (json.data.items.length > 0 && !transferItem) {
          setTransferItem(json.data.items[0].id);
        }
        if (json.data.warehouses.length >= 2) {
          setFromWh(json.data.warehouses[0].id);
          setToWh(json.data.warehouses[1].id);
        }
      } else {
        setError(json.error?.message || "Unable to load ERP data");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferItem || !fromWh || !toWh) return;
    setTransferring(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/erp/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: transferItem,
          fromWarehouseId: fromWh,
          toWarehouseId: toWh,
          quantity: transferQty,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        setSuccess(`Transfer complete. Source balance: : ${json.data.sourceBalanceAfter}, destination balance: : ${json.data.destBalanceAfter}, total stock preserved`);
        fetchData();
      } else {
        setError(json.error?.message || "Transfer failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTransferring(false);
    }
  };

  const handlePayInvoice = async (invoiceId: string) => {
    setPaying(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/erp/invoice/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          amount: payAmount,
        }),
      });

      const json: any = await res.json();
      if (json.success) {
        setSuccess(`Payment recorded. Total received: : $${json.data.paidAmount}, outstanding: : $${json.data.unpaidAmount}, status: : ${json.data.status}`);
        fetchData();
      } else {
        setError(json.error?.message || "Payment failed");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  };

  if (loading && !data) return <WorkspaceLoading name="LedgerWorks" error={error} onRetry={fetchData}/>;

  const tb = data?.trialBalance;

  return (
    <main data-site="erp" className="suite-page suite-erp space-y-7">
      <WorkspaceHeader brand="LedgerWorks" eyebrow="ERP / Operations workspace" title="Every transaction, clearly connected." description="Connect inventory, purchasing, sales and accounting in one workspace." onRefresh={fetchData} busy={loading}/>
      <WorkspaceLinks links={[{href:"#finance",label:"Accounting overview"},{href:"#inventory",label:"Inventory and transfers"},{href:"#erp-operations",label:"Purchasing and sales"},{href:"#erp-advanced",label:"Advanced accounting"}]}/>
      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div role="status" className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Trial Balance & Costing Overview (E07, E08) */}
      <section id="finance" className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-emerald-600" />
            <h2 className="text-sm font-bold text-stone-900">Trial balance check</h2>
          </div>
          <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            {tb?.isBalanced ? "✓ Debits and credits balanced (Balanced)" : "Debits and credits unbalanced"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div className="text-stone-500 font-medium">Total debits (Grand Debit)</div>
            <div className="text-xl font-bold font-mono text-stone-900 mt-1">${tb?.grandDebit?.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div className="text-stone-500 font-medium">Total credits (Grand Credit)</div>
            <div className="text-xl font-bold font-mono text-stone-900 mt-1">${tb?.grandCredit?.toLocaleString()}</div>
          </div>
          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
            <div className="text-stone-500 font-medium">Moving average cost (Moving Average)</div>
            <div className="text-xl font-bold font-mono text-emerald-700 mt-1">${data?.costing?.[0]?.movingAverageCost?.toLocaleString() ?? "—"} / units</div>
            <div className="text-[10px] text-stone-400">{data?.items?.find((item: any) => item.id === data?.costing?.[0]?.itemId)?.name || "No cost data"} · Book cost</div>
          </div>
        </div>
      </section>

      {/* Main Grid: Stock Ledger & Transfer */}
      <div id="inventory" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Stock Ledger & Invoices */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-stone-700" />
                <span>Stock ledger (Stock Ledger)</span>
              </h3>
              <span className="text-xs text-stone-500">Latest posted transactions</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 bg-stone-50/50">
                    <th className="p-2.5 font-medium">Reference</th>
                    <th className="p-2.5 font-medium">Warehouse</th>
                    <th className="p-2.5 font-medium">Movement type</th>
                    <th className="p-2.5 font-medium">Quantity change</th>
                    <th className="p-2.5 font-medium">Closing balance</th>
                    <th className="p-2.5 font-medium">Unit cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 font-mono">
                  {data?.stockLedger.slice(0, 8).map((stk: any) => (
                    <tr key={stk.id} className="hover:bg-stone-50/80">
                      <td className="p-2.5 font-medium text-stone-900">{stk.referenceDoc}</td>
                      <td className="p-2.5">{data?.warehouses.find((warehouse: any) => warehouse.id === stk.warehouseId)?.name || stk.warehouseId}</td>
                      <td className="p-2.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 font-sans">
                          {stk.changeType}
                        </span>
                      </td>
                      <td className={`p-2.5 font-bold ${stk.quantityChange > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                        {stk.quantityChange > 0 ? `+${stk.quantityChange}` : stk.quantityChange}
                      </td>
                      <td className="p-2.5 font-bold text-stone-900">{stk.balanceAfter}</td>
                      <td className="p-2.5 text-stone-600">${stk.unitCost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Invoices & Settlement */}
          <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>Settle receivables and payables</span>
            </h3>

            <div className="space-y-3 text-xs">
              {data?.invoices.map((inv: any) => {
                const unpaid = inv.totalAmount - inv.paidAmount;
                return (
                  <div key={inv.id} className="p-4 rounded-xl border border-stone-200 bg-stone-50 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-mono font-bold text-stone-900">{inv.invoiceNumber}</div>
                      <div className="text-stone-500">
                        Total: ${inv.totalAmount} | Paid: ${inv.paidAmount} | Outstanding: ${unpaid}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {unpaid > 0 ? (
                        <>
                          <input
                            type="number"
                            min="1"
                            max={unpaid}
                            value={payAmount}
                            onChange={(e) => setPayAmount(parseInt(e.target.value) || 0)}
                            className="w-24 p-1.5 rounded border border-stone-300 text-xs font-mono"
                          />
                          <button
                            onClick={() => handlePayInvoice(inv.id)}
                            disabled={paying}
                            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-[#0040b0] text-white font-medium text-xs shadow-sm transition"
                          >
                            {paying ? "Processing payment..." : "Collect balance"}
                          </button>
                        </>
                      ) : (
                        <span className="text-emerald-700 font-semibold px-2 py-1 bg-emerald-100 rounded">
                          ✓ Fully settled (Paid)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Col: Inter-warehouse Transfer */}
        <div className="space-y-6">
          <section className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
              <span>Warehouse transfer (stock conserved)</span>
            </h3>
            <p className="text-xs text-stone-500">An atomic transfer deducts from the source and adds to the destination, preserving total stock.</p>

            <form onSubmit={handleTransfer} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-stone-700 mb-1">Transfer item</label>
                <select aria-label="Transfer item"
                  value={transferItem}
                  onChange={(e) => setTransferItem(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-xs"
                >
                  {data?.items.map((it: any) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700 mb-1">Source warehouse</label>
                  <select aria-label="Source warehouse"
                    value={fromWh}
                    onChange={(e) => setFromWh(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-xs"
                  >
                    {data?.warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-stone-700 mb-1">Destination warehouse</label>
                  <select aria-label="Destination warehouse"
                    value={toWh}
                    onChange={(e) => setToWh(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 p-2 text-xs"
                  >
                    {data?.warehouses.map((w: any) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700 mb-1">Transfer quantity (units)</label>
                <input aria-label="Transfer quantity (units)"
                  type="number"
                  min="1"
                  value={transferQty}
                  onChange={(e) => setTransferQty(parseInt(e.target.value) || 1)}
                  className="w-full rounded-lg border border-stone-300 p-2 text-xs font-mono"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={transferring}
                className="w-full py-2.5 rounded-lg bg-primary hover:bg-[#0040b0] text-white font-medium text-xs transition shadow-sm"
              >
                {transferring ? "Transferring..." : "Confirm stock transfer"}
              </button>
            </form>
          </section>

          {/* Box Conversion Ratio Card */}
          <section className="bg-stone-50 rounded-xl border border-stone-200 p-5 space-y-2 text-xs">
            <h4 className="font-bold text-stone-900">Units and pack conversion</h4>
            <p className="text-stone-600">
              Pack conversion converts two packs of ten sensor modules into twenty inventory units.
            </p>
          </section>
        </div>
      </div>
      {data && <div id="erp-operations"><ErpOperations data={data} onSaved={fetchData}/></div>}
      {data && <div id="erp-advanced"><ErpAdvanced data={data} onSaved={fetchData}/></div>}
    </main>
  );
}
