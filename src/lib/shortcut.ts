/**
 * 快捷键组合的解析与规范化。
 *
 * 规则：
 * - 修饰键仅允许 Control、Alt、Shift、Meta（忽略大小写，左右同名视为同键）。
 * - 主键仅允许 A-Z、0-9、Enter、Space、Escape（忽略大小写，字母转为大写）。
 * - 规范字符串中修饰键固定按 Control、Alt、Shift、Meta 排列，主键位于末尾。
 * - 重复修饰键、未知名称、缺少主键、多个主键、超过三个修饰键均报错。
 */

export const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Meta'] as const;
export type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_BY_LOWER_NAME: Record<string, Modifier> = {
  control: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
};

const NAMED_MAIN_KEYS: Record<string, string> = {
  ENTER: 'Enter',
  SPACE: 'Space',
  ESCAPE: 'Escape',
};

export class ShortcutParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShortcutParseError';
  }
}

/**
 * 解析由加号连接的组合描述，返回规范字符串。
 * 输入非法时抛出 ShortcutParseError。
 */
export function parseCombo(input: string): string {
  // 整体为空（含纯空白）的组合没有任何按键，直接视为缺少主键。
  if (input.trim() === '') {
    throw new ShortcutParseError('缺少主键');
  }
  const tokens = input.split('+').map((token) => token.trim());
  const modifiers = new Set<Modifier>();
  const mainKeys: string[] = [];

  for (const token of tokens) {
    if (token === '') {
      throw new ShortcutParseError('存在空的按键名称');
    }
    const modifier = MODIFIER_BY_LOWER_NAME[token.toLowerCase()];
    if (modifier) {
      if (modifiers.has(modifier)) {
        throw new ShortcutParseError(`修饰键重复：${modifier}`);
      }
      modifiers.add(modifier);
      continue;
    }
    if (token.length === 1 && /^[a-zA-Z0-9]$/.test(token)) {
      mainKeys.push(token.toUpperCase());
      continue;
    }
    const named = NAMED_MAIN_KEYS[token.toUpperCase()];
    if (named) {
      mainKeys.push(named);
      continue;
    }
    throw new ShortcutParseError(`未知按键名称：${token}`);
  }

  if (modifiers.size > 3) {
    throw new ShortcutParseError('修饰键超过三个');
  }
  if (mainKeys.length === 0) {
    throw new ShortcutParseError('缺少主键');
  }
  if (mainKeys.length > 1) {
    throw new ShortcutParseError('含有多个主键');
  }

  const ordered = MODIFIER_ORDER.filter((name) => modifiers.has(name));
  return [...ordered, mainKeys[0]].join('+');
}

/** 两个规范组合之间的结构化差异。 */
export interface ComboDiff {
  /** 目标有而实际缺失的修饰键，按 Control、Alt、Shift、Meta 固定次序排列。 */
  readonly missingModifiers: readonly Modifier[];
  /** 实际多按的修饰键，次序同上。 */
  readonly extraModifiers: readonly Modifier[];
  /** 主键不同时给出目标主键与实际主键；相同则为 null。 */
  readonly mainKey: { readonly target: string; readonly actual: string } | null;
}

/**
 * 比较两个规范组合，返回结构化差异诊断。
 * 输入须为 parseCombo 规范化后的字符串；完全匹配时返回空差异。
 */
export function diffCombos(target: string, actual: string): ComboDiff {
  const targetParts = target.split('+');
  const actualParts = actual.split('+');
  const targetMainKey = targetParts[targetParts.length - 1];
  const actualMainKey = actualParts[actualParts.length - 1];
  const targetModifiers = new Set(targetParts.slice(0, -1));
  const actualModifiers = new Set(actualParts.slice(0, -1));
  return {
    missingModifiers: MODIFIER_ORDER.filter(
      (name) => targetModifiers.has(name) && !actualModifiers.has(name),
    ),
    extraModifiers: MODIFIER_ORDER.filter(
      (name) => actualModifiers.has(name) && !targetModifiers.has(name),
    ),
    mainKey:
      targetMainKey === actualMainKey
        ? null
        : { target: targetMainKey, actual: actualMainKey },
  };
}

/** 判读所需的键盘事件最小接口，便于在 Node 环境下测试。 */
export interface KeyEventLike {
  key: string;
  code: string;
  getModifierState(modifier: string): boolean;
}

/** 判断事件是否只是按下了修饰键本身（此时不进行判读）。 */
export function isModifierOnlyKey(key: string): boolean {
  return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta';
}

/**
 * 从键盘事件提取主键的规范名称；不支持的主键返回 null。
 * 字母优先取 key 的实际输入字符，兼容字母位置与物理键位不同的布局
 * （如 AZERTY 上标为 A 的键物理位置是 KeyQ，应记录实际输入的 A）；
 * key 不是单字母时回退到物理键位 code。
 * 数字优先依据物理键位 code（Digit1），使 Shift+1 等组合不受符号字符影响；
 * 其余按键回退到 key。
 */
export function mainKeyFromEvent(event: KeyEventLike): string | null {
  const { code, key } = event;
  if (key.length === 1 && /^[a-zA-Z]$/.test(key)) {
    return key.toUpperCase();
  }
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (key === 'Enter') {
    return 'Enter';
  }
  if (key === ' ' || key === 'Spacebar') {
    return 'Space';
  }
  if (key === 'Escape' || key === 'Esc') {
    return 'Escape';
  }
  if (key.length === 1 && /^[0-9]$/.test(key)) {
    return key;
  }
  return null;
}

/**
 * 从键盘事件生成规范组合字符串。
 * 修饰键通过 getModifierState 读取，左右同名修饰键天然归一。
 * 主键不受支持时返回 null。
 */
export function comboFromEvent(event: KeyEventLike): string | null {
  const mainKey = mainKeyFromEvent(event);
  if (mainKey === null) {
    return null;
  }
  const modifiers = MODIFIER_ORDER.filter((name) => event.getModifierState(name));
  return [...modifiers, mainKey].join('+');
}
