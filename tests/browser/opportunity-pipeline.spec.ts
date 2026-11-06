import {test,expect} from '@playwright/test';

async function signIn(page:import('@playwright/test').Page,email='admin@suite.test'){
 await page.goto('/crm/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('SuiteDemo!2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/crm\/back/);
}

test('pipeline transition persists, rejects a stale view, and supports localized mobile controls',async({page})=>{
 await signIn(page);
 const send=async(path:string,input:Record<string,unknown>,status=200)=>{const response=await page.request.post('/api/stations/crm/'+path,{data:input});expect(response.status()).toBe(status);return (await response.json()).data;};
 const lead=await send('leads',{name:'Pipeline browser fixture',company:'Fictional pipeline',email:crypto.randomUUID()+'@example.test'},201);
 await send('lead-qualify',{leadId:lead.id});
 const converted=await send('lead-convert',{leadId:lead.id,amount:105,closeDate:'2035-01-15'});
 await page.reload();
 const getData=async()=>(await(await page.request.get('/api/stations/crm/data?view=back')).json()).data;
 const initial=await getData();
 const opportunity=initial.opportunities.find((row:{id:string})=>row.id===converted.opportunityId);
 const won=initial.stages.find((row:{isWon:boolean|number})=>row.isWon);
 const other=initial.stages.find((row:{id:string;isWon:boolean|number;isLost:boolean|number})=>!row.isWon&&!row.isLost&&row.id!==opportunity.stageId);
 expect(won).toBeTruthy();expect(other).toBeTruthy();
 const panel=page.getByRole('region',{name:'Opportunity pipeline',exact:true});
 await panel.getByRole('combobox',{name:'Opportunity',exact:true}).selectOption(opportunity.id);
 await panel.getByRole('combobox',{name:'Target stage',exact:true}).selectOption(won.id);
 await expect(panel.getByRole('button',{name:'Update stage',exact:true})).toBeDisabled();
 await panel.getByRole('textbox',{name:'Transition reason',exact:true}).fill('Signed agreement');
 await send('opportunity-stage',{opportunityId:opportunity.id,expectedStageId:opportunity.stageId,stageId:other.id,reason:'Parallel operator',requestId:crypto.randomUUID()});
 await panel.getByRole('button',{name:'Update stage',exact:true}).click();
 await expect(panel.getByRole('alert')).toBeVisible();
 await expect(panel.getByRole('textbox',{name:'Transition reason',exact:true})).toHaveValue('Signed agreement');
 await page.reload();
 await panel.getByRole('combobox',{name:'Opportunity',exact:true}).selectOption(opportunity.id);
 await panel.getByRole('combobox',{name:'Target stage',exact:true}).selectOption(won.id);
 await panel.getByRole('textbox',{name:'Transition reason',exact:true}).fill('Signed agreement');
 await panel.getByRole('button',{name:'Update stage',exact:true}).click();
 await expect(panel.getByRole('status')).toContainText('Opportunity stage updated');
 const saved=(await getData()).opportunities.find((row:{id:string})=>row.id===opportunity.id);
 expect(saved).toMatchObject({stageId:won.id,status:'won',probability:100,amount:105,weightedAmount:105,wonReason:'Signed agreement'});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.evaluate(()=>localStorage.setItem('suite-language','zh-TW'));await page.reload();
 await expect(page.getByRole('region',{name:'商機階段流程',exact:true})).toBeVisible();
});

test('read-only identities do not receive pipeline mutation controls',async({page})=>{
 await signIn(page,'viewer@suite.test');await expect(page.getByRole('region',{name:'Opportunity pipeline',exact:true})).toHaveCount(0);
});
