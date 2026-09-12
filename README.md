# 快捷键兼容判读器

纯前端工具：填写一个由加号连接的目标组合，在采集区按下一次真实组合，判读器将双方规范化为唯一字符串后比较，给出匹配 / 不匹配结论，并可下载 UTF-8 JSON 结果。全程不调用任何外部在线服务。

## 规则

- **修饰键**：仅 `Control`、`Alt`、`Shift`、`Meta`，忽略大小写；左右同名修饰键（如 `ControlLeft` / `ControlRight`）视为同键。
- **主键**：仅 `A`–`Z`、`0`–`9`、`Enter`、`Space`、`Escape`，忽略大小写；字母主键规范为大写。
- **规范形式**：修饰键固定按 `Control`、`Alt`、`Shift`、`Meta` 排列，主键位于末尾，以 `+` 连接（如 `Control+Shift+A`）。
- **目标报错**（立即报错并清除旧判读结果）：修饰键重复、未知名称、缺少主键、含多个主键、超过三个修饰键。
- **判读**：仅在采集区聚焦时监听 `keydown`；区外事件忽略；单独按修饰键不判读；收到主键后只比较规范字符串。
- **结果下载**：判读完成后可下载 JSON，包含规范目标 `target`、规范实际组合 `actual` 与布尔结论 `match`。

## 技术栈

TypeScript · Vue 3 · Vite · Vitest · Playwright

## 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm run test       # Vitest：规范化边界单元测试
npm run build      # vue-tsc 类型检查 + 产物构建
npm run e2e        # Playwright：焦点与真实按键端到端测试（需先 npx playwright install chromium）
npm run verify     # 一次性验收：单元测试 + 构建
```

## Docker

```bash
# 静态前端（nginx），宿主机端口由 WEB_PORT 覆盖，默认 8080
WEB_PORT=9000 docker compose up --build web

# 一次性验收服务：运行单元测试与完整构建后以退出码报告结果
docker compose run --rm verify
```

## 结果 JSON 示例

```json
{
  "target": "Control+Shift+A",
  "actual": "Control+Shift+A",
  "match": true
}
```
