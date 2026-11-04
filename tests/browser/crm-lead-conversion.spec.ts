import {test,expect} from '@playwright/test';
async function signIn(page:import('@playwright/test').Page,email='office@suite.test'){
 await page.goto('/crm/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('SuiteDemo!2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/crm\/back/);
}
test('CRM operator creates, qualifies and converts a persisted lead',async({page})=>{
 await signIn(page);const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Lead qualification and conversion'})});
 const email=`crm-browser-${Date.now()}@example.test`;await panel.getByLabel('Lead name').fill('Browser Buyer');await panel.getByLabel('Company').fill('Browser Acceptance Co');await panel.getByLabel('Email').fill(email);await panel.getByLabel('Phone').fill('555-0101');await panel.getByRole('button',{name:'Create lead',exact:true}).click();
 const data=await (await page.request.get('/api/stations/crm/data?view=back')).json();const lead=data.data.leads.find((r:{email:string})=>r.email===email);expect(lead).toBeTruthy();expect(lead.status).toBe('new');
 const row=panel.getByRole('row').filter({hasText:email});await row.getByRole('button',{name:'Qualify',exact:true}).click();await expect(row).toContainText('qualified');
 await row.getByLabel('Opportunity amount (minor units)').fill('87500');await row.getByLabel('Expected close date').fill('2027-03-31');
 await page.route('**/api/stations/crm/lead-convert',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({success:false,error:{message:'Conversion rejected for browser retry acceptance'}})}));
 await row.getByRole('button',{name:'Convert',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Conversion rejected');await expect(row.getByLabel('Opportunity amount (minor units)')).toHaveValue('87500');await expect(row.getByLabel('Expected close date')).toHaveValue('2027-03-31');await page.unroute('**/api/stations/crm/lead-convert');
 await row.getByRole('button',{name:'Convert',exact:true}).click();
 const persisted=await (await page.request.get('/api/stations/crm/data?view=back')).json();const converted=persisted.data.leads.find((r:{email:string})=>r.email===email);expect(converted.status).toBe('converted');expect(converted.convertedAccountId).toBeTruthy();expect(converted.convertedContactId).toBeTruthy();expect(converted.convertedOpportunityId).toBeTruthy();
 expect(persisted.data.accounts.some((r:{id:string})=>r.id===converted.convertedAccountId)).toBeTruthy();expect(persisted.data.contacts.some((r:{id:string})=>r.id===converted.convertedContactId)).toBeTruthy();const opportunity=persisted.data.opportunities.find((r:{id:string})=>r.id===converted.convertedOpportunityId);expect(opportunity.amount).toBe(87500);expect(opportunity.closeDate).toBe('2027-03-31');
});
test('front and read-only sessions cannot see CRM mutation controls',async({page})=>{
 await signIn(page,'viewer@suite.test');await expect(page.getByRole('heading',{name:'Lead qualification and conversion'})).toHaveCount(0);await page.goto('/crm/front');await expect(page.getByRole('heading',{name:'Lead qualification and conversion'})).toHaveCount(0);
});
