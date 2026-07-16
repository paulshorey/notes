import { expect, test } from '@playwright/test';
import { loadMarkdown, openHarness } from './support/harness';

test.beforeEach(async ({ page }) => openHarness(page));

test('@smoke fenced-code backdrop stays behind a dragged text selection', async ({ page }) => {
  await loadMarkdown(
    page,
    ['before', '', '```ts', 'const selected = true;', 'const second = 2;', '```', '', 'after'].join(
      '\n',
    ),
  );

  const codeLine = page.locator('.cm-line.cm-atomic-fenced-code').nth(1);
  const secondCodeLine = page.locator('.cm-line.cm-atomic-fenced-code').nth(2);
  const codeBox = await codeLine.boundingBox();
  const secondCodeBox = await secondCodeLine.boundingBox();
  expect(codeBox).not.toBeNull();
  expect(secondCodeBox).not.toBeNull();
  if (!codeBox || !secondCodeBox) return;
  await page.mouse.move(codeBox.x + 16, codeBox.y + codeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    secondCodeBox.x + 150,
    secondCodeBox.y + secondCodeBox.height / 2,
    { steps: 10 },
  );

  const selection = page.locator('.cm-selectionBackground').first();
  await expect(selection).toBeVisible();
  const selectedCode = page.locator('.cm-atomic-fenced-selection');
  // Assert before pointerup: the duplicate paint must track the drag live,
  // even though the rest of inline preview is frozen until release.
  await expect(selectedCode).not.toHaveCount(0);
  await expect(selectedCode.first()).toContainText('selected');
  await page.mouse.up();

  const selectionBox = await selection.boundingBox();
  expect(selectionBox).not.toBeNull();
  expect(selectionBox?.y ?? 0).toBeLessThan(codeBox.y + codeBox.height);
  expect((selectionBox?.y ?? 0) + (selectionBox?.height ?? 0)).toBeGreaterThan(codeBox.y);

  const paint = await selectedCode.first().evaluate((selectionMark) => {
    return {
      codeBackground: getComputedStyle(selectionMark.closest('.cm-line')!).backgroundColor,
      selectionBackground: getComputedStyle(selectionMark).backgroundColor,
    };
  });

  expect(paint.codeBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(paint.selectionBackground).not.toBe('rgba(0, 0, 0, 0)');
});
