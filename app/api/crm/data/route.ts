import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getDb } from "@/db/index";
import { eq, sql } from "drizzle-orm";
import {
  crmAccounts,
  crmContacts,
  crmLeads,
  crmStages,
  crmOpportunities,
  crmActivities,
  crmQuotes,
  crmTickets,
  crmConsents,
  crmQuoteItems,
} from "@/db/schema";
import { CrmService } from "@/lib/services/crm-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const db = getDb();
    const orgId = context.organizationId;

    const [accounts, contacts, leads, stages, opportunities, activities, tickets, funnel, quotes, consents, quoteItems] =
      await Promise.all([
        db.select().from(crmAccounts).where(eq(crmAccounts.organizationId, orgId)),
        db.select().from(crmContacts).where(eq(crmContacts.organizationId, orgId)),
        db.select().from(crmLeads).where(eq(crmLeads.organizationId, orgId)),
        db.select().from(crmStages).where(eq(crmStages.organizationId, orgId)).orderBy(crmStages.position),
        db.select().from(crmOpportunities).where(eq(crmOpportunities.organizationId, orgId)).orderBy(sql`rowid DESC`),
        db.select().from(crmActivities).where(eq(crmActivities.organizationId, orgId)),
        db.select().from(crmTickets).where(eq(crmTickets.organizationId, orgId)),
        CrmService.getSalesFunnel(context),
        db.select().from(crmQuotes).where(eq(crmQuotes.organizationId,orgId)),
        db.select().from(crmConsents).where(eq(crmConsents.organizationId,orgId)),
        db.select().from(crmQuoteItems).where(eq(crmQuoteItems.organizationId,orgId)),
      ]);

    return successResponse({
      accounts,
      contacts,
      leads,
      stages,
      opportunities,
      activities,
      tickets: tickets.map(t => { const dueAt=CrmService.ticketDueAt(t.createdAt,t.slaHours);return {...t,dueAt,isSlaBreached:t.status!=="resolved"&&Date.parse(dueAt)<Date.now()}; }),
      quotes, consents, quoteItems, role:context.role,
      funnel,
    }, context.requestId);
  } catch (err: any) {
    return errorResponse("FETCH_CRM_FAILED", err.message, 500);
  }
}
