CREATE UNIQUE INDEX IF NOT EXISTS idempotency_scope_unique ON idempotency_keys(organization_id, key, endpoint);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS pos_stock_nonnegative BEFORE UPDATE OF stock_quantity ON pos_catalog_items WHEN NEW.stock_quantity < 0 BEGIN SELECT RAISE(ABORT, 'Insufficient stock'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS shop_stock_nonnegative BEFORE UPDATE OF stock_quantity ON shop_variants WHEN NEW.stock_quantity < 0 BEGIN SELECT RAISE(ABORT, 'Insufficient stock'); END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS erp_stock_ledger_consistency;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS erp_stock_ledger_consistency BEFORE INSERT ON erp_stock_ledger WHEN NOT EXISTS (SELECT 1 FROM erp_stock_ledger WHERE id=NEW.id) AND (NEW.balance_after < 0 OR NEW.balance_after != COALESCE((SELECT balance_after FROM erp_stock_ledger WHERE organization_id=NEW.organization_id AND item_id=NEW.item_id AND warehouse_id=NEW.warehouse_id ORDER BY rowid DESC LIMIT 1),0) + NEW.quantity_change) BEGIN SELECT RAISE(ABORT, 'Stock changed concurrently; retry operation'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS mes_report_limit BEFORE UPDATE OF completed_quantity, scrapped_quantity ON mes_work_orders WHEN NEW.completed_quantity < 0 OR NEW.scrapped_quantity < 0 OR NEW.completed_quantity + NEW.scrapped_quantity > NEW.target_quantity OR OLD.status != 'in_progress' BEGIN SELECT RAISE(ABORT, 'Work order is closed or production exceeds target'); END;

--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS pos_refund_limit BEFORE UPDATE OF refunded_quantity ON pos_sale_lines WHEN NEW.refunded_quantity < 0 OR NEW.refunded_quantity > NEW.quantity BEGIN SELECT RAISE(ABORT, 'Refund quantity exceeds original sale'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift_per_register ON pos_shifts(organization_id, register_id) WHERE status='open';

--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS erp_invoice_overpayment BEFORE UPDATE OF paid_amount ON erp_invoices WHEN NEW.paid_amount < 0 OR NEW.paid_amount > NEW.total_amount BEGIN SELECT RAISE(ABORT, 'Invoice overpayment'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS erp_shipment_limit BEFORE UPDATE OF shipped_quantity ON erp_sales_order_lines WHEN NEW.shipped_quantity < 0 OR NEW.shipped_quantity > NEW.quantity BEGIN SELECT RAISE(ABORT, 'Shipment exceeds ordered quantity'); END;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS demo_seed_states (organization_id TEXT PRIMARY KEY NOT NULL, ready_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS erp_journal_period_closed BEFORE INSERT ON erp_journal_entries WHEN EXISTS (SELECT 1 FROM erp_fiscal_periods WHERE organization_id=NEW.organization_id AND is_closed=1 AND start_date<=NEW.entry_date AND end_date>=NEW.entry_date) BEGIN SELECT RAISE(ABORT, 'Fiscal period is closed'); END;
