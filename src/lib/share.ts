/**
 * 可分享目标链接：将规范目标写入地址的 target 查询参数，
 * 供异地测试员打开链接后自动预填目标组合。
 *
 * - 构建基于 URL / URLSearchParams：保留既有查询参数与锚点，
 *   加号等字符被确定性地百分号编码（Control+Shift+A → Control%2BShift%2BA），
 *   保证构建与解析的往返一致。
 * - 解析走与目标输入相同的 parseCombo 链路；
 *   非法参数不抛异常，以无效结果返回，由页面在目标区域就地说明。
 */

import { parseCombo, ShortcutParseError } from './shortcut';

export const TARGET_PARAM = 'target';

/** 链接中 target 参数的解析结果。 */
export type TargetParamResolution =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly canonical: string }
  | { readonly kind: 'invalid'; readonly reason: string };

/** 将规范目标写入当前地址的 target 查询参数，保留其他查询参数与锚点。 */
export function buildTargetShareUrl(
  currentUrl: string,
  canonicalTarget: string,
): string {
  const url = new URL(currentUrl);
  url.searchParams.set(TARGET_PARAM, canonicalTarget);
  return url.toString();
}

/**
 * 解析地址中的 target 查询参数：
 * 缺失返回 absent；合法返回规范组合；非法返回无效原因，不抛异常。
 */
export function resolveTargetParam(currentUrl: string): TargetParamResolution {
  const url = new URL(currentUrl);
  const raw = url.searchParams.get(TARGET_PARAM);
  if (raw === null) {
    return { kind: 'absent' };
  }
  try {
    return { kind: 'valid', canonical: parseCombo(raw) };
  } catch (error) {
    return {
      kind: 'invalid',
      reason:
        error instanceof ShortcutParseError ? error.message : '目标组合无效',
    };
  }
}
