/**
 * 连续复测的领域模型。
 *
 * - RetestSample：单次有效样本（规范化组合 + 是否命中目标）。
 * - RetestSession：一次复测会话，持有进度、样本与完成态，
 *   逐次入账并在达到计划采样数后生成汇总。
 * - RetestSummary：不可变汇总结果，页面只消费该结果；
 *   分组按组合首次出现顺序排列。
 * - 非法样本（无法规范化或与规范形式不一致）拒绝入账，不推进进度。
 */

import { parseCombo, ShortcutParseError } from './shortcut';

export const MIN_SAMPLE_COUNT = 2;
export const MAX_SAMPLE_COUNT = 10;

export class RetestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetestError';
  }
}

/** 单次有效样本：规范化后的实际组合及是否命中目标。 */
export interface RetestSample {
  readonly combo: string;
  readonly matched: boolean;
}

/** 某一实际组合的计数分组，按首次出现顺序排列。 */
export interface ComboCount {
  readonly combo: string;
  readonly count: number;
}

/** 复测完成后的不可变汇总结果。 */
export interface RetestSummary {
  readonly target: string;
  readonly total: number;
  readonly matchedCount: number;
  /** 0–1 之间的小数，由页面决定展示格式。 */
  readonly passRate: number;
  readonly groups: readonly ComboCount[];
}

/** 会话状态快照：进度、样本与完成态，供页面消费。 */
export interface RetestSessionState {
  readonly target: string;
  readonly planned: number;
  readonly recorded: number;
  readonly remaining: number;
  readonly samples: readonly RetestSample[];
  readonly completed: boolean;
  readonly summary: RetestSummary | null;
}

function assertValidSampleCount(count: number): number {
  if (
    !Number.isInteger(count) ||
    count < MIN_SAMPLE_COUNT ||
    count > MAX_SAMPLE_COUNT
  ) {
    throw new RetestError(
      `采样数须为 ${MIN_SAMPLE_COUNT}–${MAX_SAMPLE_COUNT} 的整数`,
    );
  }
  return count;
}

/** 解析采样数输入，须为 2–10 的整数。 */
export function parseSampleCount(input: string): number {
  return assertValidSampleCount(Number(input));
}

/** 由样本序列计算不可变汇总；分组按组合首次出现顺序排列。 */
export function summarizeSamples(
  target: string,
  samples: readonly RetestSample[],
): RetestSummary {
  const groups: ComboCount[] = [];
  const indexByCombo = new Map<string, number>();
  let matchedCount = 0;

  for (const sample of samples) {
    if (sample.matched) {
      matchedCount += 1;
    }
    const index = indexByCombo.get(sample.combo);
    if (index === undefined) {
      indexByCombo.set(sample.combo, groups.length);
      groups.push(Object.freeze({ combo: sample.combo, count: 1 }));
    } else {
      const previous = groups[index];
      groups[index] = Object.freeze({
        combo: previous.combo,
        count: previous.count + 1,
      });
    }
  }

  const total = samples.length;
  return Object.freeze({
    target,
    total,
    matchedCount,
    passRate: total === 0 ? 0 : matchedCount / total,
    groups: Object.freeze(groups),
  });
}

/**
 * 一次复测会话：按计划采样数逐次入账有效样本，
 * 达到次数后生成不可变汇总。
 */
export class RetestSession {
  readonly target: string;
  readonly planned: number;
  private readonly samples: RetestSample[] = [];
  private summaryValue: RetestSummary | null = null;

  constructor(target: string, planned: number) {
    this.target = target;
    this.planned = assertValidSampleCount(planned);
  }

  get recorded(): number {
    return this.samples.length;
  }

  get remaining(): number {
    return this.planned - this.samples.length;
  }

  get completed(): boolean {
    return this.summaryValue !== null;
  }

  get summary(): RetestSummary | null {
    return this.summaryValue;
  }

  /**
   * 记录一次有效样本。仅接受与本工具规范形式一致的组合；
   * 非法样本抛错且不入账、不推进进度。达到计划次数后生成汇总。
   */
  record(combo: string): RetestSample {
    if (this.completed) {
      throw new RetestError('复测已完成，无法继续记录');
    }
    let canonical: string;
    try {
      canonical = parseCombo(combo);
    } catch (error) {
      const reason =
        error instanceof ShortcutParseError ? error.message : '组合无效';
      throw new RetestError(`非法样本未入账：${reason}`);
    }
    if (canonical !== combo) {
      throw new RetestError(`非法样本未入账：${combo} 不是规范形式`);
    }
    const sample: RetestSample = Object.freeze({
      combo,
      matched: combo === this.target,
    });
    this.samples.push(sample);
    if (this.samples.length === this.planned) {
      this.summaryValue = summarizeSamples(this.target, this.samples);
    }
    return sample;
  }

  /** 当前会话状态快照（进度、样本与完成态）。 */
  state(): RetestSessionState {
    return Object.freeze({
      target: this.target,
      planned: this.planned,
      recorded: this.recorded,
      remaining: this.remaining,
      samples: Object.freeze([...this.samples]),
      completed: this.completed,
      summary: this.summaryValue,
    });
  }
}
