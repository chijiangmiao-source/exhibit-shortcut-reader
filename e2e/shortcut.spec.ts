import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('目标大小写与修饰键顺序不影响匹配判定', async ({ page }) => {
  await page.fill('#target-input', 'shift+control+a');
  await expect(page.locator('#target-canonical')).toHaveText(
    '规范目标：Control+Shift+A',
  );

  await page.click('#capture-area');
  await page.keyboard.press('Control+Shift+A');

  await expect(page.locator('#result-target')).toHaveText('Control+Shift+A');
  await expect(page.locator('#result-actual')).toHaveText('Control+Shift+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
});

test('实际组合与目标不一致时判定不匹配', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+B');

  await expect(page.locator('#result-target')).toHaveText('Control+A');
  await expect(page.locator('#result-actual')).toHaveText('Control+B');
  await expect(page.locator('#result-verdict')).toHaveText('不匹配');
});

test('焦点位于采集区外时按键被忽略', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  // fill 后焦点仍在输入框（采集区外），此处按键不应触发判读。
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result')).toHaveCount(0);

  await page.click('h1');
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('#result')).toHaveCount(0);
});

test('单独按下修饰键不进行判读', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await expect(page.locator('#result')).toHaveCount(0);
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await expect(page.locator('#result')).toHaveCount(0);

  await page.keyboard.press('a');
  await expect(page.locator('#result-actual')).toHaveText('A');
});

test('非法目标立即报错并清除旧结果', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');

  // 目标变为非法：立即报错，旧判读结果被清除。
  await page.fill('#target-input', 'Ctrl+A');
  await expect(page.locator('#target-error')).toContainText('未知按键名称');
  await expect(page.locator('#result')).toHaveCount(0);

  await page.fill('#target-input', 'Control+Control+A');
  await expect(page.locator('#target-error')).toContainText('修饰键重复');

  await page.fill('#target-input', 'Control+Alt+Shift+Meta+A');
  await expect(page.locator('#target-error')).toContainText('超过三个');

  await page.fill('#target-input', 'Control+Shift');
  await expect(page.locator('#target-error')).toContainText('缺少主键');

  await page.fill('#target-input', 'A+B');
  await expect(page.locator('#target-error')).toContainText('多个主键');
});

test('判读后清空目标立即提示目标无效', async ({ page }) => {
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');

  // 清空目标：立即报缺少主键，旧判读结果被清除，下载随之禁用。
  await page.fill('#target-input', '');
  await expect(page.locator('#target-error')).toContainText('缺少主键');
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.locator('#download-btn')).toBeDisabled();
});

test('判读完成后可下载 UTF-8 JSON 结果', async ({ page }) => {
  await page.fill('#target-input', 'control+shift+a');
  await page.click('#capture-area');
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#download-btn'),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const payload = JSON.parse(readFileSync(path!, 'utf-8'));
  expect(payload).toEqual({
    target: 'Control+Shift+A',
    actual: 'Control+Shift+A',
    match: true,
  });
});

test('未完成判读时下载按钮不可用', async ({ page }) => {
  await expect(page.locator('#download-btn')).toBeDisabled();
  await page.fill('#target-input', 'Control+A');
  await expect(page.locator('#download-btn')).toBeDisabled();
});
