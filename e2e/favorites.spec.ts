import { expect, test, type Page } from '@playwright/test';
import { FAVORITES_STORAGE_KEY } from '../src/lib/favoriteStore';

/** 填写目标、聚焦采集区并按下同一组合，完成一次匹配判读。 */
async function judgeMatching(page: Page, combo: string): Promise<void> {
  await page.fill('#target-input', combo);
  await page.click('#capture-area');
  await page.keyboard.press(combo);
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
}

test('完成匹配后收藏，刷新页面载入收藏，选择后再次完成匹配', async ({
  page,
}) => {
  await page.goto('/');
  // 判读完成前收藏入口不可用。
  await expect(page.locator('#favorite-add-btn')).toBeDisabled();

  await judgeMatching(page, 'Control+Shift+A');
  await expect(page.locator('#favorite-add-btn')).toBeEnabled();
  await page.click('#favorite-add-btn');

  const feedback = page.locator('#favorite-feedback');
  await expect(feedback).toContainText('已收藏');
  await expect(feedback).toHaveClass(/hint/);

  const list = page.locator('#favorites-list .favorite-item');
  await expect(list).toHaveCount(1);
  await expect(list.first()).toHaveText('Control+Shift+A');

  // 刷新页面：从浏览器存储恢复，收藏仍在；目标输入不被自动预填。
  await page.reload();
  await expect(page.locator('#favorites-list .favorite-item')).toHaveCount(1);
  await expect(page.locator('#target-input')).toHaveValue('');
  await expect(page.locator('#favorites-recovered')).toHaveCount(0);

  // 选择收藏：经目标解析链路预填，且不改写当前地址。
  await page.click('.favorite-item[data-combo="Control+Shift+A"]');
  await expect(page.locator('#target-input')).toHaveValue('Control+Shift+A');
  await expect(page.locator('#target-canonical')).toHaveText(
    '规范目标：Control+Shift+A',
  );
  expect(new URL(page.url()).search).toBe('');

  // 选择后自动聚焦采集区等待复核，直接按键即可再次判读。
  expect(
    await page.evaluate(() => document.activeElement?.id),
  ).toBe('capture-area');
  await page.keyboard.press('Control+Shift+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
});

test('重复收藏按最近使用顺序去重，超出八项丢弃最久未使用项', async ({
  page,
}) => {
  await page.goto('/');

  await judgeMatching(page, 'Control+A');
  await page.click('#favorite-add-btn');
  await judgeMatching(page, 'Control+B');
  await page.click('#favorite-add-btn');

  let items = page.locator('#favorites-list .favorite-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('Control+B');
  await expect(items.nth(1)).toHaveText('Control+A');

  // 重复收藏已有的 Control+A：移动到最前，不新增条目。
  await judgeMatching(page, 'Control+A');
  await page.click('#favorite-add-btn');
  items = page.locator('#favorites-list .favorite-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('Control+A');
  await expect(items.nth(1)).toHaveText('Control+B');

  // 连续收藏至超出容量：C…I 共 7 个新目标，加上 A、B 达 9，最久未使用的 B 被丢弃。
  for (const key of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) {
    await judgeMatching(page, `Control+${key}`);
    await page.click('#favorite-add-btn');
  }
  items = page.locator('#favorites-list .favorite-item');
  await expect(items).toHaveCount(8);
  await expect(items.nth(0)).toHaveText('Control+I');
  await expect(items.nth(7)).toHaveText('Control+A');

  const combos = await items.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.combo),
  );
  expect(combos).not.toContain('Control+B');

  // 刷新后顺序与容量保持一致。
  await page.reload();
  items = page.locator('#favorites-list .favorite-item');
  await expect(items).toHaveCount(8);
  await expect(items.nth(0)).toHaveText('Control+I');
  await expect(items.nth(7)).toHaveText('Control+A');
});

test('存储写入被拒绝时保留当前判读且不显示收藏成功', async ({ page }) => {
  // 收藏键的 setItem 确定性抛错（配额/隐私模式），其他键照常写入。
  await page.addInitScript(
    (key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === key) {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        }
        return original.call(this, k, v);
      };
    },
    FAVORITES_STORAGE_KEY,
  );

  await page.goto('/');
  await judgeMatching(page, 'Control+A');
  await page.click('#favorite-add-btn');

  const feedback = page.locator('#favorite-feedback');
  await expect(feedback).toContainText('收藏失败');
  await expect(feedback).toHaveClass(/error/);

  // 现场保留：判读结论与目标不变，收藏列表为空。
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
  await expect(page.locator('#result-target')).toHaveText('Control+A');
  await expect(page.locator('#result-actual')).toHaveText('Control+A');
  await expect(page.locator('#target-input')).toHaveValue('Control+A');
  await expect(page.locator('#favorites-list')).toHaveCount(0);
  await expect(page.locator('#favorites-empty')).toBeVisible();

  // 刷新后确无任何收藏写入，判读链路仍可正常使用。
  await page.reload();
  await expect(page.locator('#favorites-list')).toHaveCount(0);
  await judgeMatching(page, 'Control+A');
});

test('存储内容损坏时丢弃无效项并展示可恢复提示，成功收藏后消除', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, raw]) => {
      // 仅在首次进入时种入损坏数据；reload 后须读到页面自身写入的干净列表。
      if (window.localStorage.getItem(key) === null) {
        window.localStorage.setItem(key, raw);
      }
    },
    [
      FAVORITES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        favorites: ['Control+A', 'Ctrl+B', 5, null, '', 'Meta+Z'],
      }),
    ] as [string, string],
  );

  await page.goto('/');
  const items = page.locator('#favorites-list .favorite-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('Control+A');
  await expect(items.nth(1)).toHaveText('Meta+Z');
  await expect(page.locator('#favorites-recovered')).toContainText('损坏');

  // 成功收藏一个新目标后，提示随干净列表的写入消除。
  await judgeMatching(page, 'Alt+Enter');
  await page.click('#favorite-add-btn');
  await expect(page.locator('#favorite-feedback')).toContainText('已收藏');
  await expect(page.locator('#favorites-recovered')).toHaveCount(0);

  // 刷新：存储已被干净列表覆盖，提示不再出现且列表完整。
  await page.reload();
  await expect(page.locator('#favorites-recovered')).toHaveCount(0);
  await expect(page.locator('#favorites-list .favorite-item')).toHaveCount(3);
  await expect(
    page.locator('#favorites-list .favorite-item').nth(0),
  ).toHaveText('Alt+Enter');
});

test('无收藏数据时单次判读、差异诊断、复测与下载等原流程可用', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#favorites-list')).toHaveCount(0);
  await expect(page.locator('#favorites-empty')).toBeVisible();
  await expect(page.locator('#favorite-feedback')).toHaveCount(0);
  await expect(page.locator('#favorites-recovered')).toHaveCount(0);

  // 单次判读与差异诊断。
  await page.fill('#target-input', 'Control+A');
  await page.click('#capture-area');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#result-verdict')).toHaveText('不匹配');
  await expect(page.locator('#diff-main-key')).toContainText('目标 A');
  await expect(page.locator('#download-btn')).toBeEnabled();

  // 连续复测与汇总。
  await page.fill('#target-input', 'Control+A');
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#retest-summary')).toBeVisible();
  await expect(page.locator('#summary-pass-rate')).toHaveText('100%');
});

test('载入收藏清除旧单次结果、终止复测并使旧分享反馈失效，但不改写地址', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-write']);
  await page.goto('/?from=owner#top');

  // 先收藏一个目标，供复测进行中选择。
  await judgeMatching(page, 'Control+A');
  await page.click('#favorite-add-btn');

  // 制造旧的单次判读结果与旧分享反馈。
  await page.fill('#target-input', 'Control+B');
  await page.click('#capture-area');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
  await page.click('#copy-share-link-btn');
  await expect(page.locator('#share-feedback')).toContainText('已复制');

  // 发起一次进行中的连续复测（1/2）。
  await page.fill('#sample-count-input', '2');
  await page.click('#retest-start-btn');
  await page.keyboard.press('Control+B');
  await expect(page.locator('#retest-progress')).toContainText('1 / 2');

  // 选择收藏 Control+A：旧单次结果清除、复测终止、旧分享反馈失效。
  await page.click('.favorite-item[data-combo="Control+A"]');
  await expect(page.locator('#result')).toHaveCount(0);
  await expect(page.locator('#retest-progress')).toHaveCount(0);
  await expect(page.locator('#retest-summary')).toHaveCount(0);
  await expect(page.locator('#retest-cancel-btn')).toHaveCount(0);
  await expect(page.locator('#share-feedback')).toHaveCount(0);

  // 目标经解析链路预填，地址保持原样（未写入 target 参数）。
  await expect(page.locator('#target-input')).toHaveValue('Control+A');
  const url = new URL(page.url());
  expect(url.searchParams.get('target')).toBeNull();
  expect(url.searchParams.get('from')).toBe('owner');
  expect(url.hash).toBe('#top');

  // 采集区已聚焦，直接按键完成复核判读。
  expect(
    await page.evaluate(() => document.activeElement?.id),
  ).toBe('capture-area');
  await page.keyboard.press('Control+A');
  await expect(page.locator('#result-verdict')).toHaveText('匹配');
});
