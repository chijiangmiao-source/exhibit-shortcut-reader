import { describe, expect, it } from 'vitest';
import {
  comboFromEvent,
  isModifierOnlyKey,
  mainKeyFromEvent,
  parseCombo,
  ShortcutParseError,
  type KeyEventLike,
} from './shortcut';

function event(partial: Partial<KeyEventLike> & { key: string; code: string }): KeyEventLike {
  return {
    getModifierState: () => false,
    ...partial,
  };
}

describe('parseCombo 规范化', () => {
  it('忽略大小写并将字母主键转为大写', () => {
    expect(parseCombo('control+shift+a')).toBe('Control+Shift+A');
    expect(parseCombo('CONTROL+ALT+b')).toBe('Control+Alt+B');
    expect(parseCombo('meta+z')).toBe('Meta+Z');
  });

  it('修饰键固定按 Control、Alt、Shift、Meta 排列', () => {
    expect(parseCombo('Shift+Control+A')).toBe('Control+Shift+A');
    expect(parseCombo('Meta+Alt+Shift+K')).toBe('Alt+Shift+Meta+K');
    expect(parseCombo('shift+alt+control+9')).toBe('Control+Alt+Shift+9');
  });

  it('允许零到三个修饰键，主键可单独存在', () => {
    expect(parseCombo('A')).toBe('A');
    expect(parseCombo('Control+Alt+Shift+Enter')).toBe('Control+Alt+Shift+Enter');
  });

  it('支持数字与命名主键（忽略大小写）', () => {
    expect(parseCombo('0')).toBe('0');
    expect(parseCombo('Control+7')).toBe('Control+7');
    expect(parseCombo('enter')).toBe('Enter');
    expect(parseCombo('SPACE')).toBe('Space');
    expect(parseCombo('Alt+escape')).toBe('Alt+Escape');
  });

  it('忽略每个名称首尾空白', () => {
    expect(parseCombo('  Control + Shift + A  ')).toBe('Control+Shift+A');
  });

  it('重复修饰键报错', () => {
    expect(() => parseCombo('Control+Control+A')).toThrow(ShortcutParseError);
    expect(() => parseCombo('Control+control+A')).toThrow(/修饰键重复/);
    expect(() => parseCombo('SHIFT+shift+B')).toThrow(/修饰键重复/);
  });

  it('超过三个修饰键报错', () => {
    expect(() => parseCombo('Control+Alt+Shift+Meta+A')).toThrow(/超过三个/);
  });

  it('未知名称报错', () => {
    expect(() => parseCombo('Ctrl+A')).toThrow(/未知按键名称/);
    expect(() => parseCombo('Control+Foo')).toThrow(/未知按键名称/);
    expect(() => parseCombo('Tab')).toThrow(/未知按键名称/);
    expect(() => parseCombo('F1')).toThrow(/未知按键名称/);
  });

  it('缺少主键报错', () => {
    expect(() => parseCombo('Control')).toThrow(/缺少主键/);
    expect(() => parseCombo('Control+Shift')).toThrow(/缺少主键/);
  });

  it('多个主键报错', () => {
    expect(() => parseCombo('A+B')).toThrow(/多个主键/);
    expect(() => parseCombo('Control+A+1')).toThrow(/多个主键/);
    expect(() => parseCombo('Enter+Space')).toThrow(/多个主键/);
  });

  it('空目标视为缺少主键', () => {
    expect(() => parseCombo('')).toThrow(/缺少主键/);
    expect(() => parseCombo('   ')).toThrow(/缺少主键/);
  });

  it('空名称报错', () => {
    expect(() => parseCombo('Control++A')).toThrow(/空的按键名称/);
    expect(() => parseCombo('Control+A+')).toThrow(/空的按键名称/);
  });
});

describe('isModifierOnlyKey', () => {
  it('仅修饰键本身返回 true', () => {
    expect(isModifierOnlyKey('Control')).toBe(true);
    expect(isModifierOnlyKey('Alt')).toBe(true);
    expect(isModifierOnlyKey('Shift')).toBe(true);
    expect(isModifierOnlyKey('Meta')).toBe(true);
    expect(isModifierOnlyKey('A')).toBe(false);
    expect(isModifierOnlyKey('Enter')).toBe(false);
  });
});

describe('mainKeyFromEvent', () => {
  it('依据物理键位 code 识别字母与数字', () => {
    expect(mainKeyFromEvent(event({ key: 'a', code: 'KeyA' }))).toBe('A');
    expect(mainKeyFromEvent(event({ key: 'A', code: 'KeyA' }))).toBe('A');
    expect(mainKeyFromEvent(event({ key: '5', code: 'Digit5' }))).toBe('5');
  });

  it('Shift+数字产生符号字符时仍归一为数字主键', () => {
    expect(mainKeyFromEvent(event({ key: '!', code: 'Digit1' }))).toBe('1');
    expect(mainKeyFromEvent(event({ key: '@', code: 'Digit2' }))).toBe('2');
  });

  it('识别 Enter、Space、Escape 及旧式别名', () => {
    expect(mainKeyFromEvent(event({ key: 'Enter', code: 'Enter' }))).toBe('Enter');
    expect(mainKeyFromEvent(event({ key: ' ', code: 'Space' }))).toBe('Space');
    expect(mainKeyFromEvent(event({ key: 'Spacebar', code: 'Space' }))).toBe('Space');
    expect(mainKeyFromEvent(event({ key: 'Escape', code: 'Escape' }))).toBe('Escape');
    expect(mainKeyFromEvent(event({ key: 'Esc', code: 'Escape' }))).toBe('Escape');
  });

  it('回退到 key 识别单字符（如小键盘数字）', () => {
    expect(mainKeyFromEvent(event({ key: 'q', code: '' }))).toBe('Q');
    expect(mainKeyFromEvent(event({ key: '3', code: 'Numpad3' }))).toBe('3');
  });

  it('不支持的主键返回 null', () => {
    expect(mainKeyFromEvent(event({ key: 'F1', code: 'F1' }))).toBeNull();
    expect(mainKeyFromEvent(event({ key: 'Tab', code: 'Tab' }))).toBeNull();
    expect(mainKeyFromEvent(event({ key: '-', code: 'Minus' }))).toBeNull();
  });
});

describe('comboFromEvent', () => {
  it('按固定顺序输出修饰键并大写主键', () => {
    const e = event({
      key: 'a',
      code: 'KeyA',
      getModifierState: (name) => name === 'Shift' || name === 'Control',
    });
    expect(comboFromEvent(e)).toBe('Control+Shift+A');
  });

  it('左右同名修饰键归一（getModifierState 不区分左右）', () => {
    const left = event({
      key: 'b',
      code: 'KeyB',
      getModifierState: (name) => name === 'Control',
    });
    const right = event({
      key: 'b',
      code: 'KeyB',
      getModifierState: (name) => name === 'Control',
    });
    expect(comboFromEvent(left)).toBe('Control+B');
    expect(comboFromEvent(right)).toBe('Control+B');
  });

  it('无修饰键时仅输出主键', () => {
    expect(comboFromEvent(event({ key: 'Enter', code: 'Enter' }))).toBe('Enter');
    expect(comboFromEvent(event({ key: ' ', code: 'Space' }))).toBe('Space');
  });

  it('主键不受支持时返回 null', () => {
    expect(comboFromEvent(event({ key: 'F5', code: 'F5' }))).toBeNull();
  });
});
