import { expect, test } from '@playwright/test';
import {
  focusEditor,
  getMarkdown,
  loadMarkdown,
  openHarness,
} from './support/harness';

test.beforeEach(async ({ page }) => openHarness(page));

test('continuation lines follow parsed list depth', async ({ page }) => {
  const markdown = [
    '- [ ] root no',
    'root continuation',
    '  - [ ] nested no',
    '    nested continuation',
    '',
    'separator',
    '',
    '   - odd top level',
    '     odd continuation',
    '     1. ordered child',
    '        ordered continuation',
  ].join('\n');
  await loadMarkdown(page, markdown);

  const positions = await page.locator('.cm-content').evaluate((content) => {
    const leftFor = (text: string) => {
      const line = Array.from(content.querySelectorAll('.cm-line')).find(
        (candidate) => (candidate.textContent ?? '').includes(text),
      );
      if (!line) return null;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = (node.nodeValue ?? '').indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return range.getBoundingClientRect().left;
      }
      return null;
    };
    return {
      root: leftFor('root no'),
      rootContinuation: leftFor('root continuation'),
      nested: leftFor('nested no'),
      nestedContinuation: leftFor('nested continuation'),
      odd: leftFor('odd top level'),
      oddContinuation: leftFor('odd continuation'),
      ordered: leftFor('ordered child'),
      orderedContinuation: leftFor('ordered continuation'),
    };
  });

  const aligned = (a: number | null, b: number | null) => {
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThan(1);
  };
  aligned(positions.root, positions.rootContinuation);
  aligned(positions.nested, positions.nestedContinuation);
  aligned(positions.odd, positions.oddContinuation);
  aligned(positions.ordered, positions.orderedContinuation);
  aligned(positions.root, positions.odd);
  expect(positions.nested ?? 0).toBeGreaterThan(positions.root ?? 0);
  expect(positions.ordered ?? 0).toBeGreaterThan(positions.odd ?? 0);
  expect(await getMarkdown(page)).toBe(markdown);
});

test('typing an asterisk list marker does not leave a trailing star', async ({ page }) => {
  await loadMarkdown(page, '');
  await focusEditor(page);
  await page.keyboard.type('* item');

  await expect.poll(() => getMarkdown(page)).toBe('* item');
  await expect(page.locator('.cm-line')).toHaveText('•item');
});
