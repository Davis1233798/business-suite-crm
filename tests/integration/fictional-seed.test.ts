import test from "node:test";
import assert from "node:assert/strict";
import { seedOrganization } from "../../lib/seed";
import { getDb } from "../../db";
import { crmAccounts, crmContacts, crmLeads, crmConsents, erpSuppliers, erpCustomers, shopOrders, posStores } from "../../db/schema";
import { eq } from "drizzle-orm";

test("new demo workspaces use explicitly fictional identities and non-dialable contact fixtures", async () => {
  const organizationId = `fictional_${crypto.randomUUID()}`;
  await seedOrganization(organizationId);
  const db = getDb();
  const accounts = await db.select().from(crmAccounts).where(eq(crmAccounts.organizationId, organizationId));
  const contacts = await db.select().from(crmContacts).where(eq(crmContacts.organizationId, organizationId));
  const leads = await db.select().from(crmLeads).where(eq(crmLeads.organizationId, organizationId));
  for (const person of [...accounts, ...contacts, ...leads]) {
    assert.match(person.name, /^示範/);
    assert.match(person.email!, /@[^@]+\.example\.test$/);
    assert.match(person.phone!, /^DEMO-PHONE-\d+$/);
  }
  for (const lead of leads) assert.match(lead.company!, /^示範.*（虛構）$/);
  const consents = await db.select().from(crmConsents).where(eq(crmConsents.organizationId, organizationId));
  assert.equal(consents[0].email, contacts[0].email);
  const suppliers = await db.select().from(erpSuppliers).where(eq(erpSuppliers.organizationId, organizationId));
  const customers = await db.select().from(erpCustomers).where(eq(erpCustomers.organizationId, organizationId));
  for (const partner of [...suppliers, ...customers]) {
    assert.match(partner.name, /^示範.*（虛構）$/);
    assert.match(partner.code, /DEMO/);
    assert.match(partner.contactEmail!, /\.example\.test$/);
  }
  const orders = await db.select().from(shopOrders).where(eq(shopOrders.organizationId, organizationId));
  const address = JSON.parse(orders[0].shippingAddressJson!);
  assert.match(address.name, /^示範/);
  assert.match(address.address, /非實際地址/);
  assert.match(address.phone, /^DEMO-PHONE-/);
  const stores = await db.select().from(posStores).where(eq(posStores.organizationId, organizationId));
  assert.match(stores[0].address!, /非實際地址/);
});
