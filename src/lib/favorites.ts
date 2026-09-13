/**
 * 本地收藏目标的领域模型。
 *
 * 收藏只保存 parseCombo 产出的规范组合字符串：
 * - 顺序即最近使用（MRU）顺序，最近收藏/选用的项位于最前；
 * - 按规范组合去重，重复收藏既有项时将其移动到最前而非新增；
 * - 容量固定为 FAVORITE_LIMIT（8），超限时丢弃最久未使用的末尾项。
 *
 * 本模块不接触任何浏览器 API：读取恢复时的损坏剔除、写入容量与顺序
 * 均在此处确定，浏览器适配层（favoriteStore）只负责序列化与读写。
 */

import { parseCombo } from './shortcut';

export const FAVORITE_LIMIT = 8;

/**
 * 将一次收藏并入既有列表，返回新的 MRU 列表：
 * 入参须为规范组合；重复项移动到最前，超出容量时截断末尾。
 */
export function addFavorite(
  favorites: readonly string[],
  canonical: string,
): string[] {
  const next = [canonical, ...favorites.filter((item) => item !== canonical)];
  return next.slice(0, FAVORITE_LIMIT);
}

/**
 * 从浏览器存储恢复收藏：逐项走与目标输入相同的 parseCombo 链路，
 * 丢弃无效项、重复项（保留最先出现的一条）与超出容量的尾部项。
 * dropped 为被丢弃的原始记录数（含无效与重复），供页面展示可恢复提示。
 */
export function restoreFavorites(raw: readonly unknown[]): {
  favorites: string[];
  dropped: number;
} {
  const favorites: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const item of raw) {
    if (typeof item !== 'string') {
      dropped += 1;
      continue;
    }
    let canonical: string;
    try {
      canonical = parseCombo(item);
    } catch {
      // parseCombo 对非法组合抛 ShortcutParseError，损坏记录一律丢弃。
      dropped += 1;
      continue;
    }
    if (seen.has(canonical)) {
      dropped += 1;
      continue;
    }
    seen.add(canonical);
    if (favorites.length < FAVORITE_LIMIT) {
      favorites.push(canonical);
    } else {
      dropped += 1;
    }
  }

  return { favorites, dropped };
}
