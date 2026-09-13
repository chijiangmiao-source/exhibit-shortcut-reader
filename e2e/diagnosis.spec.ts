import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('不匹配后展示结构化诊断：缺失、多余与主键差异可区分', async ({
  page,
}) => {
  // 缺失修饰键：目标 Control+Shift+A，实际漏按 Shift。
  await page.fill('#target-input', 'Control+Shift+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('不匹配');
  await expect(page.locator('#diff-missing')).toHaveText('缺失修饰键：Shift');
  await expect(page.locator('#diff-extra')).toHaveCount(0);
  await expect(page.locator('#diff-main-key')).toHaveCount(0);

  // 多余修饰键：目标 Control+A，实际误加 Alt。
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+Alt+A');
  await expect(page.locator('#diff-extra')).toHaveText('多余修饰键：Alt');
  await expect(page.locator('#diff-missing')).toHaveCount(0);
  await expect(page.locator('#diff-main-key')).toHaveCount(0);

  // 主键偏移：目标 Control+A，实际按下 Control+B。
  await page.keyboard.press('Control+B');
  await expect(page.locator('#diff-main-key')).toHaveText(
    '主键不同：目标 A，实际 B',
  );
  await expect(page.locator('#diff-missing')).toHaveCount(0);
  await expect(page.locator('#diff-extra')).toHaveCount(0);

  // 完全匹配时不展示诊断。
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
  await expect(page.locator('#diff-diagnosis')).toHaveCount(0);
});

test('按实际组合更新目标后重新采集成功', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#result-verdict')).toHaveText('不匹配');

  await page.click('#update-target-btn');

  // 目标经解析链路更新，旧判读结果清除，等待下一次采集。
  await expect(page.locator('#target-input')).toHaveValue('Control+B');
  await expect(page.locator('#target-canonical')).toHaveText(
    '规范目标：Control+B',
  );
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.locator('#download-btn')).toBeDisabled();

  // 更新后采集区已聚焦，直接按下新组合完成判读。
  await page.keyboard.press('Control+B');
  await expect(page.locator('#result-target')).toHaveText('Control+B');
  await expect(page.locator('#result-actual')).toHaveText('Control+B');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
});

test('领域校验拒绝更新时保留原目标与本次判读', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');

  // 四个修饰键的实际组合超出规则上限，无法作为新目标。
  await page.locator('#capture-area').dispatchEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
    metaKey: true,
  });
  await expect(page.locator('#result-actual')).toHaveText(
    'Control+Alt+Shift+Meta+A',
  );
  await expect(page.locator('#result-verdict')).toHaveText('不匹配');

  await page.click('#update-target-btn');

  // 就地说明拒绝原因，原目标与本次判读保持不变。
  await expect(page.locator('#update-error')).toContainText('超过三个');
  await expect(page.locator('#target-input')).toHaveValue('Control+A');
  await expect(page.locator('#result-target')).toHaveText('Control+A');
  await expect(page.locator('#result-actual')).toHaveText(
    'Control+Alt+Shift+Meta+A',
  );
  await expect(page.locator('#result-verdict')).toHaveText('不匹配');
});

test('不匹配判读的 JSON 下载结构保持不变', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#result-verdict')).toHaveText('不匹配');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#download-btn'),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const payload = JSON.parse(readFileSync(path!, 'utf-8'));
  expect(payload).toEqual({
    target: 'Control+A',
    actual: 'Control+B',
    match: false,
  });
});

test('连续复测进行中及汇总页不出现更新目标入口', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');

  // 复测进行中：无更新入口。
  await page.keyboard.press('Control+B');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 2 次',
  );
  await expect(page.locator('#update-target-btn')).toHaveCount(0);

  // 复测完成展示汇总：仍无更新入口。
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-matched')).toHaveText('1 / 2');
  await expect(page.locator('#update-target-btn')).toHaveCount(0);
});
