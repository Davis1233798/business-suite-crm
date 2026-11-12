import { expect, test } from '@playwright/test';

test('CRM back office persists a contact and a support ticket', async ({ page }) => {
  await page.goto('/crm/login');
  await page.getByLabel('Email', { exact: true }).fill('office@suite.test');
  await page.getByLabel('Password', { exact: true }).fill('SuiteDemo!2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/crm\/back/);

  const support = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Contacts, consent and support', exact: true }),
  });
  await support.getByLabel('Customer', { exact: true }).selectOption({ index: 1 });
  const nonce = Date.now();
  const email = `support-${nonce}@example.test`;
  const subject = `Browser support ticket ${nonce}`;
  await support.getByLabel('Name', { exact: true }).fill('Browser Contact');
  await support.getByLabel('Email', { exact: true }).fill(email);
  await support.getByRole('checkbox', { name: 'Contact explicitly agrees to marketing emails' }).check();
  await support.getByRole('button', { name: 'Create contact', exact: true }).click();
  await expect(support.getByRole('status')).toHaveText('Contact created');

  const contact = support.getByLabel('Ticket contact', { exact: true });
  await contact.selectOption({ label: `Browser Contact · ${email}` });
  const contactId = await contact.inputValue();
  await support.getByLabel('Ticket subject').fill(subject);
  await support.getByLabel('SLA business hours').fill('8');
  await support.getByRole('button', { name: 'Create support ticket' }).click();
  await expect(support.getByRole('status')).toHaveText(/^Ticket created: TCK-.+Due: \d{4}-/);

  const response = await page.request.get('/api/stations/crm/data?view=back');
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  expect(data.contacts).toContainEqual(expect.objectContaining({ email }));
  expect(data.tickets).toContainEqual(expect.objectContaining({ subject, contactId, slaHours: 8, status: 'new' }));
});
