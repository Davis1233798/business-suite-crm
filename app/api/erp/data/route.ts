import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getDb } from "@/db/index";
import { eq, sql } from "drizzle-orm";
import {
  erpItems,
  erpReceipts,
  erpReceiptLines,
  erpFiscalPeriods,
  erpJournalEntries,
  erpJournalLines,
  erpWarehouses,
  erpPurchaseOrders,
  erpSalesOrders,
  erpStockLedger,
  erpItemCosting,
  erpInvoices,
  erpSuppliers,
  erpCustomers,
  erpPurchaseOrderLines,
  erpSalesOrderLines,
} from "@/db/schema";
import { ErpService } from "@/lib/services/erp-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const db = getDb();
    const orgId = context.organizationId;

    const [items, warehouses, purchaseOrders, salesOrders, stockLedger, costing, invoices, trialBalance, suppliers, customers, purchaseLines, salesLines, receipts, receiptLines, fiscalPeriods, journalEntries, journalLines] =
      await Promise.all([
        db.select().from(erpItems).where(eq(erpItems.organizationId, orgId)),
        db.select().from(erpWarehouses).where(eq(erpWarehouses.organizationId, orgId)),
        db.select().from(erpPurchaseOrders).where(eq(erpPurchaseOrders.organizationId, orgId)),
        db.select().from(erpSalesOrders).where(eq(erpSalesOrders.organizationId, orgId)),
        db.select().from(erpStockLedger).where(eq(erpStockLedger.organizationId, orgId)).orderBy(sql`rowid DESC`),
        db.select().from(erpItemCosting).where(eq(erpItemCosting.organizationId, orgId)),
        db.select().from(erpInvoices).where(eq(erpInvoices.organizationId, orgId)),
        ErpService.getTrialBalance(context),
        db.select().from(erpSuppliers).where(eq(erpSuppliers.organizationId, orgId)),
        db.select().from(erpCustomers).where(eq(erpCustomers.organizationId, orgId)),
        db.select().from(erpPurchaseOrderLines).where(eq(erpPurchaseOrderLines.organizationId, orgId)),
        db.select().from(erpSalesOrderLines).where(eq(erpSalesOrderLines.organizationId, orgId)),
        db.select().from(erpReceipts).where(eq(erpReceipts.organizationId, orgId)),
        db.select().from(erpReceiptLines).where(eq(erpReceiptLines.organizationId, orgId)),
        db.select().from(erpFiscalPeriods).where(eq(erpFiscalPeriods.organizationId, orgId)),
        db.select().from(erpJournalEntries).where(eq(erpJournalEntries.organizationId, orgId)),
        db.select().from(erpJournalLines).where(eq(erpJournalLines.organizationId, orgId)),
      ]);

    return successResponse({
      items,
      warehouses,
      purchaseOrders,
      salesOrders,
      stockLedger,
      costing,
      invoices,
      trialBalance,
      suppliers,
      customers,
      purchaseLines,
      salesLines,
      receipts, receiptLines, fiscalPeriods, journalEntries, journalLines,
    }, context.requestId);
  } catch (err: any) {
    return errorResponse("FETCH_ERP_FAILED", err.message, 500);
  }
}
