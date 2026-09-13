import { describe, expect, it } from 'vitest';
import {
  buildTargetShareUrl,
  resolveTargetParam,
  TARGET_PARAM,
} from './share';

describe('目标分享链接的确定性往返', () => {
  it('各类规范目标写入 target 参数后可原样读回', () => {
    const cases = [
      'A',
      'Control+A',
      'Control+Shift+A',
      'Control+Alt+Shift+9',
      'Meta+Enter',
      'Alt+Escape',
      'Space',
    ];
    for (const canonical of cases) {
      const url = buildTargetShareUrl('http://localhost:5173/', canonical);
      expect(resolveTargetParam(url)).toEqual({ kind: 'valid', canonical });
    }
  });

  it('加号被百分号编码，不依赖查询串中的字面加号', () => {
    const url = buildTargetShareUrl(
      'http://localhost:5173/',
      'Control+Shift+A',
    );
    expect(url).toContain(`${TARGET_PARAM}=Control%2BShift%2BA`);
  });

  it('保留既有查询参数与锚点（含特殊字符地址）', () => {
    const base =
      'http://localhost:5173/' +
      '?note=%E4%BD%A0%E5%A5%BD+%E4%B8%96%E7%95%8C' +
      '&next=https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2' +
      '&empty=#capture';
    const url = buildTargetShareUrl(base, 'Control+Shift+A');

    const parsed = new URL(url);
    expect(parsed.searchParams.get('note')).toBe('你好 世界');
    expect(parsed.searchParams.get('next')).toBe(
      'https://example.com/?a=1&b=2',
    );
    expect(parsed.searchParams.get('empty')).toBe('');
    expect(parsed.hash).toBe('#capture');
    expect(resolveTargetParam(url)).toEqual({
      kind: 'valid',
      canonical: 'Control+Shift+A',
    });
  });

  it('已有 target 参数被替换而非追加，其余参数不受影响', () => {
    const url = buildTargetShareUrl(
      'http://localhost:5173/?target=Control%2BA&x=1',
      'Meta+Z',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.getAll(TARGET_PARAM)).toEqual(['Meta+Z']);
    expect(parsed.searchParams.get('x')).toBe('1');
  });

  it('解析侧同样走规范化链路：大小写与空白差异归一', () => {
    expect(
      resolveTargetParam('http://localhost:5173/?target=control%2Bshift%2Ba'),
    ).toEqual({ kind: 'valid', canonical: 'Control+Shift+A' });
    expect(
      resolveTargetParam(
        'http://localhost:5173/?target=+control+%2B+shift+%2B+a+',
      ),
    ).toEqual({ kind: 'valid', canonical: 'Control+Shift+A' });
  });
});

describe('target 参数缺失与非法拒绝', () => {
  it('缺失 target 参数时返回 absent', () => {
    expect(resolveTargetParam('http://localhost:5173/')).toEqual({
      kind: 'absent',
    });
    expect(resolveTargetParam('http://localhost:5173/?other=1#x')).toEqual({
      kind: 'absent',
    });
  });

  it('未知按键名称被拒绝并说明原因', () => {
    const result = resolveTargetParam('http://localhost:5173/?target=Ctrl%2BA');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('未知按键名称');
    }
  });

  it('四个修饰键的组合被领域规则拒绝', () => {
    const result = resolveTargetParam(
      'http://localhost:5173/?target=Control%2BAlt%2BShift%2BMeta%2BA',
    );
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('超过三个');
    }
  });

  it('空参数值视为缺少主键', () => {
    const result = resolveTargetParam('http://localhost:5173/?target=');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('缺少主键');
    }
  });

  it('未编码的字面加号被解码为空格后同样被拒绝', () => {
    // 手工拼接的 ?target=Control+Shift+A：加号按表单规则解码为空格，
    // 解析链路收到的是 "Control Shift A"，必须拒绝而非误判为合法。
    const result = resolveTargetParam(
      'http://localhost:5173/?target=Control+Shift+A',
    );
    expect(result.kind).toBe('invalid');
  });

  it('非法参数解析不抛异常', () => {
    expect(() =>
      resolveTargetParam('http://localhost:5173/?target=%26%3D%25'),
    ).not.toThrow();
  });
});
