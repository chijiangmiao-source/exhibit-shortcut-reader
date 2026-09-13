import { describe, expect, it } from 'vitest';
import {
  MAX_SAMPLE_COUNT,
  MIN_SAMPLE_COUNT,
  parseSampleCount,
  RetestError,
  RetestSession,
  summarizeSamples,
  type RetestSample,
} from './retest';

describe('parseSampleCount', () => {
  it('接受 2–10 的整数', () => {
    expect(parseSampleCount('2')).toBe(2);
    expect(parseSampleCount('10')).toBe(10);
    expect(parseSampleCount(' 5 ')).toBe(5);
    expect(MIN_SAMPLE_COUNT).toBe(2);
    expect(MAX_SAMPLE_COUNT).toBe(10);
  });

  it('拒绝越界、非整数与非数字输入', () => {
    for (const bad of ['1', '11', '2.5', 'abc', '']) {
      expect(() => parseSampleCount(bad)).toThrow(RetestError);
      expect(() => parseSampleCount(bad)).toThrow(/采样数/);
    }
  });
});

describe('RetestSession 计数', () => {
  it('逐次入账并推进进度，达到次数后生成汇总', () => {
    const session = new RetestSession('Control+A', 3);
    expect(session.completed).toBe(false);
    expect(session.summary).toBeNull();

    session.record('Control+A');
    session.record('Control+B');
    expect(session.recorded).toBe(2);
    expect(session.remaining).toBe(1);
    expect(session.completed).toBe(false);

    session.record('Control+A');
    expect(session.completed).toBe(true);
    const summary = session.summary;
    expect(summary).not.toBeNull();
    expect(summary!.target).toBe('Control+A');
    expect(summary!.total).toBe(3);
    expect(summary!.matchedCount).toBe(2);
    expect(summary!.passRate).toBeCloseTo(2 / 3);
  });

  it('样本标记是否命中目标', () => {
    const session = new RetestSession('Control+Shift+A', 2);
    expect(session.record('Control+Shift+A').matched).toBe(true);
    expect(session.record('Control+Shift+B').matched).toBe(false);
  });

  it('构造时校验采样数范围', () => {
    for (const bad of [1, 11, 2.5, Number.NaN]) {
      expect(() => new RetestSession('A', bad)).toThrow(RetestError);
    }
  });

  it('完成后拒绝继续记录', () => {
    const session = new RetestSession('A', 2);
    session.record('A');
    session.record('A');
    expect(() => session.record('A')).toThrow(/已完成/);
    expect(session.recorded).toBe(2);
  });

  it('state 快照包含进度、样本与完成态', () => {
    const session = new RetestSession('Control+A', 2);
    session.record('Control+A');
    const running = session.state();
    expect(running.completed).toBe(false);
    expect(running.recorded).toBe(1);
    expect(running.remaining).toBe(1);
    expect(running.planned).toBe(2);
    expect(running.samples).toEqual([
      { combo: 'Control+A', matched: true },
    ]);
    expect(running.summary).toBeNull();

    session.record('Control+B');
    const done = session.state();
    expect(done.completed).toBe(true);
    expect(done.remaining).toBe(0);
    expect(done.summary).not.toBeNull();
    expect(done.summary!.matchedCount).toBe(1);
  });
});

describe('稳定分组', () => {
  it('各实际组合按首次出现顺序排列次数', () => {
    const session = new RetestSession('Control+A', 5);
    for (const combo of [
      'Control+B',
      'Control+A',
      'Control+B',
      'Control+C',
      'Control+A',
    ]) {
      session.record(combo);
    }
    const groups = session.summary!.groups;
    expect(groups.map((group) => [group.combo, group.count])).toEqual([
      ['Control+B', 2],
      ['Control+A', 2],
      ['Control+C', 1],
    ]);
  });

  it('全部一致时分组仅含目标组合', () => {
    const session = new RetestSession('Alt+Enter', 3);
    session.record('Alt+Enter');
    session.record('Alt+Enter');
    session.record('Alt+Enter');
    const summary = session.summary!;
    expect(summary.matchedCount).toBe(3);
    expect(summary.passRate).toBe(1);
    expect(summary.groups).toEqual([{ combo: 'Alt+Enter', count: 3 }]);
  });
});

describe('非法样本不入账', () => {
  it('无法规范化的组合抛错且不推进进度', () => {
    const session = new RetestSession('Control+A', 2);
    expect(() => session.record('F1')).toThrow(RetestError);
    expect(() => session.record('Ctrl+A')).toThrow(/未知按键名称/);
    expect(() => session.record('A+B')).toThrow(/多个主键/);
    expect(session.recorded).toBe(0);
    expect(session.remaining).toBe(2);
    expect(session.summary).toBeNull();
  });

  it('非规范形式的组合抛错且不入账', () => {
    const session = new RetestSession('Control+A', 2);
    expect(() => session.record('control+a')).toThrow(/规范形式/);
    expect(() => session.record('Shift+Control+A')).toThrow(/规范形式/);
    expect(session.recorded).toBe(0);
  });

  it('非法样本之后仍可正常入账直至完成', () => {
    const session = new RetestSession('A', 2);
    expect(() => session.record('Tab')).toThrow(RetestError);
    session.record('A');
    session.record('B');
    expect(session.completed).toBe(true);
    expect(session.summary!.matchedCount).toBe(1);
  });
});

describe('summarizeSamples', () => {
  it('汇总为不可变结构', () => {
    const samples: RetestSample[] = [
      { combo: 'A', matched: true },
      { combo: 'B', matched: false },
    ];
    const summary = summarizeSamples('A', samples);
    expect(summary.total).toBe(2);
    expect(summary.matchedCount).toBe(1);
    expect(summary.passRate).toBe(0.5);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.groups)).toBe(true);
    expect(summary.groups.every((group) => Object.isFrozen(group))).toBe(true);
  });

  it('空样本序列通过率为 0 且无分组', () => {
    const summary = summarizeSamples('A', []);
    expect(summary.total).toBe(0);
    expect(summary.matchedCount).toBe(0);
    expect(summary.passRate).toBe(0);
    expect(summary.groups).toEqual([]);
  });
});
