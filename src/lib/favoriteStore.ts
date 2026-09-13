/**
 * 收藏列表的浏览器存储适配层。
 *
 * 仅负责在 localStorage 中读写收藏的规范组合数组：
 * - 序列化形态为 { version: 1, favorites: string[] }，存储键固定；
 * - 读取不抛异常：存储不可用、JSON 损坏或形态不符时返回空原始记录，
 *   交由领域层 restoreFavorites 逐项甄别；
 * - 写入不抛异常：存储被拒绝（隐私模式、配额、安全策略）时返回 false，
 *   调用方据此保留当前判读且不展示收藏成功。
 *
 * 顺序与容量由领域层负责，本层不做任何组合校验或截断。
 */

import { restoreFavorites } from './favorites';

export const FAVORITES_STORAGE_KEY = 'shortcut-judge:favorites';
const STORAGE_VERSION = 1;

/** localStorage 在当前页面的最小接口，便于在 Node 环境下注入测试。 */
export interface FavoriteStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type SerializedFavorites = {
  readonly version: number;
  favorites: unknown;
};

function isSerializedFavorites(value: unknown): value is SerializedFavorites {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { version?: unknown }).version === STORAGE_VERSION
  );
}

/**
 * 读取收藏：返回经领域层甄别后的规范组合列表、逐项丢弃条数与整体损坏标志。
 * - 存储缺失或不可读：空列表、corrupted=false（无法判定曾有数据，不提示）；
 * - JSON 无法解析或外层形态不符：曾有数据但整体不可读，corrupted=true，
 *   调用方须提示数据已被丢弃；
 * - 外层有效但数组内存在被剔除的项：corrupted=false，由 dropped 计数提示。
 */
export function loadFavorites(storage: FavoriteStorageLike): {
  favorites: string[];
  dropped: number;
  corrupted: boolean;
} {
  let raw: string | null;
  try {
    raw = storage.getItem(FAVORITES_STORAGE_KEY);
  } catch {
    return { favorites: [], dropped: 0, corrupted: false };
  }
  if (raw === null) {
    return { favorites: [], dropped: 0, corrupted: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 存储中确有内容但无法解析：旧数据整体不可恢复，须提示已丢弃。
    return { favorites: [], dropped: 0, corrupted: true };
  }
  if (!isSerializedFavorites(parsed) || !Array.isArray(parsed.favorites)) {
    return { favorites: [], dropped: 0, corrupted: true };
  }
  return { ...restoreFavorites(parsed.favorites), corrupted: false };
}

/**
 * 写入收藏：成功返回 true；setItem 抛错（写入被拒绝）时返回 false。
 * 调用方必须在 false 时保留当前判读且不展示收藏成功。
 */
export function saveFavorites(
  storage: FavoriteStorageLike,
  favorites: readonly string[],
): boolean {
  const payload = JSON.stringify({
    version: STORAGE_VERSION,
    favorites,
  });
  try {
    storage.setItem(FAVORITES_STORAGE_KEY, payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前页面的 localStorage；沙箱等环境下访问该属性本身即抛错，
 * 此时返回 null，由调用方按存储不可用处理。
 */
export function getBrowserLocalStorage(): FavoriteStorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
