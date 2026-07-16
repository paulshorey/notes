import { expect, test } from '@playwright/test';
import { loadMarkdown, openHarness } from './support/harness';

test.beforeEach(async ({ page }) => openHarness(page));

test('task checkbox keeps its size and marker footprint across themes', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await loadMarkdown(page, '- [ ] task', { theme });
    const checkbox = page.locator('.cm-atomic-task-checkbox');
    const layout = await checkbox.evaluate((element) => {
      const style = getComputedStyle(element);
      const line = element.closest('.cm-line');
      const lineFontSize = line ? parseFloat(getComputedStyle(line).fontSize) : 0;
      const width = element.getBoundingClientRect().width;
      return {
        footprint: lineFontSize
          ? (width + parseFloat(style.marginLeft) + parseFloat(style.marginRight)) /
            lineFontSize
          : 0,
        size: lineFontSize ? width / lineFontSize : 0,
      };
    });
    expect(layout.size).toBeCloseTo(1.05, 1);
    expect(layout.footprint).toBeCloseTo(1.2, 1);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
});

test('task checkbox retains keyboard focus in forced-colors mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await loadMarkdown(page, '- [ ] task');
  const checkbox = page.locator('.cm-atomic-task-checkbox');
  await checkbox.focus();

  const focus = await checkbox.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(focus.outlineStyle).toBe('solid');
  expect(focus.outlineWidth).toBe('2px');
  expect(focus.boxShadow).toBe('none');
});
