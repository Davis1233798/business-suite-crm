import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDb } from "../db/index";
import { erpStockLedger, posSales, shopOrders } from "../db/schema";
import { createSqliteD1 } from "./db/sqlite-d1";

export interface BackupData {
  timestamp: string;
  sourceOrgId: string;
  tables: Record<string, any[]>;
  summary: {
    stockRecordCount: number;
    posSaleTotalAmount: number;
    shopOrderTotalAmount: number;
  };
}

/**
 * C05: Export database tables for an organization into a structured backup JSON
 */
export async function exportTenantBackup(organizationId: string): Promise<BackupData> {
  const db = getDb();

  const stockRecords = await db.select().from(erpStockLedger);
  const orgStock = stockRecords.filter((r: any) => r.organizationId === organizationId);

  const posRecords = await db.select().from(posSales);
  const orgPos = posRecords.filter((r: any) => r.organizationId === organizationId);

  const shopRecords = await db.select().from(shopOrders);
  const orgShop = shopRecords.filter((r: any) => r.organizationId === organizationId);

  const posSaleTotal = orgPos.reduce((sum, s) => sum + s.totalAmount, 0);
  const shopOrderTotal = orgShop.reduce((sum, o) => sum + o.totalAmount, 0);

  return {
    timestamp: new Date().toISOString(),
    sourceOrgId: organizationId,
    tables: {
      erp_stock_ledger: orgStock,
      pos_sales: orgPos,
      shop_orders: orgShop,
    },
    summary: {
      stockRecordCount: orgStock.length,
      posSaleTotalAmount: posSaleTotal,
      shopOrderTotalAmount: shopOrderTotal,
    },
  };
}

/**
 * C05: Restore backup data into an independent database instance and verify amounts match exactly
 */
export function restoreAndVerifyBackup(backup: BackupData, targetDbPath: string = ":memory:"): {
  success: boolean;
  restoredStockCount: number;
  restoredPosTotal: number;
  restoredShopTotal: number;
} {
  const targetD1 = createSqliteD1(targetDbPath);
  const rawDb: DatabaseSync = targetD1._rawDb;

  // Insert restored records into independent target database
  const insertStock = rawDb.prepare(`
    INSERT INTO erp_stock_ledger (id, organization_id, item_id, warehouse_id, change_type, quantity_change, balance_after, unit_cost, total_value, reference_doc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of backup.tables.erp_stock_ledger) {
    insertStock.run(
      row.id,
      row.organizationId,
      row.itemId,
      row.warehouseId,
      row.changeType,
      row.quantityChange,
      row.balanceAfter,
      row.unitCost,
      row.totalValue,
      row.referenceDoc
    );
  }

  const insertPos = rawDb.prepare(`
    INSERT INTO pos_sales (id, organization_id, receipt_number, store_id, register_id, shift_id, cashier_id, subtotal, discount_amount, tax_amount, total_amount, tender_amount, change_amount, payment_method, status, is_reprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of backup.tables.pos_sales) {
    insertPos.run(
      s.id,
      s.organizationId,
      s.receiptNumber,
      s.storeId,
      s.registerId,
      s.shiftId,
      s.cashierId,
      s.subtotal,
      s.discountAmount,
      s.taxAmount,
      s.totalAmount,
      s.tenderAmount,
      s.changeAmount,
      s.paymentMethod,
      s.status,
      s.isReprint ? 1 : 0
    );
  }

  const insertShop = rawDb.prepare(`
    INSERT INTO shop_orders (id, organization_id, order_number, customer_email, shipping_address_json, subtotal, discount_amount, shipping_fee, total_amount, payment_status, fulfillment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const o of backup.tables.shop_orders) {
    insertShop.run(
      o.id,
      o.organizationId,
      o.orderNumber,
      o.customerEmail,
      o.shippingAddressJson,
      o.subtotal,
      o.discountAmount,
      o.shippingFee,
      o.totalAmount,
      o.paymentStatus,
      o.fulfillmentStatus
    );
  }

  // Verification queries
  const stockCountRow = rawDb.prepare("SELECT COUNT(*) as count FROM erp_stock_ledger").get() as any;
  const posSumRow = rawDb.prepare("SELECT SUM(total_amount) as total FROM pos_sales").get() as any;
  const shopSumRow = rawDb.prepare("SELECT SUM(total_amount) as total FROM shop_orders").get() as any;

  const restoredStockCount = Number(stockCountRow?.count || 0);
  const restoredPosTotal = Number(posSumRow?.total || 0);
  const restoredShopTotal = Number(shopSumRow?.total || 0);

  if (
    restoredStockCount !== backup.summary.stockRecordCount ||
    restoredPosTotal !== backup.summary.posSaleTotalAmount ||
    restoredShopTotal !== backup.summary.shopOrderTotalAmount
  ) {
    throw new Error(
      `備份還原核對失敗！預期筆數/金額不一致 (C05): ` +
      `StockCount(${restoredStockCount} vs ${backup.summary.stockRecordCount}), ` +
      `PosTotal(${restoredPosTotal} vs ${backup.summary.posSaleTotalAmount}), ` +
      `ShopTotal(${restoredShopTotal} vs ${backup.summary.shopOrderTotalAmount})`
    );
  }

  return {
    success: true,
    restoredStockCount,
    restoredPosTotal,
    restoredShopTotal,
  };
}
