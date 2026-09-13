<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  comboFromEvent,
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

const targetInput = ref('');
const targetCanonical = ref<string | null>(null);
const targetError = ref<string | null>(null);

const actualCanonical = ref<string | null>(null);
const actualError = ref<string | null>(null);
const match = ref<boolean | null>(null);

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
}

/** 目标输入变化时立即解析；非法（含清空）立即报错并清除旧结果，同时终止复测会话。 */
function onTargetInput(): void {
  terminateSession();
  clearResult();
  try {
    targetCanonical.value = parseCombo(targetInput.value);
    targetError.value = null;
  } catch (error) {
    targetCanonical.value = null;
    targetError.value =
      error instanceof ShortcutParseError ? error.message : '目标组合无效';
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

/** 复测进行中：逐次记录有效组合；不支持的主键仅提示本次未计入。 */
function recordRetestSample(event: KeyboardEvent): void {
  if (session === null || session.completed) {
    return;
  }
  const combo = comboFromEvent(event);
  if (combo === null) {
    retestNotice.value = `本次未计入：不支持的主键 ${event.key}`;
    return;
  }
  retestNotice.value = null;
  session.record(combo);
  retestState.value = session.state();
}

/** 采集区 keydown：仅当焦点位于采集区内才会触发。 */
function onCaptureKeydown(event: KeyboardEvent): void {
  event.preventDefault();
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
