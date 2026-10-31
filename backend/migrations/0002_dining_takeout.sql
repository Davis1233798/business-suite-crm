-- Preserve existing dine-in bills while allowing a takeout bill to link directly
-- to its order without inventing a table session.
CREATE TABLE dining_bills_next (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  session_id TEXT,
  order_id TEXT,
  subtotal INTEGER NOT NULL,
  service_charge INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  final_amount INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO dining_bills_next (id, organization_id, session_id, subtotal, service_charge, discount_amount, final_amount, paid_amount, status, created_at)
SELECT id, organization_id, session_id, subtotal, service_charge, discount_amount, final_amount, paid_amount, status, created_at FROM dining_bills;
--> statement-breakpoint
DROP TABLE dining_bills;
--> statement-breakpoint
ALTER TABLE dining_bills_next RENAME TO dining_bills;
--> statement-breakpoint
CREATE UNIQUE INDEX dining_bills_order_id_unique ON dining_bills(order_id);
--> statement-breakpoint
CREATE UNIQUE INDEX dining_orders_takeout_number_unique ON dining_orders(organization_id, takeout_number);
