import { describe, expect, it } from 'vitest';
import { addFavorite, FAVORITE_LIMIT, restoreFavorites } from './favorites';

describe('收藏的最近使用顺序与去重', () => {
  it('新收藏插到最前，既有项保持原相对顺序', () => {
    const once = addFavorite([], 'Control+A');
    expect(once).toEqual(['Control+A']);

    const twice = addFavorite(once, 'Control+B');
    expect(twice).toEqual(['Control+B', 'Control+A']);

    const thrice = addFavorite(twice, 'Alt+C');
    expect(thrice).toEqual(['Alt+C', 'Control+B', 'Control+A']);
  });

  it('重复收藏既有项时去重并移动到最前，不新增条目', () => {
    const initial = ['Alt+C', 'Control+B', 'Control+A'];

    const repeatLast = addFavorite(initial, 'Control+A');
    expect(repeatLast).toEqual(['Control+A', 'Alt+C', 'Control+B']);

    const repeatMiddle = addFavorite(repeatLast, 'Alt+C');
    expect(repeatMiddle).toEqual(['Alt+C', 'Control+A', 'Control+B']);

    // 连续重复同一项：列表保持稳定，长度不变。
    const repeatSame = addFavorite(repeatMiddle, 'Alt+C');
    expect(repeatSame).toEqual(['Alt+C', 'Control+A', 'Control+B']);
    expect(repeatSame).toHaveLength(3);
  });

  it('重复收藏是纯函数：不修改入参列表', () => {
    const initial = Object.freeze(['Control+B', 'Control+A']);
    const next = addFavorite(initial, 'Control+A');
    expect(next).toEqual(['Control+A', 'Control+B']);
    expect([...initial]).toEqual(['Control+B', 'Control+A']);
  });
});

describe('收藏容量上限八项', () => {
  it('收藏到第九项时丢弃最久未使用的末尾项', () => {
    let favorites: string[] = [];
    for (let i = 0; i < FAVORITE_LIMIT; i += 1) {
      favorites = addFavorite(favorites, `Control+${String.fromCharCode(65 + i)}`);
    }
    expect(favorites).toEqual([
      'Control+H',
      'Control+G',
      'Control+F',
      'Control+E',
      'Control+D',
      'Control+C',
      'Control+B',
      'Control+A',
    ]);
    expect(favorites).toHaveLength(FAVORITE_LIMIT);

    // 第九个不同目标：最早的 Control+A 被丢弃。
    const overflow = addFavorite(favorites, 'Meta+Z');
    expect(overflow).toEqual([
      'Meta+Z',
      'Control+H',
      'Control+G',
      'Control+F',
      'Control+E',
      'Control+D',
      'Control+C',
      'Control+B',
    ]);
    expect(overflow).toHaveLength(FAVORITE_LIMIT);
    expect(overflow).not.toContain('Control+A');
  });

  it('满容量时重复收藏末尾项只前移不丢其他项，结果仍为八项', () => {
    let favorites: string[] = [];
    for (let i = 0; i < FAVORITE_LIMIT; i += 1) {
      favorites = addFavorite(favorites, `Control+${String.fromCharCode(65 + i)}`);
    }
    const refreshed = addFavorite(favorites, 'Control+A');
    expect(refreshed).toHaveLength(FAVORITE_LIMIT);
    expect(refreshed[0]).toBe('Control+A');
    expect(refreshed).toContain('Control+H');
    // 前移后 Control+B 成为新的最久未使用项。
    expect(refreshed[FAVORITE_LIMIT - 1]).toBe('Control+B');
  });
});

describe('从存储恢复时剔除损坏记录', () => {
  it('混合损坏记录：丢弃无效项并保留有效项，同时报告丢弃条数', () => {
    const raw = [
      'Control+Shift+A',
      'Ctrl+A', // 未知按键名称
      'control+alt+a', // 非规范写法但可经解析链路归一，保留
      42, // 非字符串
      null,
      { combo: 'Meta+Z' }, // 非字符串
      'Control+Control+B', // 修饰键重复
      '', // 缺少主键
      'Control+Alt+Shift+Meta+A', // 超过三个修饰键
      'Meta+Z',
      'A+B', // 含多个主键
      'Enter',
    ];
    const { favorites, dropped } = restoreFavorites(raw);
    expect(favorites).toEqual([
      'Control+Shift+A',
      'Control+Alt+A',
      'Meta+Z',
      'Enter',
    ]);
    expect(dropped).toBe(8);
  });

  it('同一规范组合的重复记录只保留最先出现的一条，重复计入丢弃数', () => {
    const { favorites, dropped } = restoreFavorites([
      'control+shift+a',
      'Control+Shift+A',
      'CONTROL+SHIFT+A',
      'Alt+Space',
    ]);
    expect(favorites).toEqual(['Control+Shift+A', 'Alt+Space']);
    expect(dropped).toBe(2);
  });

  it('全部损坏时返回空列表并按条数报告', () => {
    const { favorites, dropped } = restoreFavorites([
      'Ctrl+A',
      1,
      null,
      undefined,
    ]);
    expect(favorites).toEqual([]);
    expect(dropped).toBe(4);
  });

  it('有效记录超过八项时保留按存储顺序最靠前的八项，其余计入丢弃数', () => {
    const raw = Array.from(
      { length: FAVORITE_LIMIT + 3 },
      (_, i) => `Control+${String.fromCharCode(65 + i)}`,
    );
    const { favorites, dropped } = restoreFavorites(raw);
    expect(favorites).toHaveLength(FAVORITE_LIMIT);
    expect(favorites[0]).toBe('Control+A');
    expect(favorites[FAVORITE_LIMIT - 1]).toBe('Control+H');
    expect(dropped).toBe(3);
  });

  it('空记录恢复为空列表且丢弃数为零', () => {
    expect(restoreFavorites([])).toEqual({ favorites: [], dropped: 0 });
  });

  it('结果对相同输入确定：多次恢复完全一致', () => {
    const raw = ['Meta+Z', 'Ctrl+X', 7, 'Control+A', 'Meta+Z', ''];
    const first = restoreFavorites(raw);
    const second = restoreFavorites(raw);
    expect(second).toEqual(first);
    expect(first.favorites).toEqual(['Meta+Z', 'Control+A']);
    expect(first.dropped).toBe(4);
  });
});
