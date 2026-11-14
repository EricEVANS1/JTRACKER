import { daysFromNow, expect, test, USER_ID } from './support/mockSupabase';

for (const archived of [false, true]) {
  test(`confirms deletion of an ${archived ? 'archived' : 'active'} application in the app`, async ({ page, supabase }) => {
    const date = daysFromNow(-1);
    supabase.seed('applications', [{
      id: 'delete-me', user_id: USER_ID, role_title: 'QA Analyst',
      status: archived ? 'archived' : 'applied', archived,
      date_applied: date, updated_at: date, created_at: date,
      companies: { id: 'company-1', name: 'Example Co' },
    }]);
    await page.goto(archived ? '/archived' : '/applications');
    const trigger = page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Delete application?' });
    await expect(dialog).toContainText('QA Analyst at Example Co');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(supabase.writes('applications')).toHaveLength(0);

    await trigger.click();
    await dialog.getByRole('button', { name: 'Delete application' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('QA Analyst', { exact: true })).toHaveCount(0);
    expect(supabase.writes('applications')).toEqual([
      expect.objectContaining({ method: 'DELETE', query: expect.stringContaining('id=eq.delete-me') }),
    ]);
  });
}
