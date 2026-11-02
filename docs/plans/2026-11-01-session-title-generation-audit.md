# Proma 会话标题自动生成排查记录

> 状态：排查记录（本次未修改业务代码）
>
> 日期：2026-11-01
>
> 范围：Agent 会话为主，附带普通 Chat 会话
>
> 现象：部分供应商的模型无法稳定触发自动命名，会话标题长期停留在「新 Agent 会话」

## 1. 结论摘要

1. 当前没有独立的「标题模型」配置。标题请求使用会话当前的 `channelId + modelId`，与主对话使用同一个渠道和模型。
2. Agent 主对话走 **Pi runtime**（`pi-agent-adapter.ts` / `pi-model-registry.ts`），标题请求走 **`@proma/core` 适配器**（`AnthropicAdapter` / `OpenAIAdapter` / `OpenAIResponsesAdapter` / `GoogleAdapter`）。这是两套独立实现，URL、认证、thinking 参数和 token 上限的处理并不共享。
3. 只有 `custom`、`openai-codex`、`xai`、`github-copilot` 有本地兜底标题。其它 provider 只要请求失败、超时或返回空内容，`generateTitle()` 就返回 `null`，不会写入标题。
4. 标题请求均为**非流式、短输出**请求。部分推理模型会把输出预算消耗在思考上，或拒绝标题请求使用的参数，导致返回空内容或 4xx。
5. 标题生成在 Pi 模型解析回调之前启动，因此 `[1m]` 这类旧模型 ID 后缀不会被剥离；而 Pi runtime 会剥离。存在「聊天正常、标题 404/模型不存在」的窗口。
6. 标题请求与主对话并发发起，当前没有单轮内重试。限流严格的供应商可能偶发失败，只能等用户下一条消息再次触发。

## 2. Agent 会话标题链路

### 2.1 时序

```text
createAgentSession()
  └─ title = '新 Agent 会话'                         agent-session-manager.ts:417

用户发送首条消息
  └─ AgentOrchestrator.sendMessage()                 agent-orchestrator.ts:682
       ├─ 持久化用户消息
       ├─ 构建 Pi 运行参数
       ├─ startAutoTitleGeneration()                 agent-orchestrator.ts:1572-1581
       │    └─ autoGenerateTitle()                   agent-orchestrator.ts:408-455
       │         ├─ 校验标题仍为默认值
       │         ├─ generateTitle()                  agent-orchestrator.ts:317-400
       │         │    ├─ xai / github-copilot → 本地兜底
       │         │    ├─ openai-codex → Codex OAuth 专用请求
       │         │    └─ 其它 → @proma/core 适配器请求
       │         ├─ updateAgentSessionMeta({ title })
       │         └─ callbacks.onTitleUpdated(title)
       │              └─ agent-service.ts:347-359
       │                   ├─ IPC: AGENT_IPC_CHANNELS.TITLE_UPDATED
       │                   └─ EventBus: proma_event.title_updated
       └─ 遍历 Pi 事件流                             agent-orchestrator.ts:1721 之后
```

### 2.2 触发条件与防覆盖

`autoGenerateTitle()` 的守卫（`agent-orchestrator.ts:408-455`）：

- 当前标题必须仍是 `新 Agent 会话`；
- 或当前会话是 Pi `/tree` 探索分支且尚未初始化过标题；
- 用户已手动重命名、fork 会话自带标题、委派子会话自带标题时，不会自动覆盖；
- 标题请求返回后会再次读取最新 meta，确认标题没有被用户改动，才写入结果。

`titleGenerationStarted` 只在单次 `sendMessage` 内防止重复请求。下一次用户发消息时，如果标题仍为默认值，会再次尝试命名。

### 2.3 Provider 分支与兜底

`AgentOrchestrator.generateTitle()` 位于 `agent-orchestrator.ts:317-400`：

| Provider | 处理方式 | 失败时是否重命名 |
|---|---|---|
| `xai`、`github-copilot` | 直接 `createFallbackTitle(userMessage)` | 是 |
| `openai-codex` | `generateCodexTitle()`，使用 Pi Codex OAuth Responses 请求 | 是，失败回退首行标题 |
| `custom` | 走 `@proma/core` 适配器 | 是，失败/空内容回退首行标题 |
| 其它所有 provider | 走 `@proma/core` 适配器 | **否，返回 `null`** |

`custom` 之外的内置 provider 失败时没有兜底，这是标题长期停留在默认值的直接原因。

### 2.4 标题回传

`agent-service.ts:347-359` 同时走两条通道：

- 桌面端：`AGENT_IPC_CHANNELS.TITLE_UPDATED`
- headless/Bridge：EventBus `proma_event.title_updated`

Renderer 在 `useGlobalAgentListeners.ts:2010-2029` 接收，更新标签页标题和左侧会话列表。

## 3. 普通 Chat 会话标题链路

Chat 与 Agent 是独立链路：

1. `ChatView.handleSend()` 判断首条消息后调用 `registerPendingTitle()`
   - `apps/electron/src/renderer/components/chat/ChatView.tsx:263-281`
2. 流式完成后 renderer 调用主进程
   - `apps/electron/src/renderer/hooks/useGlobalChatListeners.ts:116-138`
3. 主进程 `chat-service.generateTitle()`
   - `apps/electron/src/main/lib/chat-service.ts:594-656`

与 Agent 链路的差异：

- 消息长度 ≤ `SHORT_MESSAGE_THRESHOLD`（4）时直接使用原文，不请求模型；
- `openai-codex` / `github-copilot` 有本地兜底；
- **没有对 `xai` 做特殊处理**。`getAdapter('xai')` 会抛错，之后仅 `custom` 会兜底，其它返回 `null`；
- 同样是「只有 custom 渠道失败才兜底」。

## 4. 标题请求层

### 4.1 Prompt 与结果清理

`apps/electron/src/main/lib/title-generation.ts`：

| 项 | 值 | 说明 |
|---|---|---|
| `TITLE_PROMPT` | 要求 10 字以内、只输出标题 | 与用户消息拼接后发送 |
| `SHORT_MESSAGE_THRESHOLD` | `4` | 仅 Chat 链路使用 |
| `MAX_TITLE_LENGTH` | `20` | `sanitizeGeneratedTitle` 最终截断 |
| `sanitizeGeneratedTitle` | 兼容字符串、内容块数组、`{ text }` | 空内容返回 `null` |
| `createFallbackTitle` | 首行、去 Markdown 前缀、截断 20 字 | Agent 探索分支 / 兜底渠道使用 |

### 4.2 Provider → Adapter 映射

`packages/core/src/providers/index.ts:29-49`：

| Provider | 标题请求实现 |
|---|---|
| `anthropic`、`anthropic-compatible`、`deepseek`、`kimi-api`、`kimi-coding`、`zhipu-coding`、`zhipu-coding-team`、`minimax`、`xiaomi`、`xiaomi-token-plan`、`qwen-anthropic`、`qwen-token-plan` | `AnthropicAdapter` |
| `openai`、`zhipu`、`doubao-api`、`qwen`、`custom` | `OpenAIAdapter` |
| `openai-responses` | `OpenAIResponsesAdapter` |
| `google` | `GoogleAdapter` |
| `openai-codex` | 专用 Codex OAuth 请求 |
| `xai`、`github-copilot` | Agent/Chat 层直接本地兜底 |
| `opencode-go-openai` | 已退役，不在注册表；请求会抛错 |

### 4.3 各适配器标题请求体

| 适配器 | 端点 | 关键参数 | 代码位置 |
|---|---|---|---|
| Anthropic | `{base}/messages` | `max_tokens: 50`；按能力发 `thinking: disabled` 或省略 | `anthropic-adapter.ts:458-505` |
| OpenAI | `{base}/chat/completions` | `max_tokens: 512` | `openai-adapter.ts:275-297` |
| OpenAI Responses | `{base}/responses` | `max_output_tokens: 50` | `openai-responses-adapter.ts:380-400` |
| Google | `{base}/v1beta/models/{model}:generateContent?key=...` | `maxOutputTokens: 50`，无 `thinkingConfig` | `google-adapter.ts:311-329` |

请求执行：

- 非流式 `fetch`，30 秒超时：`packages/core/src/providers/sse-reader.ts:372-422`
- 渠道凭据解析：`apps/electron/src/main/lib/channel-manager.ts:817-827`
- 代理：`getEffectiveProxyUrl()` + `getFetchFn()`

## 5. 失败面清单

### 5.1 统一的 `null` 出口

`agent-orchestrator.ts:386-399` 中，以下任一情况都会返回 `null`（`custom` 除外）：

| 失败点 | 说明 |
|---|---|
| 渠道不存在 | `listChannels()` 中找不到 `channelId` |
| 凭据解析失败 | 解密 API Key / 刷新 OAuth 失败 |
| 适配器不存在 | `getAdapter()` 抛错（退役 provider） |
| HTTP 非 2xx | 400 / 401 / 403 / 404 / 429 / 5xx |
| 响应不是合法 JSON | `response.json()` 抛错 |
| 响应解析为空 | `parseTitleResponse()` 返回 `null` |
| 清理后为空 | `sanitizeGeneratedTitle()` 返回 `null` |
| 请求超时 | 30 秒未完成 |

### 5.2 供应商级可疑点

以下为代码与请求参数层面的高风险点，按可能性排序；标注「待验证」的项需要结合主进程日志确认。

#### （1）OpenAI 推理模型与 `max_tokens`

`openai-adapter.ts:286-290` 发送：

```json
{
  "model": "...",
  "messages": [{ "role": "user", "content": "..." }],
  "max_tokens": 512
}
```

OpenAI 新一代推理模型（o 系列 / GPT-5 系列）通常要求 `max_completion_tokens`，传 `max_tokens` 会返回 400。  
影响 `openai` 渠道；`custom` 渠道因为失败会走本地兜底，表现不同。

#### （2）Google Gemini 思考模型与 50 输出 token

`google-adapter.ts:311-323` 的标题请求只有：

```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "..." }] }],
  "generationConfig": { "maxOutputTokens": 50 }
}
```

Gemini 2.5/3 默认开启思考，思考 token 计入 `maxOutputTokens`。50 token 可能被思考耗尽，`candidates[0].content.parts[0].text` 为空 → `null`。  
流式请求在 `thinkingEnabled` 时会构造 `thinkingConfig`（`google-adapter.ts:211-228`），标题请求没有对应处理。

#### （3）OpenAI Responses 与 50 输出 token

`openai-responses-adapter.ts:389-393`：

```json
{
  "model": "...",
  "input": [{ "role": "user", "content": "..." }],
  "max_output_tokens": 50
}
```

推理内容占用输出预算后，响应可能没有 `output_text`，`parseTitleResponse()` 返回 `null`。

#### （4）Anthropic 兼容网关与 `thinking` 字段

`anthropic-adapter.ts:458-480`：

- `max_tokens: 50`
- 未识别模型按 `manual-only` 发送 `thinking: { type: 'disabled' }`

部分 Anthropic 兼容网关不接受 `thinking` 字段，或 50 token 不足以在思考后产出正文，会 400 或返回空。  
`thinking-capability.ts:95-109` 已为 Kimi / 智谱 / MiniMax / Token Plan 做「省略 thinking」特判，但 `anthropic-compatible` 及自定义 Anthropic 网关仍可能踩坑。

#### （5）OpenAI 兼容思考模型只返回 `reasoning_content`

`openai-adapter.ts:294-297` 的 `parseTitleResponse` 只读：

```ts
data.choices?.[0]?.message?.content
```

如果模型把内容放在 `reasoning_content`，或 512 token 被推理消耗完导致 `content` 为空，会返回 `null`。  
`custom` 渠道有兜底；内置 `qwen` / `zhipu` / `doubao-api` 没有。

#### （6）旧模型 ID 的 `[1m]` 后缀未被标题链路剥离

Pi runtime 会统一剥离：

`apps/electron/src/main/lib/adapters/pi-model-registry.ts:836-838`

```ts
export function stripLegacyAgentSdkContextSuffix(modelId) {
  return modelId?.replace(/\[1m\]$/i, '')
}
```

标题生成在模型解析回调之前启动：

- 标题调用：`agent-orchestrator.ts:1579`
- `[1m]` 剥离：`agent-orchestrator.ts:1609-1613`（`handleModelResolved`）
- 直接传给 Pi 的模型字段：`agent-orchestrator.ts:1631-1634`

若会话持久化的模型 ID 为 `glm-5.2[1m]` 这类旧格式，Pi 聊天正常，但标题请求会带后缀发给端点，返回「模型不存在」。

#### （7）标题请求与主对话并发，无单轮重试

`agent-orchestrator.ts:1719-1721` 在主 run 开始前立即发起标题请求。  
对并发限制严格的订阅/编程套餐，标题请求可能吃到 429 或排队超时；当前没有重试，只能等用户下一条消息再次触发。

### 5.3 其它链路问题

| 问题 | 位置 | 影响 |
|---|---|---|
| `modelId` 缺失时回退到 `DEFAULT_MODEL_ID = 'claude-sonnet-5'` | `agent-orchestrator.ts:147, 991` | 非 Anthropic 渠道会拿一个不存在的模型发标题请求 |
| Chat 链路遗漏 `xai` 特判 | `chat-service.ts:614` | `getAdapter('xai')` 抛错，Chat 标题恒为 `null` |
| Agent 链路没有短消息快捷路径 | `agent-orchestrator.ts:408-455` | 极短首条消息也会发起模型请求，增加失败概率 |
| 已退役 provider 渠道仍可能存在 | `providers/index.ts:29-49` | `getAdapter()` 抛错，标题返回 `null` |

### 5.4 测试覆盖缺口

- 标题请求体的构造没有单元测试（只有 Codex 标题生成和 Responses 解析各一处测试）；
- `buildTitleRequest` 的 `max_tokens` / `thinking` / URL 组合没有回归保护；
- `autoGenerateTitle` 的守卫与失败分支没有 BDD 测试。

## 6. 日志排查指南

在主进程日志中按以下关键字过滤：

| 日志 | 含义 |
|---|---|
| `[Agent 标题生成] 开始生成标题` | 标题链路已触发 |
| `[fetchTitle] 收到响应` | 查看 `status` 与 `statusText` |
| `[fetchTitle] 请求失败` | 查看 `status` 和 `errorText` 前 500 字符 |
| `[fetchTitle] 解析标题结果` | 模型返回是否被解析为空 |
| `[Agent 标题生成] API 未返回可用标题` | HTTP 成功但内容为空 |
| `[Agent 标题生成] 生成失败` | 请求异常 |
| `[Agent 编排] 自动标题生成完成` | 成功写入 |
| `[Agent 编排] 自动标题生成失败` | 守卫/写入阶段异常 |

## 7. 建议的修复方向（未实施）

按收益排序：

1. **所有 provider 失败都写本地兜底标题**：目前仅 `custom` 有兜底。先保证任何失败都不会长期停在默认标题。
2. **按供应商补齐标题请求兼容参数**：
   - OpenAI 推理模型使用 `max_completion_tokens`；
   - Google 标题请求关闭 thinking 或显式设置 `thinkingConfig`；
   - OpenAI Responses 提高输出预算或关闭推理；
   - 为 Anthropic 兼容网关增加「省略 thinking」兜底策略。
3. **增加独立的标题模型配置**：允许选择便宜、稳定的模型，避免用会话主模型承担标题请求。当前分支名 `feat-session-title-model` 指向该方向，但代码中尚无对应设置项。
4. **标题链路统一剥离 `[1m]` 后缀**，与 Pi runtime 保持一致。
5. **补充 BDD 测试**：覆盖各适配器标题请求体、失败兜底、`[1m]`、短消息和空响应。

## 8. 待确认问题

1. 具体失败的是哪些供应商和模型？（例如 OpenAI GPT-5、Gemini 3、Kimi K3、智谱 GLM、Qwen、某个 Anthropic 兼容网关）
2. 失败是偶发还是稳定复现？偶发更偏向并发/限流，稳定复现更偏向请求参数或端点不兼容。
3. 主进程日志中 `[fetchTitle] 请求失败` 的 HTTP 状态码是什么？
4. 渠道是内置 provider 还是 `custom` / `anthropic-compatible` 自填端点？

## 附录：关键文件索引

| 文件 | 职责 |
|---|---|
| `apps/electron/src/main/lib/agent-orchestrator.ts` | Agent 标题触发、守卫、provider 分支 |
| `apps/electron/src/main/lib/agent-service.ts` | 标题事件回传 |
| `apps/electron/src/main/lib/agent-session-manager.ts` | 会话创建与默认标题 |
| `apps/electron/src/main/lib/chat-service.ts` | 普通 Chat 标题生成 |
| `apps/electron/src/main/lib/title-generation.ts` | Prompt、清洗、本地兜底 |
| `apps/electron/src/main/lib/adapters/pi-model-registry.ts` | Pi 模型注册与 `[1m]` 剥离 |
| `packages/core/src/providers/index.ts` | Provider → Adapter 注册表 |
| `packages/core/src/providers/*-adapter.ts` | 各协议标题请求构造与响应解析 |
| `packages/core/src/providers/sse-reader.ts` | 标题 HTTP 请求与超时 |
| `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts` | Agent 标题 IPC 接收 |
| `apps/electron/src/renderer/hooks/useGlobalChatListeners.ts` | Chat 标题生成触发与回写 |
