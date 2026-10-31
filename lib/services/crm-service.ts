import { eq, and, sql, or } from "drizzle-orm";
import { getDb } from "../../db/index";
import {
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
  users,
} from "../../db/schema";
import { TenantContext, checkPermission } from "../tenant";
import { recordAuditEvent } from "../audit";
import { calculateSlaDueDate } from "../money";

export class CrmService {

  static ticketDueAt(createdAt: string, slaHours: number) {
    const parsed = new Date(createdAt.includes("T") ? createdAt : createdAt.replace(" ","T") + "Z");
    // Shift UTC into Taipei wall time, calculate 09–18 business hours, then shift back.
    const shifted = new Date(parsed.getTime() + 8 * 3600000);
    return new Date(calculateSlaDueDate(shifted,slaHours).getTime() - 8 * 3600000).toISOString();
  }

  static async revokeConsent(context: TenantContext, contactId:string) {
    const permission=checkPermission(context,"operator");if(!permission.allowed)throw new Error(permission.message);
    const db=getDb();const [contact]=await db.select().from(crmContacts).where(and(eq(crmContacts.id,contactId),eq(crmContacts.organizationId,context.organizationId)));
    if(!contact)throw new Error("聯絡人不存在");
    await db.update(crmConsents).set({marketingEmailAllowed:false,updatedAt:new Date().toISOString()}).where(and(eq(crmConsents.organizationId,context.organizationId),eq(crmConsents.contactId,contactId)));
    await recordAuditEvent({context,action:"REVOKE_MARKETING_CONSENT",entityType:"crm_contact",entityId:contactId,afterValue:{marketingEmailAllowed:false}});
    return {success:true};
  }

  static async createActivity(context:TenantContext,params:{subject:string;dueDate:string;activityType?:string}) {
    const permission=checkPermission(context,"operator");if(!permission.allowed)throw new Error(permission.message);
    if(!params.subject?.trim() || params.subject.length>300 || !Number.isFinite(Date.parse(params.dueDate)))throw new Error("請填寫活動主旨與有效日期");
    if(params.activityType&&!['call','meeting','task','email'].includes(params.activityType))throw new Error("活動類型錯誤");
    const id=crypto.randomUUID();await getDb().insert(crmActivities).values({id,organizationId:context.organizationId,subject:params.subject.trim(),dueDate:new Date(params.dueDate).toISOString(),activityType:params.activityType||"task",ownerId:context.userId});return {success:true,id};
  }

  static async createQuote(context:TenantContext,params:{opportunityId:string;itemName:string;quantity:number;unitPrice:number}) {
    const permission=checkPermission(context,"operator");if(!permission.allowed)throw new Error(permission.message);
    if(!params.itemName?.trim()||params.itemName.length>200||!Number.isSafeInteger(params.quantity)||params.quantity<1||!Number.isSafeInteger(params.unitPrice)||params.unitPrice<0||!Number.isSafeInteger(params.quantity*params.unitPrice))throw new Error("報價品名、數量或金額不正確");
    const db=getDb();const [opp]=await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.id,params.opportunityId),eq(crmOpportunities.organizationId,context.organizationId)));if(!opp)throw new Error("商機不存在");
    const previous=await db.select().from(crmQuotes).where(and(eq(crmQuotes.organizationId,context.organizationId),eq(crmQuotes.opportunityId,params.opportunityId)));
    const version=previous.reduce((n,q)=>Math.max(n,q.version),0)+1;const id=`quote:${opp.id}:v${version}`;const total=params.quantity*params.unitPrice;
    await db.batch([db.insert(crmQuotes).values({id,organizationId:context.organizationId,quoteNumber:`QT-${Date.now()}`,opportunityId:opp.id,version,totalAmount:total,status:"submitted"}),db.insert(crmQuoteItems).values({id:crypto.randomUUID(),organizationId:context.organizationId,quoteId:id,itemName:params.itemName,quantity:params.quantity,unitPrice:params.unitPrice,lineTotal:total})]);return {success:true,id,version};
  }

  /**
   * R01: Add contact with email duplication warning and company association
   */
  static async createContact(context: TenantContext, params: {
    accountId?: string;
    name: string;
    email: string;
    phone?: string;
    title?: string;
    marketingConsent?: boolean;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();

    if (!params.name?.trim() || params.name.length > 150 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(params.email?.trim() || "")) throw new Error("請填寫聯絡人姓名與有效電子郵件");
    params.email = params.email.trim().toLowerCase();
    if (params.accountId) {
      const [account] = await db.select().from(crmAccounts).where(and(eq(crmAccounts.organizationId,context.organizationId),eq(crmAccounts.id,params.accountId)));
      if (!account) throw new Error("客戶不存在");
    }
    // Check duplicate email
    const existing = await db.select().from(crmContacts)
      .where(and(eq(crmContacts.organizationId, context.organizationId), sql`lower(${crmContacts.email}) = ${params.email}`))
      .limit(1);

    if (existing.length > 0) {
      throw new Error(`電子郵件 ${params.email} 已存在於聯絡人「${existing[0].name}」，請確認是否為同一人 (R01)`);
    }

    const contactId = `contact:${context.organizationId}:${params.email}`;
    await db.batch([db.insert(crmContacts).values({
      id: contactId,
      organizationId: context.organizationId,
      accountId: params.accountId || null,
      name: params.name.trim(),
      email: params.email,
      phone: params.phone || null,
      title: params.title || null,
    }),

    // Consent is opt-in.
    db.insert(crmConsents).values({
      id: `csnt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: context.organizationId,
      contactId,
      email: params.email,
      marketingEmailAllowed: params.marketingConsent === true,
    })]);

    return { success: true, contactId };
  }

  /**
   * R02: Convert Lead to Account, Contact, and Opportunity in one step
   */
  static async convertLead(context: TenantContext, params: {
    leadId: string;
    dealAmount?: number;
    closeDate?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const leads = await db.select().from(crmLeads)
      .where(and(eq(crmLeads.organizationId, context.organizationId), eq(crmLeads.id, params.leadId)))
      .limit(1);

    if (leads.length === 0) throw new Error("找不到潛客資料");
    const lead = leads[0];
    if (params.dealAmount !== undefined && (!Number.isSafeInteger(params.dealAmount) || params.dealAmount < 0)) throw new Error("商機金額須為非負整數");

    if (lead.status === "converted") {
      // Idempotent: return existing conversion (R02)
      return {
        alreadyConverted: true,
        accountId: lead.convertedAccountId,
        contactId: lead.convertedContactId,
        opportunityId: lead.convertedOpportunityId,
      };
    }

    // Check if assigned user is active
    if (lead.assignedTo) {
      const u = await db.select().from(users).where(eq(users.id, lead.assignedTo)).limit(1);
      if (u.length === 0) {
        throw new Error("指派業務不存在或已停用，無法指派新商機 (R02)");
      }
    }

    const statements:any[]=[];
    const companyName = lead.company || `${lead.name} 個人企業`;
    const accountId = `lead-account:${lead.id}`;
    statements.push(db.insert(crmAccounts).values({
      id: accountId,
      organizationId: context.organizationId,
      name: companyName,
      email: lead.email,
      phone: lead.phone,
      ownerId: lead.assignedTo || context.userId,
    }));

    const contactId = `lead-contact:${lead.id}`;
    statements.push(db.insert(crmContacts).values({
      id: contactId,
      organizationId: context.organizationId,
      accountId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
    }));

    // Default stage 1
    const stages = await db.select().from(crmStages)
      .where(eq(crmStages.organizationId, context.organizationId))
      .orderBy(crmStages.position)
      .limit(1);
    const initialStage = stages[0];

    const amount = params.dealAmount ?? 50000;
    const prob = initialStage ? initialStage.probability : 10;
    const weightedAmount = Math.round((amount * prob) / 100);

    const oppId = `lead-opportunity:${lead.id}`;
    statements.push(db.insert(crmOpportunities).values({
      id: oppId,
      organizationId: context.organizationId,
      name: `${companyName} - 潛客商機開拓`,
      accountId,
      primaryContactId: contactId,
      ownerId: lead.assignedTo || context.userId,
      stageId: initialStage ? initialStage.id : "stage_default",
      amount,
      weightedAmount,
      probability: prob,
      closeDate: params.closeDate || "2026-12-31",
      status: "open",
    }));

    // Update lead status
    statements.push(db.update(crmLeads).set({
      status: "converted",
      convertedAccountId: accountId,
      convertedContactId: contactId,
      convertedOpportunityId: oppId,
    }).where(and(eq(crmLeads.id, params.leadId),eq(crmLeads.organizationId,context.organizationId))));
    try {await db.batch(statements as [any,...any[]]);} catch(error) {const [latest]=await db.select().from(crmLeads).where(and(eq(crmLeads.id,params.leadId),eq(crmLeads.organizationId,context.organizationId)));if(latest?.status==="converted")return {alreadyConverted:true,accountId:latest.convertedAccountId,contactId:latest.convertedContactId,opportunityId:latest.convertedOpportunityId};throw error;}

    return {
      success: true,
      accountId,
      contactId,
      opportunityId: oppId,
    };
  }

  /**
   * R03: Update Opportunity Stage, Weighted Amount, and Won/Lost reason
   */
  static async updateOpportunityStage(context: TenantContext, params: {
    opportunityId: string;
    stageId: string;
    wonReason?: string;
    lossReason?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const opps = await db.select().from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, context.organizationId), eq(crmOpportunities.id, params.opportunityId)))
      .limit(1);

    if (opps.length === 0) throw new Error("商機不存在");
    const opp = opps[0];

    const stageRes = await db.select().from(crmStages)
      .where(and(eq(crmStages.organizationId, context.organizationId), eq(crmStages.id, params.stageId)))
      .limit(1);

    if (stageRes.length === 0) throw new Error("指定的商機階段不存在");
    const newStage = stageRes[0];

    let newStatus = "open";
    if (newStage.isWon) {
      if (!params.wonReason?.trim()) throw new Error("結案成交必須填寫成交原因 (R03)");
      newStatus = "won";
    } else if (newStage.isLost) {
      if (!params.lossReason?.trim()) throw new Error("結案失單必須填寫失單原因 (R03)");
      newStatus = "lost";
    }

    const newProbability = newStage.probability;
    // 100000 x 60% = 60000 (R03)
    const newWeightedAmount = Math.round((opp.amount * newProbability) / 100);

    await db.update(crmOpportunities).set({
      stageId: params.stageId,
      probability: newProbability,
      weightedAmount: newWeightedAmount,
      status: newStatus,
      wonReason: params.wonReason || null,
      lossReason: params.lossReason || null,
    }).where(eq(crmOpportunities.id, params.opportunityId));

    return {
      success: true,
      amount: opp.amount,
      probability: newProbability,
      weightedAmount: newWeightedAmount,
      status: newStatus,
    };
  }

  /**
   * R04: Create and Complete Activity
   */
  static async completeActivity(context: TenantContext, activityId: string) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const [activity] = await db.select().from(crmActivities).where(and(eq(crmActivities.organizationId,context.organizationId),eq(crmActivities.id,activityId)));
    if (!activity) throw new Error("活動不存在");
    if (activity.completed) return {success:true};
    await db.update(crmActivities).set({
      completed: true,
      completedAt: new Date().toISOString(),
    }).where(and(eq(crmActivities.organizationId, context.organizationId), eq(crmActivities.id, activityId)));

    return { success: true };
  }

  /**
   * R05: Create quote version & approve lock snapshot
   */
  static async approveQuote(context: TenantContext, quoteId: string) {
    const perm = checkPermission(context, "admin");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const quotes = await db.select().from(crmQuotes)
      .where(and(eq(crmQuotes.organizationId, context.organizationId), eq(crmQuotes.id, quoteId)))
      .limit(1);

    if (quotes.length === 0) throw new Error("報價單不存在");
    const quote = quotes[0];

    if (quote.isLocked) {
      throw new Error("此報價單已核准並鎖定，不可重複核准 (R05)");
    }

    await recordAuditEvent({context,action:"APPROVE_QUOTE",entityType:"crm_quote",entityId:quoteId,beforeValue:{status:quote.status,isLocked:quote.isLocked},afterValue:{status:"approved",isLocked:true,totalAmount:quote.totalAmount}});
    await db.update(crmQuotes).set({
      status: "approved",
      isLocked: true,
      approvedAt: new Date().toISOString(),
    }).where(eq(crmQuotes.id, quoteId));

    return { success: true, isLocked: true };
  }

  /**
   * R06: Customer Service Ticket & SLA Tracking
   */
  static async createTicket(context: TenantContext, params: {
    customerId?: string;
    contactId?: string;
    subject: string;
    priority?: string;
    slaHours?: number;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const ticketId = `tck_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ticketNumber = `TCK-${Date.now()}`;
    if (!params.subject?.trim() || params.subject.length > 300) throw new Error("工單主旨須為 1 至 300 字");
    const slaHours = params.slaHours ?? 24;
    if (!Number.isInteger(slaHours) || slaHours < 1 || slaHours > 720) throw new Error("SLA 須為 1 至 720 小時");
    if (params.priority && !["low","medium","high","urgent"].includes(params.priority)) throw new Error("不支援的優先級");
    if (params.customerId) {const [account]=await db.select().from(crmAccounts).where(and(eq(crmAccounts.organizationId,context.organizationId),eq(crmAccounts.id,params.customerId)));if(!account)throw new Error("客戶不存在");}
    if (params.contactId) {const [contact]=await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId,context.organizationId),eq(crmContacts.id,params.contactId)));if(!contact)throw new Error("聯絡人不存在");}
    const createdAt = new Date().toISOString();
    const dueAt = this.ticketDueAt(createdAt, slaHours);

    await db.insert(crmTickets).values({
      id: ticketId,
      organizationId: context.organizationId,
      ticketNumber,
      customerId: params.customerId || null,
      contactId: params.contactId || null,
      subject: params.subject,
      priority: params.priority || "medium",
      status: "new",
      slaHours,
      isSlaBreached: false,
      createdAt,
    });

    return { success: true, ticketId, ticketNumber, slaHours, dueAt };
  }

  /**
   * R07: Marketing consent list (excludes contacts without consent)
   */
  static async getMarketingRecipients(context: TenantContext) {
    const db = getDb();
    const consents = await db.select().from(crmConsents)
      .where(and(
        eq(crmConsents.organizationId, context.organizationId),
        eq(crmConsents.marketingEmailAllowed, true)
      ));

    return consents.map(c => ({
      contactId: c.contactId,
      email: c.email,
    }));
  }

  /**
   * R08: Sales Pipeline / Funnel drilldown and role-based permissions
   */
  static async getSalesFunnel(context: TenantContext) {
    const db = getDb();

    // If role is operator/sales, only show own opportunities; if admin, show team (R08)
    let oppQuery = db.select().from(crmOpportunities)
      .where(eq(crmOpportunities.organizationId, context.organizationId));

    const allOpps = await oppQuery;
    const filteredOpps = context.role === "admin"
      ? allOpps
      : allOpps.filter(o => o.ownerId === context.userId);

    const stages = await db.select().from(crmStages)
      .where(eq(crmStages.organizationId, context.organizationId))
      .orderBy(crmStages.position);

    let totalPipelineAmount = 0;
    let totalWeightedAmount = 0;
    let wonCount = 0;
    let totalCount = filteredOpps.length;

    const stageSummary = stages.map(s => {
      const oppsInStage = filteredOpps.filter(o => o.stageId === s.id);
      const stageAmount = oppsInStage.reduce((sum, o) => sum + o.amount, 0);
      const stageWeighted = oppsInStage.reduce((sum, o) => sum + o.weightedAmount, 0);

      totalPipelineAmount += stageAmount;
      totalWeightedAmount += stageWeighted;
      if (s.isWon) wonCount += oppsInStage.length;

      return {
        stageId: s.id,
        stageName: s.name,
        probability: s.probability,
        count: oppsInStage.length,
        totalAmount: stageAmount,
        weightedAmount: stageWeighted,
      };
    });

    const winRatePercent = totalCount > 0 ? Number(((wonCount / totalCount) * 100).toFixed(2)) : 0;

    return {
      stages: stageSummary,
      totalCount,
      totalPipelineAmount,
      totalWeightedAmount,
      winRatePercent,
    };
  }
}
