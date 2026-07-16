import { expect, test } from '@playwright/test';
import { MARKDOWN_CONTRACTS } from '../../src/__tests__/fixtures/markdown-contracts';
import { getMarkdown, loadMarkdown, openHarness } from './support/harness';

test.beforeEach(async ({ page }) => openHarness(page));

test.describe('Markdown rendering contracts', () => {
  for (const contract of MARKDOWN_CONTRACTS) {
    test(contract.name, async ({ page }) => {
      await loadMarkdown(page, contract.markdown);
      const content = page.locator('.cm-content');

      for (const text of contract.containsText ?? []) {
        await expect(content).toContainText(text);
      }
      for (const text of contract.notContainsText ?? []) {
        await expect(content).not.toContainText(text);
      }
      for (const selector of contract.selectors ?? []) {
        const matches = page.locator(selector.selector);
        await expect(matches).toHaveCount(selector.count);
        if (selector.text !== undefined) {
          await expect(matches.first()).toHaveText(selector.text);
        }
      }
      expect(await getMarkdown(page)).toBe(contract.markdown);
    });
  }
});
