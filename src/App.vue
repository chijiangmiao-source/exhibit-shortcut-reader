<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  comboFromEvent,
  isModifierOnlyKey,
  parseCombo,
  ShortcutParseError,
} from './lib/shortcut';

const targetInput = ref('');
const targetCanonical = ref<string | null>(null);
const targetError = ref<string | null>(null);

const actualCanonical = ref<string | null>(null);
const actualError = ref<string | null>(null);
const match = ref<boolean | null>(null);

/** 清除上一次判读结果。 */
function clearResult(): void {
  actualCanonical.value = null;
  actualError.value = null;
  match.value = null;
}

/** 目标输入变化时立即解析；非法输入立即报错并清除旧结果。 */
function onTargetInput(): void {
  clearResult();
  const raw = targetInput.value;
  if (raw.trim() === '') {
    targetCanonical.value = null;
    targetError.value = null;
    return;
  }
  try {
    targetCanonical.value = parseCombo(raw);
    targetError.value = null;
  } catch (error) {
    targetCanonical.value = null;
    targetError.value =
      error instanceof ShortcutParseError ? error.message : '目标组合无效';
  }
}

/** 采集区 keydown：仅当焦点位于采集区内才会触发。 */
function onCaptureKeydown(event: KeyboardEvent): void {
  event.preventDefault();
  // 单独按修饰键不判读。
  if (isModifierOnlyKey(event.key)) {
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
</style>
