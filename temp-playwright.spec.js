const { test, expect } = require('playwright/test');

test('smoke', async ({ page }) => {
  await page.setContent('<html><body><div id="x">ok</div></body></html>');
  await expect(page.locator('#x')).toHaveText('ok');
});
