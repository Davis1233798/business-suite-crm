import test from "node:test";
import assert from "node:assert";
import { getDb } from "../../db/index.ts";
import { seedOrganization } from "../../lib/seed.ts";
import { CrmService } from "../../lib/services/crm-service.ts";
import { shopVariants, shopOrders, crmStages, shopOrderItems, shopProducts } from "../../db/schema.ts";
import { eq, and } from "drizzle-orm";

test("P2 CRM Verification: R01 - R08", async () => {
  const orgId = `org_crm_test_${Date.now()}`;
  await seedOrganization(orgId);

  const adminCtx = {
    organizationId: orgId,
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "CRM Manager",
    role: "admin" as const,
    requestId: "req_crm_admin",
  };

  const operatorCtx = {
    ...adminCtx,
    userId: "usr_sales",
    role: "operator" as const,
    requestId: "req_crm_sales",
  };

  // R01: 聯絡人 (email 重複提示)
  const contactRes = await CrmService.createContact(operatorCtx, {
    name: "張志豪",
    email: "zhihao.zhang@techcorp.test",
    title: "採購副總",
  });
  assert.ok(contactRes.contactId);

  await assert.rejects(
    async () => {
      await CrmService.createContact(operatorCtx, {
        name: "張志豪 (分身)",
        email: "zhihao.zhang@techcorp.test",
      });
    },
    /已存在於聯絡人/
  );

  // R02: 潛客轉換 (一次建立客戶、聯絡人與商機；重送不重複)
  const leadId = `crm_lead_01_${orgId}`;
  const conv1 = await CrmService.convertLead(operatorCtx, {
    leadId,
    dealAmount: 80000,
  });
  assert.ok(conv1.accountId);
  assert.ok(conv1.contactId);
  assert.ok(conv1.opportunityId);

  // Retry convert -> must return alreadyConverted
  const conv2 = await CrmService.convertLead(operatorCtx, { leadId });
  assert.strictEqual(conv2.alreadyConverted, true);
  assert.strictEqual(conv2.opportunityId, conv1.opportunityId);

  // R03: 商機看板 (100,000 x 60% = 60,000 加權金額；成單失單原因)
  const oppId = `crm_opp_01_${orgId}`;
  const stageWon = `crm_stg_05_${orgId}`; // Won stage

  // Won without reason -> must reject (R03)
  await assert.rejects(
    async () => {
      await CrmService.updateOpportunityStage(operatorCtx, {
        opportunityId: oppId,
        stageId: stageWon,
      });
    },
    /結案成交必須填寫成交原因/
  );

  // Stage 3 (方案報價, 60% probability)
  const stg3Res = await CrmService.updateOpportunityStage(operatorCtx, {
    opportunityId: oppId,
    stageId: `crm_stg_03_${orgId}`,
  });
  assert.strictEqual(stg3Res.amount, 100000);
  assert.strictEqual(stg3Res.probability, 60);
  assert.strictEqual(stg3Res.weightedAmount, 60000);

  // R04: 活動完成
  const actId = `crm_act_01_${orgId}`;
  const actRes = await CrmService.completeActivity(operatorCtx, actId);
  assert.strictEqual(actRes.success, true);

  // R05: 報價單核准鎖定 (核准後鎖定；重複核准拒絕)
  const quoteId = `crm_qt_01_${orgId}`; // already locked in seed
  await assert.rejects(
    async () => {
      await CrmService.approveQuote(adminCtx, quoteId);
    },
    /不可重複核准/
  );

  // R06: 客服工單與SLA
  const tckRes = await CrmService.createTicket(operatorCtx, {
    subject: "雲端服務故障報修",
    priority: "urgent",
    slaHours: 12,
  });
  assert.strictEqual(tckRes.slaHours, 12);

  // R07: 行銷同意權過濾
  const recipients = await CrmService.getMarketingRecipients(operatorCtx);
  assert.strictEqual(recipients.length >= 1, true);

  // R08: 銷售漏斗與權限
  const funnel = await CrmService.getSalesFunnel(adminCtx);
  assert.strictEqual(funnel.stages.length, 6);
  assert.strictEqual(funnel.totalPipelineAmount >= 100000, true);
});
