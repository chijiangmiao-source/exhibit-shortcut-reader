<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  comboFromEvent,
  diffCombos,
  isModifierOnlyKey,
  parseCombo,
  ShortcutParseError,
} from './lib/shortcut';
import {
  parseSampleCount,
  RetestError,
  RetestSession,
  type RetestSessionState,
} from './lib/retest';
import { buildTargetShareUrl, resolveTargetParam } from './lib/share';
import {
  addFavorite,
  FAVORITE_LIMIT,
} from './lib/favorites';
import {
  getBrowserLocalStorage,
  loadFavorites,
  saveFavorites,
} from './lib/favoriteStore';

const targetInput = ref('');
const targetCanonical = ref<string | null>(null);
const targetError = ref<string | null>(null);

// 分享链接：链接中非法目标的就地说明，以及复制结果反馈。
const linkTargetError = ref<string | null>(null);
const shareFeedback = ref<string | null>(null);
const shareFeedbackOk = ref(false);
// 剪贴板写入为异步：只接受最近一次复制请求的落盘结果，
// 目标变更或发起新复制都会使在途旧请求失效，避免过期反馈覆盖最新状态。
let copyRequestSeq = 0;

// 本地收藏：MRU 顺序的规范组合列表，从浏览器存储恢复，容量上限由领域层确定。
const favorites = ref<string[]>([]);
const favoriteFeedback = ref<string | null>(null);
const favoriteFeedbackOk = ref(false);
// 存储内容存在被剔除的损坏项：展示可恢复提示，下一次成功写入后消除。
const favoritesRecovered = ref(false);

const actualCanonical = ref<string | null>(null);
const actualError = ref<string | null>(null);
const match = ref<boolean | null>(null);
const updateError = ref<string | null>(null);

const captureAreaEl = ref<HTMLElement | null>(null);

// 复测会话：session 为可变工作者，页面只消费其不可变状态快照。
const sampleCountInput = ref('3');
const retestError = ref<string | null>(null);
const retestNotice = ref<string | null>(null);
const retestState = ref<RetestSessionState | null>(null);
let session: RetestSession | null = null;

const retestRunning = computed(
  () => retestState.value !== null && !retestState.value.completed,
);
const retestSummary = computed(() => retestState.value?.summary ?? null);
const passRateText = computed(() => {
  const summary = retestSummary.value;
  return summary === null ? '' : `${Math.round(summary.passRate * 100)}%`;
});

/** 终止并清空当前复测会话。 */
function terminateSession(): void {
  session = null;
  retestState.value = null;
  retestNotice.value = null;
}

/** 清除上一次判读结果。 */
function clearResult(): void {
  actualCanonical.value = null;
  actualError.value = null;
  match.value = null;
  updateError.value = null;
}

/** 目标输入变化时立即解析；非法（含清空）立即报错并清除旧结果，同时终止复测会话。 */
function onTargetInput(): void {
  terminateSession();
  clearResult();
  // 目标变化后，链接说明与复制反馈均已过时；同时使在途复制请求失效，
  // 其随后完成（成功或失败）时不得再把旧目标的反馈写回页面。
  linkTargetError.value = null;
  shareFeedback.value = null;
  copyRequestSeq += 1;
  try {
    targetCanonical.value = parseCombo(targetInput.value);
    targetError.value = null;
  } catch (error) {
    targetCanonical.value = null;
    targetError.value =
      error instanceof ShortcutParseError ? error.message : '目标组合无效';
  }
}

/**
 * 页面加载时读取地址中的 target 参数：合法值经现有解析链路预填目标输入框，
 * 非法值不落入页面状态，仅在目标区域说明链接中的组合无效。
 * 只预填目标，不触发判读、不创建复测样本。
 */
function applyTargetFromLocation(): void {
  const resolution = resolveTargetParam(window.location.href);
  if (resolution.kind === 'valid') {
    targetInput.value = resolution.canonical;
    onTargetInput();
  } else if (resolution.kind === 'invalid') {
    linkTargetError.value = `链接中的目标组合无效：${resolution.reason}`;
  }
}

applyTargetFromLocation();

/**
 * 页面打开时从浏览器存储恢复收藏：损坏记录由领域层丢弃；
 * 逐项剔除或整体内容不可读时展示可恢复提示（下一次成功写入后清除）。
 */
function restoreFavoritesOnLoad(): void {
  const storage = getBrowserLocalStorage();
  if (storage === null) {
    return;
  }
  const { favorites: restored, dropped, corrupted } = loadFavorites(storage);
  favorites.value = restored;
  if (corrupted || dropped > 0) {
    favoritesRecovered.value = true;
  }
}

restoreFavoritesOnLoad();

/**
 * 收藏当前规范目标：经领域层去重并重排为最近使用顺序后写入浏览器存储。
 * 写入被拒绝时保留当前判读与列表原状，仅提示失败、不显示收藏成功。
 */
function favoriteCurrentTarget(): void {
  const canonical = targetCanonical.value;
  if (canonical === null) {
    return;
  }
  const next = addFavorite(favorites.value, canonical);
  const storage = getBrowserLocalStorage();
  if (storage === null || !saveFavorites(storage, next)) {
    favoriteFeedback.value = '收藏失败：浏览器存储不可用，本次结果未保存';
    favoriteFeedbackOk.value = false;
    return;
  }
  favorites.value = next;
  favoriteFeedback.value = `已收藏：${canonical}`;
  favoriteFeedbackOk.value = true;
  // 成功写入后，存储内容已是当前干净列表，恢复提示不再需要。
  favoritesRecovered.value = false;
}

/**
 * 选择一项收藏：走与目标输入相同的解析与输入变更链路
 * （清除旧单次结果、终止连续复测、使旧分享反馈失效），再聚焦采集区等待复核。
 * 不修改当前地址（target 查询参数保持原样）。
 */
function applyFavorite(canonical: string): void {
  targetInput.value = parseCombo(canonical);
  onTargetInput();
  favoriteFeedback.value = null;
  captureAreaEl.value?.focus();
}

/** 复制目标链接：将规范目标写入当前地址的 target 参数并复制到剪贴板。 */
async function copyShareLink(): Promise<void> {
  const canonical = targetCanonical.value;
  if (canonical === null) {
    return;
  }
  // 占用最新序号：在途的较早复制请求随即失效，其完成顺序不再影响反馈。
  const requestSeq = ++copyRequestSeq;
  const url = buildTargetShareUrl(window.location.href, canonical);
  try {
    await navigator.clipboard.writeText(url);
    if (requestSeq !== copyRequestSeq) {
      return;
    }
    shareFeedback.value = '目标链接已复制，可发送给测试员复核';
    shareFeedbackOk.value = true;
  } catch {
    if (requestSeq !== copyRequestSeq) {
      return;
    }
    // 剪贴板不可用或被拒绝：保留目标，仅说明失败结果。
    shareFeedback.value = '复制失败：无法访问剪贴板，请改用手动转述';
    shareFeedbackOk.value = false;
  }
}

/** 开始一次连续复测：校验目标与采样数，清除单次判读结果并聚焦采集区。 */
function startRetest(): void {
  retestError.value = null;
  retestNotice.value = null;
  if (targetCanonical.value === null) {
    retestError.value = '请先填写有效的目标组合';
    return;
  }
  let planned: number;
  try {
    planned = parseSampleCount(sampleCountInput.value);
  } catch (error) {
    retestError.value =
      error instanceof RetestError ? error.message : '采样数无效';
    return;
  }
  clearResult();
  session = new RetestSession(targetCanonical.value, planned);
  retestState.value = session.state();
  captureAreaEl.value?.focus();
}

/** 取消复测：终止会话并恢复单次判读。 */
function cancelRetest(): void {
  terminateSession();
  captureAreaEl.value?.focus();
}

/** 复测进行中：逐次记录有效组合；非法组合仅提示本次未计入，不推进进度。 */
function recordRetestSample(event: KeyboardEvent): void {
  if (session === null || session.completed) {
    return;
  }
  const combo = comboFromEvent(event);
  if (combo === null) {
    retestNotice.value = `本次未计入：不支持的主键 ${event.key}`;
    return;
  }
  try {
    session.record(combo);
  } catch (error) {
    // 组合本身非法（如同时按下四个修饰键）：保持原进度，仅提示本次未计入。
    const reason =
      error instanceof RetestError
        ? error.message.replace(/^非法样本未入账：/, '')
        : '组合无效';
    retestNotice.value = `本次未计入：${reason}`;
    return;
  }
  retestNotice.value = null;
  retestState.value = session.state();
}

/** 采集区 keydown：仅当焦点位于采集区内才会触发。 */
function onCaptureKeydown(event: KeyboardEvent): void {
  event.preventDefault();
  // 长按触发的重复 keydown 不计入：一次物理按下只推进一次采集。
  if (event.repeat) {
    return;
  }
  // 单独按修饰键不判读。
  if (isModifierOnlyKey(event.key)) {
    return;
  }
  // 复测会话存在期间，按键进入复测流程而非单次判读。
  if (session !== null) {
    recordRetestSample(event);
    return;
  }
  const combo = comboFromEvent(event);
  if (combo === null) {
    clearResult();
    actualError.value = `不支持的主键：${event.key}`;
    return;
  }
  actualError.value = null;
  updateError.value = null;
  actualCanonical.value = combo;
  match.value =
    targetCanonical.value !== null ? combo === targetCanonical.value : null;
}

const judged = computed(
  () =>
    match.value !== null &&
    targetCanonical.value !== null &&
    actualCanonical.value !== null,
);

/** 单次判读不匹配时的结构化差异诊断；匹配或未判读时为 null。 */
const comboDiff = computed(() => {
  if (!judged.value || match.value) {
    return null;
  }
  return diffCombos(targetCanonical.value!, actualCanonical.value!);
});

/**
 * 按实际组合更新目标：先经领域解析链路校验，拒绝时保留原目标与本次判读；
 * 通过后复用目标输入链路（清除旧结果、终止复测会话），等待下一次采集。
 */
function applyActualAsTarget(): void {
  const actual = actualCanonical.value;
  if (actual === null) {
    return;
  }
  try {
    targetInput.value = parseCombo(actual);
  } catch (error) {
    updateError.value =
      error instanceof ShortcutParseError ? error.message : '目标组合无效';
    return;
  }
  onTargetInput();
  captureAreaEl.value?.focus();
}

/** 判读完成后下载 UTF-8 JSON 结果。 */
function downloadResult(): void {
  if (!judged.value) {
    return;
  }
  const payload = {
    target: targetCanonical.value,
    actual: actualCanonical.value,
    match: match.value,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'shortcut-result.json';
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <main class="page">
    <h1>快捷键兼容判读器</h1>

    <section class="panel">
      <label class="field-label" for="target-input">
        目标组合（加号连接，如 Control+Shift+A）
      </label>
      <input
        id="target-input"
        v-model="targetInput"
        type="text"
        placeholder="Control+Shift+A"
        autocomplete="off"
        spellcheck="false"
        @input="onTargetInput"
      />
      <p v-if="targetError" id="target-error" class="error" role="alert">
        {{ targetError }}
      </p>
      <p v-else-if="targetCanonical" id="target-canonical" class="hint">
        规范目标：{{ targetCanonical }}
      </p>
      <p
        v-if="linkTargetError"
        id="link-target-error"
        class="error"
        role="alert"
      >
        {{ linkTargetError }}
      </p>
      <div class="share-controls">
        <button
          id="copy-share-link-btn"
          type="button"
          :disabled="targetCanonical === null"
          @click="copyShareLink"
        >
          复制目标链接
        </button>
        <p
          v-if="shareFeedback"
          id="share-feedback"
          :class="shareFeedbackOk ? 'hint' : 'error'"
          :role="shareFeedbackOk ? 'status' : 'alert'"
        >
          {{ shareFeedback }}
        </p>
      </div>
    </section>

    <section class="panel" id="favorites-panel">
      <div class="favorites-head">
        <p class="field-label">
          本地收藏（按最近使用排序，最多 {{ FAVORITE_LIMIT }} 项）
        </p>
        <button
          id="favorite-add-btn"
          type="button"
          :disabled="!judged"
          @click="favoriteCurrentTarget"
        >
          收藏当前目标
        </button>
      </div>
      <p
        v-if="favoriteFeedback"
        id="favorite-feedback"
        :class="favoriteFeedbackOk ? 'hint' : 'error'"
        :role="favoriteFeedbackOk ? 'status' : 'alert'"
      >
        {{ favoriteFeedback }}
      </p>
      <p v-if="favoritesRecovered" id="favorites-recovered" class="error" role="alert">
        本地收藏数据已损坏，无效内容已被丢弃；收藏新目标后将以当前列表覆盖保存。
      </p>
      <ul v-if="favorites.length > 0" id="favorites-list" class="favorites-list">
        <li v-for="favorite in favorites" :key="favorite">
          <button
            type="button"
            class="favorite-item"
            :data-combo="favorite"
            @click="applyFavorite(favorite)"
          >
            {{ favorite }}
          </button>
        </li>
      </ul>
      <p v-else id="favorites-empty" class="hint">
        完成一次判读后可收藏当前规范目标，刷新页面后仍在此处载入。
      </p>
    </section>

    <section class="panel">
      <p class="field-label">采集区（点击聚焦后按下真实组合）</p>
      <div
        id="capture-area"
        ref="captureAreaEl"
        class="capture"
        tabindex="0"
        @keydown="onCaptureKeydown"
      >
        点击此处聚焦，然后按下组合键
      </div>
      <p v-if="actualError" id="actual-error" class="error" role="alert">
        {{ actualError }}
      </p>
    </section>

    <section v-if="judged || actualCanonical" id="result" class="panel result">
      <p class="row">
        <span class="row-label">目标值：</span>
        <code id="result-target">{{ targetCanonical ?? '（未设置有效目标）' }}</code>
      </p>
      <p class="row">
        <span class="row-label">实际值：</span>
        <code id="result-actual">{{ actualCanonical }}</code>
      </p>
      <p v-if="judged" class="row">
        <span class="row-label">结论：</span>
        <span
          id="result-verdict"
          class="verdict"
          :class="match ? 'match' : 'mismatch'"
        >
          {{ match ? '匹配' : '不匹配' }}
        </span>
      </p>
      <p v-else id="result-pending" class="hint">
        请先填写有效的目标组合以完成判读
      </p>
      <div v-if="comboDiff" id="diff-diagnosis" class="diagnosis">
        <p
          v-if="comboDiff.missingModifiers.length > 0"
          id="diff-missing"
          class="row diff diff-missing"
        >
          <span class="row-label">缺失修饰键：</span>
          <span>{{ comboDiff.missingModifiers.join('、') }}</span>
        </p>
        <p
          v-if="comboDiff.extraModifiers.length > 0"
          id="diff-extra"
          class="row diff diff-extra"
        >
          <span class="row-label">多余修饰键：</span>
          <span>{{ comboDiff.extraModifiers.join('、') }}</span>
        </p>
        <p
          v-if="comboDiff.mainKey !== null"
          id="diff-main-key"
          class="row diff diff-main-key"
        >
          <span class="row-label">主键不同：</span>
          <span>目标 {{ comboDiff.mainKey.target }}，实际 {{ comboDiff.mainKey.actual }}</span>
        </p>
        <button
          v-if="!retestState"
          id="update-target-btn"
          type="button"
          @click="applyActualAsTarget"
        >
          按实际组合更新目标
        </button>
        <p v-if="updateError" id="update-error" class="error" role="alert">
          无法更新目标：{{ updateError }}
        </p>
      </div>
    </section>

    <section class="panel" id="retest-panel">
      <label class="field-label" for="sample-count-input">
        连续复测（采样数 2–10 次）
      </label>
      <div class="retest-controls">
        <input
          id="sample-count-input"
          v-model="sampleCountInput"
          type="number"
          min="2"
          max="10"
          step="1"
          :disabled="retestRunning"
        />
        <button
          id="retest-start-btn"
          type="button"
          :disabled="retestRunning"
          @click="startRetest"
        >
          开始复测
        </button>
        <button
          v-if="retestState"
          id="retest-cancel-btn"
          type="button"
          @click="cancelRetest"
        >
          {{ retestRunning ? '取消复测' : '清除复测结果' }}
        </button>
      </div>
      <p v-if="retestError" id="retest-error" class="error" role="alert">
        {{ retestError }}
      </p>
      <p
        v-if="retestState && !retestState.completed"
        id="retest-progress"
        class="hint"
      >
        复测进行中：已采集 {{ retestState.recorded }} / {{ retestState.planned }} 次
      </p>
      <p v-if="retestNotice" id="retest-notice" class="error" role="alert">
        {{ retestNotice }}
      </p>
      <div v-if="retestSummary" id="retest-summary" class="result">
        <p class="row">
          <span class="row-label">目标值：</span>
          <code id="summary-target">{{ retestSummary.target }}</code>
        </p>
        <p class="row">
          <span class="row-label">匹配次数：</span>
          <span id="summary-matched">
            {{ retestSummary.matchedCount }} / {{ retestSummary.total }}
          </span>
        </p>
        <p class="row">
          <span class="row-label">通过率：</span>
          <span id="summary-pass-rate">{{ passRateText }}</span>
        </p>
        <ul id="summary-groups" class="groups">
          <li v-for="group in retestSummary.groups" :key="group.combo">
            <code class="group-combo">{{ group.combo }}</code>
            <span class="group-count">× {{ group.count }} 次</span>
          </li>
        </ul>
      </div>
    </section>

    <button
      id="download-btn"
      type="button"
      :disabled="!judged"
      @click="downloadResult"
    >
      下载判读结果 JSON
    </button>
  </main>
</template>

<style scoped>
.page {
  max-width: 640px;
  margin: 2rem auto;
  padding: 0 1rem;
  font-family: system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1f2933;
}

.panel {
  margin-bottom: 1.25rem;
}

.field-label {
  display: block;
  margin-bottom: 0.4rem;
  font-weight: 600;
}

#target-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #9aa5b1;
  border-radius: 6px;
}

.share-controls {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 0.6rem;
}

.favorites-head {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.favorites-head .field-label {
  margin-bottom: 0;
}

#favorite-add-btn {
  padding: 0.4rem 0.9rem;
  font-size: 0.95rem;
  border: none;
  border-radius: 6px;
  background: #2680c2;
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}

#favorite-add-btn:disabled {
  background: #9aa5b1;
  cursor: not-allowed;
}

.favorites-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;
}

.favorite-item {
  padding: 0.35rem 0.75rem;
  font-size: 0.95rem;
  border: 1px solid #9aa5b1;
  border-radius: 6px;
  background: #f5f7fa;
  color: #1f2933;
  cursor: pointer;
}

.favorite-item:hover {
  border-color: #2680c2;
  background: #f0f7ff;
}

.share-controls p {
  margin: 0;
}

#copy-share-link-btn {
  padding: 0.4rem 0.9rem;
  font-size: 0.95rem;
  border: none;
  border-radius: 6px;
  background: #2680c2;
  color: #fff;
  cursor: pointer;
}

#copy-share-link-btn:disabled {
  background: #9aa5b1;
  cursor: not-allowed;
}

.capture {
  padding: 2rem 1rem;
  text-align: center;
  border: 2px dashed #9aa5b1;
  border-radius: 8px;
  color: #52606d;
  cursor: pointer;
  user-select: none;
}

.capture:focus {
  outline: none;
  border-color: #2680c2;
  color: #1f2933;
  background: #f0f7ff;
}

.error {
  color: #c0392b;
  margin: 0.4rem 0 0;
}

.hint {
  color: #52606d;
  margin: 0.4rem 0 0;
}

.result .row {
  margin: 0.3rem 0;
}

.row-label {
  font-weight: 600;
}

.verdict.match {
  color: #1e7e34;
  font-weight: 700;
}

.verdict.mismatch {
  color: #c0392b;
  font-weight: 700;
}

.diagnosis {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px dashed #9aa5b1;
}

.diff-missing {
  color: #b7791f;
}

.diff-extra {
  color: #6b46c1;
}

.diff-main-key {
  color: #c0392b;
}

#update-target-btn {
  margin-top: 0.4rem;
  padding: 0.4rem 0.9rem;
  font-size: 0.95rem;
  border: none;
  border-radius: 6px;
  background: #2680c2;
  color: #fff;
  cursor: pointer;
}

#download-btn {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  border: none;
  border-radius: 6px;
  background: #2680c2;
  color: #fff;
  cursor: pointer;
}

#download-btn:disabled {
  background: #9aa5b1;
  cursor: not-allowed;
}

.retest-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

#sample-count-input {
  width: 5rem;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #9aa5b1;
  border-radius: 6px;
}

#retest-start-btn,
#retest-cancel-btn {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

#retest-start-btn {
  background: #2680c2;
  color: #fff;
}

#retest-start-btn:disabled {
  background: #9aa5b1;
  cursor: not-allowed;
}

#retest-cancel-btn {
  background: #e4e7eb;
  color: #1f2933;
}

#retest-summary {
  margin-top: 0.75rem;
}

.groups {
  margin: 0.3rem 0 0;
  padding-left: 1.25rem;
}

.groups li {
  margin: 0.2rem 0;
}

.group-count {
  margin-left: 0.5rem;
  color: #52606d;
}
</style>
