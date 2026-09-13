import { describe, expect, it } from 'vitest';
import {
  FAVORITES_STORAGE_KEY,
  loadFavorites,
  saveFavorites,
  type FavoriteStorageLike,
} from './favoriteStore';

/** 简易内存存储，可配置读写抛错以模拟拒绝与不可用环境。 */
function memoryStorage(options?: {
  getItemThrows?: boolean;
  setItemThrows?: boolean;
}): FavoriteStorageLike & { readRaw(): string | null } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => {
      if (options?.getItemThrows) {
        throw new Error('storage disabled');
      }
      return map.has(key) ? map.get(key)! : null;
    },
    setItem: (key, value) => {
      if (options?.setItemThrows) {
        throw new Error('quota exceeded');
      }
      map.set(key, value);
    },
    readRaw: () => (map.has(FAVORITES_STORAGE_KEY) ? map.get(FAVORITES_STORAGE_KEY)! : null),
  };
}

describe('收藏的写入与读取往返', () => {
  it('写入的规范列表可原样读回，且使用固定存储键与版本结构', () => {
    const storage = memoryStorage();
    const favorites = ['Meta+Z', 'Control+Shift+A', 'Enter'];
    expect(saveFavorites(storage, favorites)).toBe(true);

    const raw = storage.readRaw();
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ version: 1, favorites });

    expect(loadFavorites(storage).favorites).toEqual(favorites);
  });

  it('空列表同样可往返', () => {
    const storage = memoryStorage();
    expect(saveFavorites(storage, [])).toBe(true);
    expect(loadFavorites(storage)).toEqual({ favorites: [], dropped: 0 });
  });
});

describe('存储内容损坏', () => {
  it('整体 JSON 损坏时按空列表恢复且不抛异常', () => {
    const storage = memoryStorage();
    saveFavorites(storage, ['Control+A']);
    storage.setItem(FAVORITES_STORAGE_KEY, '{not-json');
    expect(loadFavorites(storage)).toEqual({ favorites: [], dropped: 0 });
  });

  it('外层形态不符（非对象、缺版本、favorites 非数组）时按空列表恢复', () => {
    const storage = memoryStorage();

    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(['Control+A']));
    expect(loadFavorites(storage)).toEqual({ favorites: [], dropped: 0 });

    storage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({ favorites: ['Control+A'] }),
    );
    expect(loadFavorites(storage)).toEqual({ favorites: [], dropped: 0 });

    storage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({ version: 1, favorites: 'Control+A' }),
    );
    expect(loadFavorites(storage)).toEqual({ favorites: [], dropped: 0 });
  });

  it('混合损坏记录：丢弃无效项、保留有效项并报告丢弃条数', () => {
    const storage = memoryStorage();
    storage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        favorites: [
          'Control+A',
          'Ctrl+B',
          9,
          null,
          'Control+Alt+Shift+Meta+A',
          'Meta+Z',
        ],
      }),
    );
    expect(loadFavorites(storage)).toEqual({
      favorites: ['Control+A', 'Meta+Z'],
      dropped: 4,
    });
  });

  it('无存储记录时返回空列表', () => {
    expect(loadFavorites(memoryStorage())).toEqual({
      favorites: [],
      dropped: 0,
    });
  });
});

describe('存储不可用或写入被拒绝', () => {
  it('getItem 抛错时按空列表恢复且不抛异常', () => {
    expect(loadFavorites(memoryStorage({ getItemThrows: true }))).toEqual({
      favorites: [],
      dropped: 0,
    });
  });

  it('setItem 抛错时返回 false 且不抛异常', () => {
    const storage = memoryStorage({ setItemThrows: true });
    expect(saveFavorites(storage, ['Control+A'])).toBe(false);
  });
});
