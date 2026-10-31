import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const stationAccounts = sqliteTable('station_accounts', {
  userId: text('user_id').primaryKey(), organizationId: text('organization_id').notNull(),
  email: text('email').notNull(), passwordHash: text('password_hash').notNull(), disabled: integer('disabled').notNull().default(0),
}, t=>[uniqueIndex('station_accounts_email').on(t.organizationId,t.email)]);
export const stationGrants = sqliteTable('station_grants', {
  userId: text('user_id').notNull(), site: text('site').notNull(), role: text('role').notNull(),
  scope: text('scope').notNull(), enabled: integer('enabled').notNull().default(1),
},t=>[uniqueIndex('station_grants_user_site').on(t.userId,t.site)]);
export const stationSessions = sqliteTable('station_sessions', {
  tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull(),expiresAt:integer('expires_at').notNull(),
});
export const stationLoginLimits = sqliteTable('station_login_limits', {
  key:text('key').primaryKey(),attempts:integer('attempts').notNull(),resetAt:integer('reset_at').notNull(),
});

// ==========================================
// 1. Common & Tenant Tables
// ==========================================

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("operator"), // admin, operator, readonly
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  actorId: text("actor_id").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(), // UPDATE_AMOUNT, UPDATE_ROLE, DEDUCT_STOCK, REFUND, etc.
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  reason: text("reason"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  key: text("key").notNull(),
  endpoint: text("endpoint").notNull(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: text("response_body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const outboxEvents = sqliteTable("outbox_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"), // pending, processed, failed
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 2. MES「ForgeFlow」Tables
// ==========================================

export const erpItems = sqliteTable("erp_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("PCS"),
  boxConversionRatio: integer("box_conversion_ratio").notNull().default(1),
  category: text("category").notNull().default("general"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const erpStockLedger = sqliteTable("erp_stock_ledger", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  itemId: text("item_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  changeType: text("change_type").notNull(), // purchase_receipt, purchase_return, sales_shipment, transfer_in, transfer_out, adjustment
  quantityChange: integer("quantity_change").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  totalValue: integer("total_value").notNull().default(0),
  referenceDoc: text("reference_doc").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const posSales = sqliteTable("pos_sales", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  receiptNumber: text("receipt_number").notNull(),
  storeId: text("store_id").notNull(),
  registerId: text("register_id").notNull(),
  shiftId: text("shift_id").notNull(),
  cashierId: text("cashier_id").notNull(),
  customerId: text("customer_id"),
  subtotal: integer("subtotal").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  tenderAmount: integer("tender_amount").notNull(),
  changeAmount: integer("change_amount").notNull().default(0),
  paymentMethod: text("payment_method").notNull().default("cash"),
  status: text("status").notNull().default("completed"), // completed, refunded, partially_refunded
  isReprint: integer("is_reprint", { mode: "boolean" }).notNull().default(false),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmAccounts = sqliteTable("crm_accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  industry: text("industry"),
  phone: text("phone"),
  email: text("email"),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmContacts = sqliteTable("crm_contacts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  accountId: text("account_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  title: text("title"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmLeads = sqliteTable("crm_leads", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("new"), // new, assigned, contacted, qualified, converted, disqualified
  assignedTo: text("assigned_to"),
  convertedAccountId: text("converted_account_id"),
  convertedContactId: text("converted_contact_id"),
  convertedOpportunityId: text("converted_opportunity_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmStages = sqliteTable("crm_stages", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  probability: integer("probability").notNull(),
  isWon: integer("is_won", { mode: "boolean" }).notNull().default(false),
  isLost: integer("is_lost", { mode: "boolean" }).notNull().default(false),
});

export const crmOpportunities = sqliteTable("crm_opportunities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  accountId: text("account_id"),
  primaryContactId: text("primary_contact_id"),
  ownerId: text("owner_id").notNull(),
  stageId: text("stage_id").notNull(),
  amount: integer("amount").notNull().default(0),
  weightedAmount: integer("weighted_amount").notNull().default(0),
  probability: integer("probability").notNull().default(0),
  closeDate: text("close_date"),
  status: text("status").notNull().default("open"), // open, won, lost
  lossReason: text("loss_reason"),
  wonReason: text("won_reason"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmActivities = sqliteTable("crm_activities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  activityType: text("activity_type").notNull(), // call, meeting, task, email
  subject: text("subject").notNull(),
  dueDate: text("due_date").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  completedAt: text("completed_at"),
  ownerId: text("owner_id").notNull(),
  accountId: text("account_id"),
  contactId: text("contact_id"),
  opportunityId: text("opportunity_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmQuotes = sqliteTable("crm_quotes", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  quoteNumber: text("quote_number").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  version: integer("version").notNull().default(1),
  totalAmount: integer("total_amount").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft, submitted, approved, rejected
  isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
  approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmQuoteItems = sqliteTable("crm_quote_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  quoteId: text("quote_id").notNull(),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  lineTotal: integer("line_total").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmTickets = sqliteTable("crm_tickets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  ticketNumber: text("ticket_number").notNull(),
  customerId: text("customer_id"),
  contactId: text("contact_id"),
  subject: text("subject").notNull(),
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  status: text("status").notNull().default("new"), // new, in_progress, resolved, reopened
  slaHours: integer("sla_hours").notNull().default(24),
  isSlaBreached: integer("is_sla_breached", { mode: "boolean" }).notNull().default(false),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const crmConsents = sqliteTable("crm_consents", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  contactId: text("contact_id").notNull(),
  email: text("email").notNull(),
  marketingEmailAllowed: integer("marketing_email_allowed", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ==========================================
// 6. Dining「TableCraft」Tables
// ==========================================

export const shopProducts = sqliteTable("shop_products", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  categoryId: text("category_id").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopVariants = sqliteTable("shop_variants", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  productId: text("product_id").notNull(),
  sku: text("sku").notNull(),
  title: text("title").notNull(),
  color: text("color"),
  size: text("size"),
  price: integer("price").notNull(),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  reservedQuantity: integer("reserved_quantity").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopOrders = sqliteTable("shop_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderNumber: text("order_number").notNull(),
  userId: text("user_id"),
  customerEmail: text("customer_email").notNull(),
  shippingAddressJson: text("shipping_address_json").notNull(),
  subtotal: integer("subtotal").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  shippingFee: integer("shipping_fee").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"), // pending, paid, failed, refunded
  fulfillmentStatus: text("fulfillment_status").notNull().default("unfulfilled"), // unfulfilled, partially_shipped, shipped, delivered
  trackingNumber: text("tracking_number"),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const shopOrderItems = sqliteTable("shop_order_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  orderId: text("order_id").notNull(),
  variantId: text("variant_id").notNull(),
  productName: text("product_name").notNull(),
  variantTitle: text("variant_title").notNull(),
  sku: text("sku").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const demoSeedStates = sqliteTable("demo_seed_states", { organizationId: text("organization_id").primaryKey(), readyAt: text("ready_at").notNull().default(sql`CURRENT_TIMESTAMP`) });
