import test from "node:test";
import assert from "node:assert/strict";
import {getDb} from "../../db/index";
import {seedOrganization} from "../../lib/seed";
import {CrmService} from "../../lib/services/crm-service";
import {crmContacts,crmAccounts,crmOpportunities,crmQuotes} from "../../db/schema";
import {and,eq} from "drizzle-orm";

test("CRM consent opt-in/revoke, tenant references, activity, quote locks, Taipei SLA and concurrent lead conversion",async()=>{
 const org=`crm_operations_${crypto.randomUUID()}`;const ctx={organizationId:org,userId:"sales",userEmail:"sales@test.local",userDisplayName:"Sales",role:"admin" as const,requestId:crypto.randomUUID()};await seedOrganization(org);const db=getDb();
 const added=await CrmService.createContact(ctx,{name:"Buyer",email:" BUYER@TEST.LOCAL ".trim()});
 await assert.rejects(()=>CrmService.createContact(ctx,{name:"Duplicate",email:"buyer@test.local"}),/已存在/);
 assert.equal((await CrmService.getMarketingRecipients(ctx)).some(r=>r.contactId===added.contactId),false);
 const opted=await CrmService.createContact(ctx,{name:"Opted",email:"opted@test.local",marketingConsent:true});assert.equal((await CrmService.getMarketingRecipients(ctx)).some(r=>r.contactId===opted.contactId),true);
 await CrmService.revokeConsent(ctx,opted.contactId);assert.equal((await CrmService.getMarketingRecipients(ctx)).some(r=>r.contactId===opted.contactId),false);
 await assert.rejects(()=>CrmService.createContact(ctx,{name:"Bad",email:"bad@test.local",accountId:"other-org-account"}),/客戶不存在/);
 await assert.rejects(()=>CrmService.createTicket(ctx,{subject:"",slaHours:24}),/主旨/);await assert.rejects(()=>CrmService.createTicket(ctx,{subject:"Bad SLA",slaHours:-1}),/SLA/);
 assert.equal(CrmService.ticketDueAt("2026-10-30T09:00:00.000Z",2),"2026-11-02T02:00:00.000Z");
 const activity=await CrmService.createActivity(ctx,{subject:"Call",dueDate:"2026-11-02T01:00:00.000Z"});await CrmService.completeActivity(ctx,activity.id);await CrmService.completeActivity(ctx,activity.id);await assert.rejects(()=>CrmService.completeActivity(ctx,"foreign-id"),/不存在/);
 const quote=await CrmService.createQuote(ctx,{opportunityId:`crm_opp_01_${org}`,itemName:"Service",quantity:2,unitPrice:100});await CrmService.approveQuote(ctx,quote.id);await assert.rejects(()=>CrmService.approveQuote(ctx,quote.id),/鎖定/);
 const [snapshot]=await db.select().from(crmQuotes).where(eq(crmQuotes.id,quote.id));assert.equal(snapshot.totalAmount,200);assert.equal(snapshot.isLocked,true);
 const conversions=await Promise.all([CrmService.convertLead(ctx,{leadId:`crm_lead_01_${org}`,dealAmount:0}),CrmService.convertLead(ctx,{leadId:`crm_lead_01_${org}`,dealAmount:0})]);assert.equal(conversions[0].opportunityId,conversions[1].opportunityId);
 const opps=await db.select().from(crmOpportunities).where(and(eq(crmOpportunities.organizationId,org),eq(crmOpportunities.id,conversions[0].opportunityId!)));assert.equal(opps.length,1);assert.equal(opps[0].amount,0);
 await assert.rejects(()=>CrmService.createQuote({...ctx,role:"readonly"},{opportunityId:opps[0].id,itemName:"No",quantity:1,unitPrice:1}),/唯讀/);
});
