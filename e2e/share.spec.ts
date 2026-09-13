import { expect, test } from '@playwright/test';

test('复制的目标链接在新页面自动预填并完成一次匹配', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?from=owner#top');
  await page.fill('#target-input', 'control+shift+a');
  await expect(page.locator('#target-canonical')).toHaveText(
    '规范目标：Control+Shift+A',
  );

  await page.click('#copy-share-link-btn');
  await expect(page.locator('#share-feedback')).toContainText('已复制');

  // 链接保留既有查询参数与锚点，规范目标写入 target 参数。
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = new URL(shareUrl);
  expect(parsed.searchParams.get('target')).toBe('Control+Shift+A');
  expect(parsed.searchParams.get('from')).toBe('owner');
  expect(parsed.hash).toBe('#top');

  // 异地测试员打开链接：目标自动预填，聚焦采集区即可完成一次判读。
  const reviewer = await context.newPage();
  await reviewer.goto(shareUrl);
  await expect(reviewer.locator('#target-input')).toHaveValue(
    'Control+Shift+A',
  );
  await expect(reviewer.locator('#target-canonical')).toHaveText(
    '规范目标：Control+Shift+A',
  );
  await expect(reviewer.locator('#link-target-error')).toHaveCount(0);

  await reviewer.click('#capture-area');
  await reviewer.keyboard.press('Control+Shift+A');
  await expect(reviewer.locator('#result-target')).toHaveText(
    'Control+Shift+A',
  );
  await expect(reviewer.locator('#result-actual')).toHaveText(
    'Control+Shift+A',
  );
  await expect(reviewer.locator('#result-verdict')).toHaveText('匹配');
});

test('剪贴板拒绝时保留目标并提示复制失败', async ({ page }) => {
  // 注入确定性的剪贴板拒绝，避免依赖浏览器权限默认值。
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: () =>
          Promise.reject(new DOMException('denied', 'NotAllowedError')),
      },
      configurable: true,
    });
  });
  await page.goto('/');
  await page.fill('#target-input', 'Control+A');
  await expect(page.locator('#target-canonical')).toHaveText(
    '规范目标：Control+A',
  );

  await page.click('#copy-share-link-btn');
  await expect(page.locator('#share-feedback')).toContainText('复制失败');

  // 目标保留，单次判读流程不受影响。
  await expect(page.locator('#target-input')).toHaveValue('Control+A');
  await expect(page.locator('#target-canonical')).toHaveText(
    '规范目标：Control+A',
  );
  await page.click('#capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
});

test('无参数进入后原单次判读与连续复测流程可用', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#target-input')).toHaveValue('');
  await expect(page.locator('#link-target-error')).toHaveCount(0);
  await expect(page.locator('#share-feedback')).toHaveCount(0);

  // 单次判读流程。
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');

  // 连续复测流程。
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-matched')).toHaveText('2 / 2');
  await expect(page.locator('#summary-pass-rate')).toHaveText('100%');
});

test('链接中的非法目标不落入页面状态并在目标区域说明', async ({ page }) => {
  await page.goto('/?target=Ctrl%2BA');
  await expect(page.locator('#link-target-error')).toContainText(
    '链接中的目标组合无效',
  );
  await expect(page.locator('#link-target-error')).toContainText(
    '未知按键名称',
  );
  await expect(page.locator('#target-input')).toHaveValue('');
  await expect(page.locator('#target-canonical')).toHaveCount(0);
  await expect(page.locator('#target-error')).toHaveCount(0);

  // 页面仍可正常使用：手工填写有效目标后完成判读。
  await page.fill('#target-input', 'Control+A');
  await expect(page.locator('#link-target-error')).toHaveCount(0);
  await page.click('#capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
});
