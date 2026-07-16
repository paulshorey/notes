import { expect, test } from '@playwright/test';
import {
  focusEditor,
  getMarkdown,
  loadMarkdown,
  openHarness,
} from './support/harness';

test.beforeEach(async ({ page }) => openHarness(page));

test('@smoke mounts, renders, and edits in a real browser', async ({ page }) => {
  await loadMarkdown(page, '# Browser smoke\n\n==highlighted==');
  await expect(page.locator('.cm-atomic-h1')).toContainText('Browser smoke');
  await expect(page.locator('.cm-atomic-highlight')).toHaveText('highlighted');

  await focusEditor(page);
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('browser edit');
  await expect.poll(() => getMarkdown(page)).toContain('browser edit');
});

test('@smoke read-only mode keeps the content surface inert', async ({ page }) => {
  const markdown = '# Read only\n\nBody';
  await loadMarkdown(page, markdown, { readOnly: true });
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.locator('.cm-content').click();
  await page.keyboard.type('should not appear');
  expect(await getMarkdown(page)).toBe(markdown);
});
