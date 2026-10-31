import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import {
  organizations,
  demoSeedStates,
  users,
  memberships,
  crmAccounts,
  crmContacts,
  crmLeads,
  crmStages,
  crmOpportunities,
  crmActivities,
  crmQuotes,
  crmQuoteItems,
  crmTickets,
  crmConsents,
} from "../db/schema";

// Fictional fixtures only: no real brands, personal phone numbers or delivery addresses.
export async function seedOrganization(orgId: string = "org_demo_default") {
  const db = getDb();

  // 1. Organization & Core Users
  const existingOrg = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (existingOrg.length === 0) {
    await db.insert(organizations).values({
      id: orgId,
      name: "示範企業 (Business Suite Enterprise)",
      slug: orgId,
    }).onConflictDoNothing();
  }

  // Users
  const adminUser = { id: `usr_${orgId}_admin`, email: "admin@suite.test", displayName: "示範管理員 (Admin)" };
  const operatorUser = { id: `usr_${orgId}_op`, email: "operator@suite.test", displayName: "示範作業員 / 現場主管" };
  const readonlyUser = { id: `usr_${orgId}_ro`, email: "guest@suite.test", displayName: "訪客 (唯讀)" };

  for (const u of [adminUser, operatorUser, readonlyUser]) {
    const exists = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (exists.length === 0) {
      await db.insert(users).values(u).onConflictDoNothing();
    }
  }

  // Memberships
  const memberRoles = [
    { userId: adminUser.id, role: "admin" },
    { userId: operatorUser.id, role: "operator" },
    { userId: readonlyUser.id, role: "readonly" },
  ];
  for (const m of memberRoles) {
    const memId = `mem_${orgId}_${m.userId}`;
    const exists = await db.select().from(memberships).where(eq(memberships.id, memId)).limit(1);
    if (exists.length === 0) {
      await db.insert(memberships).values({
        id: memId,
        organizationId: orgId,
        userId: m.userId,
        role: m.role,
      }).onConflictDoNothing();
    }
  }

  // ==========================================
  // 5. CRM「RelationDesk」Seed
  // ==========================================
  const stages = [
    { id: `crm_stg_01_${orgId}`, organizationId: orgId, name: "初步接觸", position: 1, probability: 10, isWon: false, isLost: false },
    { id: `crm_stg_02_${orgId}`, organizationId: orgId, name: "需求確認", position: 2, probability: 30, isWon: false, isLost: false },
    { id: `crm_stg_03_${orgId}`, organizationId: orgId, name: "方案報價", position: 3, probability: 60, isWon: false, isLost: false },
    { id: `crm_stg_04_${orgId}`, organizationId: orgId, name: "商務談判", position: 4, probability: 80, isWon: false, isLost: false },
    { id: `crm_stg_05_${orgId}`, organizationId: orgId, name: "成功結案", position: 5, probability: 100, isWon: true, isLost: false },
    { id: `crm_stg_06_${orgId}`, organizationId: orgId, name: "結案失單", position: 6, probability: 0, isWon: false, isLost: true },
  ];
  await db.insert(crmStages).values(stages).onConflictDoNothing();

  const acc1 = { id: `crm_acc_01_${orgId}`, organizationId: orgId, name: "示範雲端客戶 A（虛構）", industry: "雲端軟體", phone: "DEMO-PHONE-001", email: "contact@customer-a.example.test", ownerId: adminUser.id };
  await db.insert(crmAccounts).values(acc1).onConflictDoNothing();

  const cont1 = { id: `crm_cont_01_${orgId}`, organizationId: orgId, accountId: acc1.id, name: "示範聯絡人 A", email: "person-a@customer-a.example.test", phone: "DEMO-PHONE-002", title: "雲端架構處長" };
  await db.insert(crmContacts).values(cont1).onConflictDoNothing();

  await db.insert(crmConsents).values({
    id: `crm_csnt_01_${orgId}`,
    organizationId: orgId,
    contactId: cont1.id,
    email: cont1.email,
    marketingEmailAllowed: true,
  }).onConflictDoNothing();

  await db.insert(crmLeads).values({
    id: `crm_lead_01_${orgId}`,
    organizationId: orgId,
    name: "示範聯絡人 B",
    company: "示範製造潛客 B（虛構）",
    email: "person-b@prospect-b.example.test",
    phone: "DEMO-PHONE-003",
    status: "new",
    assignedTo: adminUser.id,
  }).onConflictDoNothing();

  // Opportunity: $100,000 at 60% probability = $60,000 weighted
  const opp1 = {
    id: `crm_opp_01_${orgId}`,
    organizationId: orgId,
    name: "智慧製造數位雙生升級案",
    accountId: acc1.id,
    primaryContactId: cont1.id,
    ownerId: adminUser.id,
    stageId: `crm_stg_03_${orgId}`,
    amount: 100000,
    weightedAmount: 60000,
    probability: 60,
    closeDate: "2026-11-30",
    status: "open",
  };
  await db.insert(crmOpportunities).values(opp1).onConflictDoNothing();

  const quote1 = {
    id: `crm_qt_01_${orgId}`,
    organizationId: orgId,
    quoteNumber: "QT-202610-001",
    opportunityId: opp1.id,
    version: 1,
    totalAmount: 100000,
    status: "approved",
    isLocked: true,
    approvedAt: "2026-10-25 10:00:00",
  };
  await db.insert(crmQuotes).values(quote1).onConflictDoNothing();
  await db.insert(crmQuoteItems).values({
    id: `crm_qti_01_${orgId}`,
    organizationId: orgId,
    quoteId: quote1.id,
    itemName: "數位雙生現場架設與授權 (年度)",
    quantity: 1,
    unitPrice: 100000,
    lineTotal: 100000,
  }).onConflictDoNothing();

  await db.insert(crmActivities).values({
    id: `crm_act_01_${orgId}`,
    organizationId: orgId,
    activityType: "meeting",
    subject: "客戶方案需求第二階段審核會議",
    dueDate: "2026-11-05 14:00",
    completed: false,
    ownerId: adminUser.id,
    accountId: acc1.id,
    contactId: cont1.id,
    opportunityId: opp1.id,
  }).onConflictDoNothing();

  await db.insert(crmTickets).values({
    id: `crm_tck_01_${orgId}`,
    organizationId: orgId,
    ticketNumber: "TCK-202610-001",
    customerId: acc1.id,
    contactId: cont1.id,
    subject: "API 對接金鑰權限授權配置詢問",
    priority: "high",
    status: "in_progress",
    slaHours: 24,
    isSlaBreached: false,
  }).onConflictDoNothing();

  await db.insert(demoSeedStates).values({ organizationId: orgId }).onConflictDoNothing();
  return { success: true, organizationId: orgId };
}
