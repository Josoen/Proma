# Agent 会话标题独立模型配置方案

> 状态：设计草案，待评审；本轮不实现功能。
>
> 日期：2026-11-01
>
> 关联排查：[会话标题自动生成排查记录](./2026-11-01-session-title-generation-audit.md)

## 1. 目标与范围

针对部分供应商聊天正常、标题却一直停留在「新 Agent 会话」的问题，明确以下行为：

1. 在「设置 → 模型配置」中选择独立的标题渠道和模型，不改变会话的主模型。
2. 标题请求固定使用 `thinkingLevel = off`，不继承主会话的思考等级，也不增加思考等级选择器。
3. 生成标题的 Prompt 固定写在代码中，不提供自定义入口或配置字段。
4. 删除「模型配置」页面现有的 Proma 商业版推广横幅。

同时补齐一个必要的失败出口：标题模型调用失败或返回空文本时，使用现有 `createFallbackTitle()` 生成本地标题，而不是继续保留默认名称。

### 1.1 本版假设

- 设置是**应用级 Agent 偏好**，跨 Agent 工作区生效，不增加项目级、工作区级或会话级覆盖。
- 未指定独立模型时，继续使用发起本轮消息的会话渠道和模型，但标题请求仍固定为 `off`。
- 本期聚焦 **Agent 会话**。普通 Chat 有另一套触发和写回链路，本期不改；设置 UI 明确标为「Agent 会话标题」，避免承诺覆盖 Chat。
- 现有手动命名、fork、委派及 Automation 的标题资格判定保持原样。只有原本有资格自动命名的会话才使用新配置。
- 不批量重命名历史会话；旧会话仍为默认名称时，在下一次正常发送消息、通过现有守卫后使用新配置。

### 1.2 本期不做

- 不安装该 Pi-desktop 插件，不新增插件权限体系或插件宿主 API。
- 不新增标题模型故障转移列表、自动重试队列、后台历史补偿或周期性重命名。
- 不新增 API Key、Base URL、代理等重复配置，全部复用已配置渠道。
- 不支持自定义 Prompt、模板变量、Prompt 编辑/预览/恢复默认，也不为尚未实现的 Prompt 配置设计迁移兼容。
- 不支持助手回复、完整历史、附件内容、工具结果或项目文件参与标题生成。
- 不重写 `@proma/core` 的全部 Provider 适配器，不顺带迁移普通 Chat。
- 不新增依赖、数据库、标题来源元数据或独立配置文件。

## 2. 已确认的现状

以下结论已对照当前工作区代码；供应商实际报错仍需日志或真实调用验证，不能仅凭参数推断某次失败的原因。

| 位置 | 当前行为 | 对方案的影响 |
|---|---|---|
| `agent-orchestrator.ts` 的 `startAutoTitleGeneration()` | 用户消息已持久化、运行参数就绪后后台启动；不依赖 Pi 会话初始化回调 | 保留触发时机，不等待助手首轮完成 |
| 同文件的 `generateTitle()` | 使用传入的会话 `channelId + modelId`，没有独立设置 | 在模型请求前解析独立标题路由 |
| 同文件的 Provider 分支 | 普通 API 渠道走 `@proma/core`；Codex 走专用 Pi 请求；xAI/Copilot 直接本地命名 | 收敛为 Pi 单次文本补全，保留各渠道的认证边界 |
| 同文件的失败分支 | 普通 API 渠道只有 `custom` 会本地兜底，其他失败返回 `null` | 对有文本输入的失败统一调用现有本地标题函数 |
| 同文件的 `autoGenerateTitle()` | 默认标题及 Pi 探索分支有资格守卫；返回后再读取 meta，防止覆盖请求期间的重命名 | 保留写回前复核，生成服务不直接操作会话 |
| `title-generation.ts` | 内置中文 Prompt、20 字符标题清洗和首行本地标题 | 复用现有固定 Prompt、长度与清洗规则，不新增模板引擎 |
| `pi-model-registry.ts` | 已有 Pi 模型构建、URL/认证头、OAuth Provider 和 `[1m]` 清理 | 复用，不另造模型目录和 URL 拼接规则 |
| `pi-codex-title-generator.ts` | 已有一次性请求、独立请求 ID、代理清理、关闭推理的实现 | 作为单次请求实现参考，不启动完整 Agent session |
| `settings-service.ts` | 使用 `settings.json`，但当前 `updateSettings()` 仍直接 `writeFileSync` | 接入设置时将此写入点改用 `writeJsonFileAtomic()`，不扩展为存储系统重构 |
| `ChannelSettings.tsx` | 「模型配置」页面的渠道列表前渲染 `PromaProviderCard`，包含商业版文案及下载按钮 | 删除该推广卡片，在同页新增标题模型配置区块，保留原有渠道管理 |

主对话使用 Pi，而标题使用另一套请求构造，是「聊天成功但标题失败」的重要兼容性风险。仅换一个模型可以绕开部分问题，但继续保留两套标题协议实现，会重复维护思考开关、token 参数、OAuth 和响应提取。

**建议：标题改为 Pi 的一次性文本补全，而不是为每个旧标题适配器继续补特判。** 这不意味着运行一个新的工具型 Agent。

## 3. 参考插件与取舍

参考仓库：<https://github.com/vastsa/pi-session-title-plugin>

核对版本：`d3ecd1de59c4e96d60047a575b87a8cdf144ec76`，已阅读 `README.md`、`main.js`、`title-engine.cjs` 和相关测试。

| 参考插件的实际设计 | Proma 本版取舍 |
|---|---|
| 可配置独立模型、思考等级和 Prompt 模板 | 仅借鉴独立模型配置；思考等级固定 `off`，Prompt 固定在代码中 |
| 模型为空时跟随会话，再找默认可用模型 | 仅保留「显式模型 / 跟随会话」；不自动切到其他渠道 |
| `{{userPrompt}}` 和 `{{assistantReply}}` 占位符，前者必填 | 不引入模板变量；现有固定 Prompt 直接拼接用户消息 |
| 首个完成轮次后，一次性调用宿主 `agent.complete` | 保留 Proma 发送后后台触发，通过本地 Pi runtime 单次补全 |
| 宿主已有 48 字符可替换标题，插件用模型标题升级它 | 不移植两阶段标题状态；本版成功用模型标题，失败用现有 20 字符本地标题 |
| `expectedTitle` 比较后才写回，手动命名优先 | 复用 Proma 现有 meta 复核，不引入新插件接口 |
| 每个会话只有一个标题请求进行中 | 用简单的会话级进行中集合去重，不引入 pending 队列 |

该插件依赖 PI-Desktop 宿主接口，不能直接装进 Proma。其许可证为 LGPL-3.0-or-later，本方案仅参考行为并按 Proma 现有结构实现，不复制插件源文件。

## 4. 配置与设置 UI

### 4.1 数据结构

沿用 `apps/electron/src/types/settings.ts` 的应用设置所有权，不因新增偏好把全部设置类型迁入 `packages/shared`。

拟新增：

```ts
export interface SessionTitleSettings {
  /** 缺省时跟随当前 Agent 会话的模型。 */
  model?: {
    channelId: string
    modelId: string
  }
}

// 加入现有 AppSettings
// sessionTitle?: SessionTitleSettings
```

持久化示例，渠道及模型 ID 仅为占位示例：

```json
{
  "sessionTitle": {
    "model": {
      "channelId": "existing-channel-id",
      "modelId": "existing-model-id"
    }
  }
}
```

- 不持久化 `thinkingLevel` 或 Prompt：它们是固定执行规则，不是用户选项。
- 不保存凭据或复制模型能力；使用时读取渠道的最新状态与配置。
- 缺少 `sessionTitle` 的旧配置等价于跟随会话模型，无需批量迁移；所有请求统一使用代码内置 Prompt。
- 返回「跟随会话」时删除 `model`。
- 保存时整体提交 `sessionTitle` 对象，遵守当前设置服务的顶层合并语义，不误把嵌套对象当成自动深合并。
- UI 保存前及主进程写入前均校验：模型引用必须是完整二元组。
- 对手工配置中的残缺模型引用，标记配置无效并使用本地标题，不能静默当成跟随会话。

### 4.2 UI 布局

在「设置 → 模型配置」页面（`ChannelSettings.tsx`）的渠道列表下方新增「Agent 会话标题」区块，独立组件 `SessionTitleSettings.tsx`，不新增一级导航，不放入「通用」页面。

区块仅在渠道列表视图中展示；进入添加或编辑渠道表单时，沿用现有 `ChannelForm` 视图，不重复显示标题模型设置。

| 控件 | 行为 |
|---|---|
| 标题模型 | 默认显示「跟随当前会话模型」；可通过现有 `ModelSelector` 选择已有渠道的已启用模型 |
| 返回跟随会话 | 清除独立模型引用，不改变 Agent 主模型 |
| 思考等级 | 只读显示 `off（关闭）`，注明不继承会话思考设置 |
| 保存 | 一次提交整个区块；加载或保存中禁用，失败保留草稿并显示错误，不展示虚假成功 |

复用 `SettingsSection`、`SettingsCard`、`SettingsRow`、既有按钮和主题变量；共享设置值用 Jotai，组件本地模型选择草稿及 saving/error 可用 React 状态。页面不展示 Prompt 编辑框、模板帮助、预览或恢复默认按钮。

`ModelSelector` 必须使用 `externalSelectedModel` 与 `onModelSelect` 受控模式，避免写入当前对话或全局主模型。独立模型显示「渠道 · 模型」，支持现有键盘搜索和选择。

必要提示：

- 无可用渠道时，显示「请先在当前页面添加模型配置」；仍可保持或恢复跟随会话模式。
- 已保存引用失效时，显示原 ID 和「模型不可用，请重新选择」，不能改选列表第一项。
- 明确提示：「会将首条用户消息的前 4,000 字符发送给所选标题模型；失败时使用首行作为标题。」
- 已知不支持 `off` 的模型可以显示在选择器中，但选择后提示原因并阻止保存该独立模型；主进程运行时仍需复核。

### 4.3 删除商业版横幅

删除 `ChannelSettings.tsx` 中包装 `PromaProviderCard` 的推广 `SettingsCard`，以及仅服务于该横幅的：

- `PromaProviderCard()` 组件与「Proma 商业版」「下载商业版」文案。
- `openPromaDownload()` 函数及对应下载链接。
- 此文件中的 `ExternalLink`、`PromaLogo` 导入。

不删除共享 `PromaLogo` 导出或图片资源，不扩展为全应用商业文案清理；「关于」页的许可证/商业授权说明及其他页面保持不变。保留「添加配置」、渠道列表、启用开关、编辑/删除操作、Copilot 授权成功提示与删除确认弹窗，不以横幅移除为由调整这些行为。

## 5. 标题生成链路

### 5.1 路由规则

| 设置状态 | 执行方式 |
|---|---|
| 未指定独立模型 | 使用本次发送的会话渠道与模型，不另读全局默认模型 |
| 已指定且渠道、模型均启用 | 使用配置的标题渠道与模型，忽略主会话的 Provider 与思考等级 |
| 显式引用残缺、被删除或被禁用 | 不请求其他渠道，记录原因并使用本地标题 |
| 模型已知不能关闭思考 | 不自动升为 `low`，跳过远程请求并使用本地标题 |

显式引用无效时不自动退回会话模型，既避免掩盖配置问题，也避免把消息意外发送给另一个供应商。

### 5.2 请求和写回

```text
Agent 用户消息已持久化
  → 保留现有默认标题 / 探索分支资格判定
  → 若该会话已有标题请求进行中，跳过重复触发
  → 读取本次请求的设置快照
  → 选择独立标题模型，或跟随本次会话模型
  → 校验渠道、模型、off 能力
  → 用代码内置 Prompt 拼接用户消息，调用 Pi 单次文本补全
       成功：提取可见 text → sanitizeGeneratedTitle()
       失败或空结果：createFallbackTitle(原始用户文本)
  → 重新读取会话 meta，执行现有防覆盖复核
  → 原子更新 meta → 现有 onTitleUpdated 回调
  → 现有 IPC / EventBus → 标签页及会话列表
  → finally 清理进行中标记
```

- 保留 Agent 现有后台时机，不等待助手回复，不阻塞主对话，也不依赖 `onSessionId` 才能命名。
- 请求开始时冻结选中的模型路由；设置变更只影响下一次标题请求，不中途重启请求。Prompt 始终取代码常量，不读取用户配置。
- 一次合格触发最多发起一个模型补全；不加入 SDK 自动重试或应用层轮询。
- 失败后的本地标题作为本版最终自动标题；不新增「本地标题待升级」状态。
- 已生成或已本地命名的标题不会因为下次改设置而自动重生成。
- 只有空白文本无法形成本地标题时才允许保持原名；不为了附件会话读取附件来造标题。
- 显式取消标题请求时不写入结果。当前自动标题与前台 run 独立，本期不新增「停止 Agent 同时取消标题」机制。

### 5.3 Pi 调用边界

新增一个主进程服务 `session-title-service.ts`，负责模型配置解析、路由、固定 Prompt 拼接、单次调用与本地失败出口；现有 `AgentOrchestrator.generateTitle()` 委托它，保持 `Promise<string | null>` 契约。

模型传输放入 `adapters/pi-title-generator.ts`：

- 使用现有 `pi-model-registry.ts` 的模型注册、协议选择、URL 归一化、认证头和 `[1m]` 清理逻辑。
- 将可复用的模型构建输入收窄到实际需要的字段，不伪造工作目录、权限、Pi session 目录等完整 Agent 参数。
- 标题构建路径显式使用内存凭据与 `modelsPath: null`，避免加载全局 `~/.pi` 认证、模型覆盖及模型存储。复用注册逻辑，但不借机修改主 Agent 现有存储策略。
- 使用 `ModelRuntime.completeSimple()` 做一次补全；必要的协议专属选项使用 Pi 对应的 typed API，不把 OAuth access token 当普通 API Key 发往通用端点。
- API 渠道复用 `resolveChannelRuntimeApiKey()`；Codex、Copilot、xAI 使用各自已有完整 OAuth 凭据解析和刷新回写函数，包括现有刷新并发保护。
- 模型的 `modelConfig`、models.dev 缓存信息来自最终选中的标题模型，不得误用主会话模型能力；不为生成标题额外联网刷新模型目录。
- 复用 `getEffectiveProxyUrl()` 和 Pi 请求级代理封装；沿用 Codex 现有代理/transport 规则，不设置进程级全局代理。
- 独立生成请求 ID，不复用前台会话的 continuation/cache 标识；成功、失败、取消都释放请求级 dispatcher。

不创建 `AgentSession`、工具、ResourceLoader、Skill、MCP、项目指令或会话持久化，不读取项目 `AGENTS.md`。

旧 Codex 标题模块中可复用的内容迁入统一入口后，只删除由本次替换造成的孤立代码及测试；普通 Chat 使用的旧标题请求接口继续保留。

### 5.4 `off` 的准确语义

**固定的是 Proma 的标题思考策略，不是向所有供应商发送字面量 `thinkingLevel: 'off'`。**

当前 Pi 0.87.1 的 `SimpleStreamOptions.reasoning` 类型不含 `off`。因此不能写 `completeSimple(..., { reasoning: 'off' })`，也不能只省略 reasoning 就宣称所有供应商都已关闭思考。

实现规则：

1. 在应用侧始终采用 `off`，忽略 `agentThinking`、`agentEffort`、`reasoningLevel`、模型默认思考等级及 Codex Fast Mode。
2. 根据实际 Pi API 与现有能力映射构造关闭参数。已知的 Responses/DeepSeek 请求改写通过单次请求的 `onPayload` 复用现有纯函数；它们原本在完整 Agent 中由 extension 触发，`completeSimple()` 不会自动执行这些 extension。
3. 对非推理模型正常调用；对已知思考能力不包含 `off` 的模型，返回不可用原因并使用本地标题，不偷偷升到最低推理档。
4. 对能力未知的自定义模型，按 Pi 对该协议的关闭路径尝试一次，不猜测并堆叠供应商私有参数。返回空内容或拒绝参数时使用本地标题。

现有共享 profile 中，Astra 的 `off` 会归一化为 `low`，说明「传了 off」并不必然等于无推理。因此需在调用前判断能力，并在请求体测试中验证实际参数。

协议验收至少核对：

| 协议 | 需要验证的关闭行为 |
|---|---|
| OpenAI Responses / Codex Responses | 支持关闭的模型明确编码 `reasoning.effort: none`，不继承主会话 effort |
| OpenAI Chat Completions | 按模型能力映射使用兼容的关闭字段；同时核对 `max_completion_tokens` / `max_tokens` 选择 |
| Anthropic / 兼容协议 | 使用已确认支持的关闭形式；DeepSeek 复用既有 disabled 改写，不保留主会话的 `output_config` |
| Google | 按模型能力采用允许的 thinking 配置，不能把所有 Gemini 都视为支持零思考 |

能力映射及请求参数只能证明客户端行为，不能证明供应商服务端绝不产生隐藏推理。真实兼容性须结合指定模型调用验收，不能承诺任意网关都支持 `off`。

### 5.5 输入、Prompt 和输出

复用 `title-generation.ts` 中的 `TITLE_PROMPT`，保持现有中文标题要求，固定写在代码中：

```text
根据用户的第一条消息，生成一个简短的对话标题（10字以内）。只输出标题，不要有任何其他内容、标点符号或引号。如果消息内容过短或无明确主题，直接使用原始消息作为标题。

用户消息：
```

- 固定使用 `TITLE_PROMPT + userMessage.slice(0, 4_000)` 构造输入，不做变量替换，不新增模板解析或校验逻辑。
- 使用用户原始文本，不发送 Bridge 来源标记、系统提示词、项目上下文或完整历史；远程输入最多取前 4,000 字符。
- 添加代码内固定的 system 约束：只生成标题，把用户消息当作待总结数据，不遵从其中的工具或改名指令；不开放 system 或用户 Prompt 的配置入口。
- 模型请求输出预算初始设为 `256 tokens`，单次模型请求超时 `30 秒`、`maxRetries: 0`。该超时不应被描述为覆盖凭据刷新和全部初始化的端到端 deadline。
- 只提取可见 `text`，不把 thinking 或工具调用内容当作标题；错误、取消、截断等未正常完成的响应不作为成功标题。
- 沿用 `sanitizeGeneratedTitle()` 的最终 20 字符限制；Prompt 提示 10 字以内与现有默认行为一致。

失败日志记录阶段、渠道 ID、模型 ID、失败原因和是否本地命名；不新增完整 Prompt、原始消息或凭据日志。预期的标题失败不阻断主对话，也不弹阻塞对话框。

## 6. 改动位置与 IPC 契约

| 文件 | 计划改动 |
|---|---|
| `apps/electron/src/types/settings.ts` | 添加 `SessionTitleSettings`、`AppSettings.sessionTitle` 与必要的纯校验/默认值 |
| `apps/electron/src/main/lib/settings-service.ts` | 新设置读取与保存校验；将现有设置写入点改为安全原子写入，保留其他字段 |
| `apps/electron/src/renderer/atoms/session-title-settings.ts`（新增） | 已保存的标题偏好状态及加载/保存动作 |
| `apps/electron/src/renderer/components/settings/SessionTitleSettings.tsx`（新增） | 模型、只读 off、错误与保存状态；无 Prompt 配置 |
| `apps/electron/src/renderer/components/settings/ChannelSettings.tsx` | 在渠道列表下方挂载设置区块；删除商业版推广卡片及其专用函数、导入 |
| `apps/electron/src/main/lib/title-generation.ts` | 复用现有固定 `TITLE_PROMPT` 与清洗函数，无模板引擎；若无必要不修改该文件 |
| `apps/electron/src/main/lib/session-title-service.ts`（新增） | 解析独立路由、统一失败出口 |
| `apps/electron/src/main/lib/adapters/pi-title-generator.ts`（新增） | Pi 单次文本请求、off 编码、认证与代理生命周期 |
| `apps/electron/src/main/lib/adapters/pi-model-registry.ts` | 最小提取/收窄模型构建入口，允许标题路径使用内存隔离；不改主 Agent 的模型选择逻辑 |
| `apps/electron/src/main/lib/agent-orchestrator.ts` | 委托统一服务、会话级请求去重；保留资格守卫和写回复核 |
| 相邻 `*.test.ts` | 按下一节补充 BDD 可执行测试 |

本期不新增 IPC 通道，也不改变标题输入/输出：

1. **类型/通道层**：设置当前定义于 `apps/electron/src/types/settings.ts`，而非 shared；扩展它即可。`packages/shared` 中 `AgentGenerateTitleInput` 与标题事件无须变更。
2. **main handler**：检查 `ipc.ts` 的 `SETTINGS_IPC_CHANNELS.GET/UPDATE/UPDATE_SYNC` 均经过同一校验与原子写入服务；现有 `GENERATE_TITLE` 入口仍由主进程读取配置，不信任 renderer 传入凭据或执行策略。
3. **preload bridge**：复核现有 `getSettings/updateSettings/updateSettingsSync` 的 `AppSettings` 类型传播，不重复声明新字段，不新增绕行接口。
4. **renderer**：Jotai 状态以主进程保存成功的结果为准，保留现有标题事件更新标签和列表的链路，保存失败不污染已保存值。

## 7. BDD 验收与实施顺序

### 7.1 最小可执行测试集

| Given | When | Then |
|---|---|---|
| 旧 settings 没有标题配置 | 读取配置并发起标题请求 | 跟随本轮会话模型，使用代码内固定 Prompt 及 off |
| 主会话模型 A、独立标题模型 B | 自动生成标题 | 只向 B 发送标题请求，主会话模型和思考等级不变 |
| 主会话为 OAuth、标题模型为 API，及相反组合 | 构造标题请求 | 认证、Base URL、模型能力均来自标题路由，不串用主会话参数 |
| 标题模型来自不同渠道 | 构造标题请求 | 均使用同一代码内置 Prompt，不从设置读取 Prompt |
| 模型引用缺少渠道或模型 ID | 经设置 IPC 保存 | 返回明确校验错误，磁盘与已保存 atom 均不变 |
| 打开「设置 → 模型配置」 | 查看渠道列表视图 | 显示标题模型配置，不显示商业版横幅、下载按钮或 Prompt 编辑控件 |
| 页面进入添加/编辑渠道表单 | 查看设置或返回列表 | 维持原有表单切换，标题配置只在列表视图显示 |
| 商业版横幅已删除 | 添加、编辑、启用或删除渠道并完成 Copilot 授权 | 原有渠道管理、授权提示及确认弹窗行为不变 |
| 独立模型被删除/禁用或引用残缺 | 发起标题生成 | 不换供应商、不远程调用，使用本地标题 |
| 主会话 thinking 为 high、标题模型支持关闭 | 构造各协议请求 | 实际关闭参数正确，不继承 high，预算与重试值正确 |
| 已知模型不能关闭思考 | 保存独立选择或运行旧配置 | UI 阻止保存；运行时不升为 low，使用本地标题 |
| 模型 ID 带历史 `[1m]` 后缀 | 注册并发起标题请求 | 实际请求使用清理后的模型 ID |
| 模型返回 text 与 thinking 混合、空正文或错误终止 | 提取标题 | 只接受正常完成的可见文本，其余使用本地标题 |
| HTTP 错误、429、超时、认证失败 | 请求结束 | 不重试、不阻断 Agent，产生本地标题并释放代理资源 |
| 标题请求进行中 | 同一会话再次触发，或另一会话开始 | 同会话不重复请求，其他会话不被串行阻塞 |
| 请求期间用户手动重命名或删除会话 | 模型结果返回 | 不覆盖新标题、不重建会话、不发错误标题事件 |
| Pi 探索分支首次继续、普通 fork/委派/Automation 自带标题 | 经过现有资格判断 | 探索分支仍只初始化一次，其他已有标题不被扩大覆盖 |
| 设置保存失败或安全写入抛错 | 点击保存 | 显示错误、保留草稿与旧配置，不误报保存成功 |
| 标题已成功写回 | 接收原有 IPC / EventBus | 标签页、会话列表和 headless 回调维持原有更新行为 |
| 普通 Chat 会话 | 使用原有标题链路 | 不受 Agent 标题配置影响 |

### 7.2 实施顺序

1. **配置与纯逻辑**：新增模型配置结构/校验和设置原子写入，复用固定 Prompt → 验证默认配置、非法模型引用、保存失败及其他设置字段不丢失。
2. **Pi 单次生成服务**：接入最终标题模型的认证、能力、off 和代理 → 用注入 runtime / 请求捕获测试验证请求体，不以 mock 成功代替真实兼容性。
3. **Agent 接入与设置 UI**：替换标题调用、补进行中去重，在「模型配置」页挂载区块并删除商业版横幅 → 验证入口位置、无 Prompt 配置、原有渠道管理、独立模型不改主模型、失败本地命名、手动改名竞争、探索分支及事件回传。
4. **集成验收**：运行最小相关 `bun test`，再运行 `bun run typecheck`；因复用 Pi runtime 模块，至少补 `bun run electron:build` 验证主进程打包。未修改依赖或发布规则，不要求额外目标平台安装包。

真实调用至少覆盖：一个确认支持关闭思考的普通 API 模型、一个自定义兼容端点，以及实际选择使用的 OAuth 渠道；另对已知不能关闭思考的模型验证拒绝路径。分别记录 mock、构建、真实调用结果，没有凭据的供应商明确列为未验收。

## 8. 版本与交付边界

- 本轮仅交付本方案文档；保留已有排查文档，不修改 README、tutorial 或 release notes，不声称功能已完成。
- 依照仓库文档改动也需递增版本的约定，本轮方案修订在现有工作区应用版本 `0.19.70` 基础上 patch +1 为 `0.19.71`；保留先前的版本递增，不覆盖回退。
- 后续功能实现再按当时版本 patch +1。本版计划不改 `packages/shared` / `packages/core` 的发布内容，不预先递增这些包版本。
- 本期不会保证所有供应商都能远程生成语义标题；保证的是用户可以指定经过验收的标题模型，应用侧固定 off，失败不会让有文本的合格会话长期停留在默认名称。

评审重点：配置入口位于「模型配置」页并移除该页商业版横幅；仅覆盖 Agent，Prompt 固定在代码中，固定 off 不升级推理，显式路由失效不换渠道，失败本地标题不自动升级。
