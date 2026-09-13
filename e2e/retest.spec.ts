import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('连续采集直至汇总：计数、通过率与分组按首次出现排列', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '3');
  await page.click('#retest-start-btn');

  // 开始复测后采集区自动聚焦，直接按键即可逐次入账。
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 0 / 3 次',
  );
  await expect(page.locator('#sample-count-input')).toBeDisabled();
  await expect(page.locator('#retest-start-btn')).toBeDisabled();

  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 3 次',
  );
  await page.keyboard.press('Control+B');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 2 / 3 次',
  );
  await page.keyboard.press('Control+A');

  // 达到次数后展示汇总：匹配次数、通过率、按首次出现排列的分组。
  await expect(page.locator('#retest-progress')).toHaveCount(0);
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-target')).toHaveText('Control+A');
  await expect(page.locator('#summary-matched')).toHaveText('2 / 3');
  await expect(page.locator('#summary-pass-rate')).toHaveText('67%');

  const groups = page.locator('#summary-groups li');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('Control+A');
  await expect(groups.nth(0)).toContainText('2');
  await expect(groups.nth(1)).toContainText('Control+B');
  await expect(groups.nth(1)).toContainText('1');
});

test('复测期间遇到不支持的主键只提示未计入，不推进进度', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');

  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 2 次',
  );

  // Tab 不是受支持的主键：提示本次未计入及原因，进度不变。
  await page.keyboard.press('Tab');
  await expect(page.locator('#retest-notice')).toContainText('本次未计入');
  await expect(page.locator('#retest-notice')).toContainText('Tab');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 2 次',
  );

  // 后续有效按键正常入账直至完成，提示随之清除。
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-notice')).toHaveCount(0);
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-matched')).toHaveText('2 / 2');
  await expect(page.locator('#summary-pass-rate')).toHaveText('100%');
});

test('修改目标立即终止并清空复测会话', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '3');
  await page.click('#retest-start-btn');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 3 次',
  );

  // 修改目标：会话立即终止，进度与采样控件恢复初始状态。
  await page.fill('#target-input', 'Control+B');
  await expect(page.locator('#retest-progress')).toHaveCount(0);
  await expect(page.locator('#retest-summary')).toHaveCount(0);
  await expect(page.locator('#retest-cancel-btn')).toHaveCount(0);
  await expect(page.locator('#sample-count-input')).toBeEnabled();
  await expect(page.locator('#retest-start-btn')).toBeEnabled();

  // 会话已清空：采集区恢复单次判读。
  await page.click('#capture-area');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
});

test('取消复测后恢复单次判读', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '3');
  await page.click('#retest-start-btn');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 3 次',
  );

  await page.click('#retest-cancel-btn');
  await expect(page.locator('#retest-progress')).toHaveCount(0);
  await expect(page.locator('#retest-cancel-btn')).toHaveCount(0);

  // 取消后采集区恢复单次判读，下载条件不变。
  await page.click('#capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-actual')).toHaveText('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
  await expect(page.locator('#download-btn')).toBeEnabled();
});

test('长按主键产生的重复 keydown 不推进采集进度', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');

  // 一次物理按下：首个 keydown 正常入账。
  await page.locator('#capture-area').dispatchEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
  });
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 2 次',
  );

  // 长按期间系统自动重复的 keydown（repeat=true）不计入。
  await page.locator('#capture-area').dispatchEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
    repeat: true,
  });
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 2 次',
  );

  // 下一次真实按下才推进并完成。
  await page.locator('#capture-area').dispatchEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
  });
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-matched')).toHaveText('2 / 2');
});

test('布局与物理键位不一致时保留实际输入的字母', async ({ page }) => {
  await page.fill('#target-input', 'A');
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');

  // AZERTY 场景：标为 A 的键物理位置是 KeyQ，两次输入都应记为 A。
  for (let i = 0; i < 2; i += 1) {
    await page.locator('#capture-area').dispatchEvent('keydown', {
      key: 'a',
      code: 'KeyQ',
    });
  }
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-matched')).toHaveText('2 / 2');
  await expect(page.locator('#summary-pass-rate')).toHaveText('100%');
  await expect(page.locator('#summary-groups .group-combo')).toHaveText('A');
});

test('同时按下四个修饰键与字母：提示本次未计入且不推进进度', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 2 次',
  );

  // 四个修饰键同时按下超出规则上限：提示本次未计入及原因，进度不变。
  await page.locator('#capture-area').dispatchEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
    metaKey: true,
  });
  await expect(page.locator('#retest-notice')).toContainText('本次未计入');
  await expect(page.locator('#retest-notice')).toContainText('超过三个');
  await expect(page.locator('#retest-progress')).toHaveText(
    '复测进行中：已采集 1 / 2 次',
  );

  // 后续有效按键正常入账直至完成，提示随之清除。
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-notice')).toHaveCount(0);
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-matched')).toHaveText('2 / 2');
});

test('复测进行中不产生单次判读结果，下载保持禁用', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');
  await page.keyboard.press('Control+A');

  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.locator('#download-btn')).toBeDisabled();
});
