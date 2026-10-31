# Proma 模型目录与模型添加重构方案

> 状态：设计草案
>
> 日期：2026-10-31
>
> 本文仅描述方案，不包含实现代码。

## 1. 目标与边界

### 目标

1. 新模型无需修改 Proma 白名单代码即可添加和使用。
2. 使用 `models.dev` 作为模型默认信息来源：
   - 上下文长度
   - 最大输出
   - 是否支持推理
   - 默认思考等级
   - 图像/文档输入能力
   - 模型显示名称
3. 模型添加页面参考 PI-Desktop：
   - 可搜索模型列表
   - 已启用模型与可用模型分区
   - 每个模型可展开高级配置
   - 支持手动输入模型 ID
   - 支持自定义上下文长度、最大输出和思考等级
4. 保留 Proma 现有界面风格，不直接复制 PI-Desktop 的视觉样式。
5. 保持本地优先和凭据安全：
   - 不向 `models.dev` 发送 API Key
   - 离线时仍可使用已缓存的模型目录
   - 模型配置继续使用现有 JSON 原子写入机制

### 不在第一阶段处理

- 不把 `models.dev` 当作供应商真实可用模型列表。
- 不替换现有供应商 API 的模型发现逻辑。
- 不新增价格、计费、模型排行榜等 UI。
- 不重新设计整个 Provider/Channel 架构。
- 不复制 PI-Desktop 中复杂的账户、插件、供应商排序和模型拖拽能力。
- 不修改已有聊天历史的模型 ID。

## 2. 当前实现问题

### 2.1 模型配置结构过于简单

当前 `ChannelModel` 只有 `id`、`name`、`enabled`、`source` 字段，位置为：

`packages/shared/src/types/channel.ts:320`

因此无法保存上下文长度、最大输出、思考等级集合、默认思考等级，以及用户覆盖值和默认值的来源。

### 2.2 添加模型依赖手工输入

当前 `ChannelForm` 的模型添加逻辑只保存模型 ID 和名称：

`apps/electron/src/renderer/components/settings/ChannelForm.tsx:476`

手动输入区域位于：

`apps/electron/src/renderer/components/settings/ChannelForm.tsx:1373`

供应商切换时还会写入硬编码预设模型：

`apps/electron/src/renderer/components/settings/ChannelForm.tsx:401`

新模型因此必须修改代码或等待供应商专用预设更新。

### 2.3 供应商模型发现与默认元数据混在一起

`channel-manager.ts` 按供应商协议请求模型列表：

`apps/electron/src/main/lib/channel-manager.ts:1876`

这个列表可以回答“当前 API Key 或订阅账号能使用哪些模型”，但不能稳定提供准确的上下文长度、最大输出和思考能力。

### 2.4 Pi runtime 仍使用内置模型默认值

Pi 模型默认值和模型家族推断位于：

`apps/electron/src/main/lib/adapters/pi-model-registry.ts:694`

模型注册位于：

`apps/electron/src/main/lib/adapters/pi-model-registry.ts:1003`

未知模型最终会回退到 Proma 或 Pi 的通用默认值。

## 3. 参考 PI-Desktop 的核心设计

重点参考：

- `D:\Code\PI-Desktop\apps\desktop\electron\main\models-dev-catalog.ts`
- `D:\Code\PI-Desktop\apps\desktop\src\components\settings\ModelSelectionPanes.tsx`
- `D:\Code\PI-Desktop\docs\adr\models-dev-catalog-authority.md`

### 3.1 models.dev 只负责默认元数据

`models.dev` 提供模型名称、上下文和输出限制、推理选项、模态能力等信息。

供应商 API 或 OAuth 返回的列表仍然决定当前渠道真实可用的模型 ID：

```text
供应商 API / OAuth -> 当前账号可以使用哪些模型
models.dev        -> 这些模型的默认能力和限制
```

### 3.2 用户配置优先于目录默认值

建议采用以下优先级：

```text
用户手动覆盖
    > models.dev 精确匹配
    > Proma 现有 Pi 能力推断
    > Proma 当前通用默认值
```

上下文长度和最大输出分别记录来源，避免目录刷新覆盖用户配置。

### 3.3 手动输入模型先添加，再异步补全

手动输入模型时：

1. 立即添加模型行。
2. 先使用 Proma 通用默认值。
3. 从本地 `models.dev` 快照查询。
4. 只有未被用户修改的字段才被查询结果更新。
5. 查询失败不阻塞模型添加。

## 4. 建议的数据结构

建议扩展 `ChannelModel`，但不把完整的 `models.dev` 记录复制进 `channels.json`：

```ts
export interface ChannelModel {
  /** 实际发送给供应商的模型 ID */
  id: string

  /** 显示名称 */
  name: string

  /** 是否出现在模型选择器 */
  enabled: boolean

  /** 模型列表来源，保留现有语义 */
  source?: 'manual' | 'fetched'

  /** 有效上下文窗口，token 数 */
  contextWindow?: number

  /** 上下文窗口来源 */
  contextWindowSource?: 'catalog' | 'user'

  /** 有效最大输出，token 数 */
  maxTokens?: number

  /** 最大输出来源 */
  maxTokensSource?: 'catalog' | 'user'

  /** 可用思考等级 */
  thinkingLevels?: AgentThinkingLevel[]

  /** 新会话默认思考等级 */
  defaultThinkingLevel?: AgentThinkingLevel | null

  /** 用户对图像输入能力的显式覆盖 */
  supportsImages?: boolean | null

  /** 用户对文档输入能力的显式覆盖 */
  supportsDocuments?: boolean | null
}
```

说明：

- `source` 继续表示模型来自手动添加还是供应商拉取。
- `contextWindowSource` 和 `maxTokensSource` 单独表示配置来源。
- `models.dev` 的描述、价格、发布日期等不进入渠道配置。
- 思考协议映射仍由 Proma 现有 runtime/profile 负责，不把供应商协议字段直接存入用户配置。

未知模型继续使用 Proma 当前默认值，避免直接照搬 PI-Desktop 的默认值导致行为变化。

## 5. models.dev 同步设计

### 5.1 快照位置

新增随应用分发的快照：

```text
apps/electron/resources/models.dev/api.json
```

打包时通过 `electron-builder.yml` 的 `extraResources` 分发。

### 5.2 主进程目录服务

新增：

```text
apps/electron/src/main/lib/models-dev-catalog.ts
```

职责：

- 加载内置快照
- 加载用户缓存快照
- 解析 `models.dev` JSON
- 按供应商和模型 ID 查询
- 将模型信息转换为 Proma 内部结构
- 执行显式刷新
- 保存目录状态

建议状态结构：

```ts
interface ModelsDevCatalogStatus {
  loaded: boolean
  source: 'bundled' | 'cache' | 'remote' | 'empty'
  fetchedAt?: number
  providerCount: number
  modelCount: number
  lastError?: string
}
```

### 5.3 同步策略

推荐：

1. 应用启动时只读取内置快照或本地缓存。
2. 不在启动时强制访问网络。
3. 设置页提供“同步模型目录”按钮。
4. 同步成功后校验 JSON、原子写入用户缓存并替换内存目录。
5. 同步失败时保留旧缓存，不清空当前模型信息。

用户缓存建议单独存储：

```text
~/.proma/models-dev/catalog.json
```

写入使用 `apps/electron/src/main/lib/safe-file.ts` 的原子写封装。

### 5.4 安全约束

请求 `models.dev` 时：

- 不携带供应商 API Key。
- 不携带解密后的 Channel 凭据。
- 不把用户自定义请求头转发过去。
- 可复用 Proma 当前代理配置。
- 设置合理的超时和 JSON 大小限制。

## 6. 模型匹配规则

### 6.1 匹配优先级

查询模型默认信息时依次使用：

1. `ProviderType` 对应的 models.dev provider key + 精确模型 ID。
2. 当前 Base URL 对应的 provider key + 精确模型 ID。
3. 自定义渠道下全局唯一的精确模型 ID。
4. 无匹配时返回通用默认值。

### 6.2 不做宽松模糊匹配

第一阶段不按模型名前缀、`latest`、日期后缀或相似家族自动推断上下文。多个发布方存在冲突时，保留通用值并在 UI 标记“未找到明确的 models.dev 默认信息”。

## 7. 模型添加页 UI 方案

### 7.1 保留 Proma 页面结构

继续使用 `SettingsSection`、`SettingsCard`、`SettingsRow`、`Input`、`Button`、`ScrollArea` 和现有主题变量，不直接引入 PI-Desktop 的 CSS 或颜色。

### 7.2 可用模型区

可用模型行显示：

- 复选框
- 模型 ID
- 显示名称
- 上下文长度
- 最大输出
- 推理/视觉等能力标记
- `models.dev` 来源提示

搜索只在本地执行，不触发额外网络请求。

### 7.3 已启用模型区

已启用模型使用紧凑行，点击“高级”展开：

- 上下文长度预设和数字输入
- 最大输出预设和数字输入
- 思考等级 chips
- 默认思考等级选择器
- 图像输入和文档输入能力
- 当前值来源提示
- 恢复目录默认

字段旁显示“跟随 models.dev”“已手动覆盖”或“使用 Proma 默认”等轻量提示，避免大块警告卡片破坏设置页密度。

### 7.4 手动添加模型

保留现有手动添加入口，只要求输入模型 ID。添加后立即生成模型行并展开高级配置，再异步查询本地目录。

### 7.5 响应式布局

桌面宽度使用左右两栏：左侧可用模型，右侧已启用模型；窄窗口自动上下堆叠。使用现有 `ScrollArea`，不缩小字段到不可读尺寸。

## 8. IPC 设计

新增 models.dev 相关 IPC，并同步四层契约：

```text
packages/shared -> apps/electron/src/main/ipc.ts
              -> apps/electron/src/preload/index.ts
              -> renderer
```

建议新增：

- `MODELS_DEV_STATUS`
- `MODELS_DEV_REFRESH`
- `MODELS_DEV_LOOKUP`
- `MODELS_DEV_LOOKUP_MANY`

模型查询结果只返回 Proma 所需的元数据，不返回完整原始目录记录。

供应商实时模型列表仍由现有 `FETCH_MODELS` 负责。

## 9. 运行时接入

### 9.1 Agent/Pi runtime

`agent-orchestrator.ts` 根据 `channelId + modelId` 查找当前 `ChannelModel`，将有效配置传给 Pi runtime。

上下文和最大输出采用来源感知的优先级：

```text
用户配置 > models.dev > Pi catalog / Proma 推断 > Proma 默认值
```

注册给 Pi 的模型使用有效 `contextWindow`、`maxTokens` 和 `thinkingLevels`。思考协议映射仍由 Proma 当前 provider/profile 生成，不把 `models.dev` 的未知协议字段直接发送给供应商。

### 9.2 思考等级解析

扩展 `apps/electron/src/main/lib/agent-thinking-level.ts`，建议优先级：

```text
会话中显式选择
    > 当前 ChannelModel.defaultThinkingLevel
    > 全局 agentEffort
    > 模型 capability 默认值
```

发送前继续执行现有 reasoning profile 归一化：不支持的等级自动降级，不向供应商发送非法等级。已知 DeepSeek、GLM、OpenAI、Gemini 等协议继续使用现有专用映射。

### 9.3 Chat 模式

当前 Chat 适配器的 `StreamRequestInput` 没有统一的 `maxTokens` 字段，部分适配器仍使用内部固定值。

建议：

1. Agent/Pi runtime 先完整使用模型配置。
2. 同步扩展 `packages/core/src/providers/types.ts` 的 `StreamRequestInput`，增加可选 `maxTokens`。
3. OpenAI、Anthropic、Google、Responses 适配器按各自协议传递。
4. `contextWindow` 暂不直接转换为历史轮数，因为当前 Chat 使用轮数裁剪而不是 token 级裁剪；先用于上下文显示和后续预算判断。

Anthropic 思考模式继续遵守 `budget_tokens < max_tokens` 约束，避免自定义配置导致 400 请求。

## 10. 配置迁移

当前 `ChannelsConfig` 版本为 7，建议升级到 8，但不做破坏性迁移。

旧模型没有新增字段时：

- 保留原模型 ID、名称、启用状态。
- 运行时按新优先级解析目录默认值。
- 用户下一次保存模型时再补全新字段。

字段来源规则：

- 目录自动填充：`contextWindowSource: 'catalog'`。
- 用户编辑输入框或预设按钮：`contextWindowSource: 'user'`。
- 点击“恢复目录默认”：删除用户覆盖并恢复 `catalog`。
- 最大输出独立处理，不与上下文窗口共用来源标记。

## 11. 文件改动范围

### Shared

```text
packages/shared/src/types/channel.ts
packages/shared/src/types/agent.ts
packages/shared/src/types/reasoning-profile.ts
packages/shared/src/ipc.ts
```

### Main

```text
apps/electron/src/main/lib/models-dev-catalog.ts
apps/electron/src/main/lib/channel-manager.ts
apps/electron/src/main/lib/adapters/pi-model-registry.ts
apps/electron/src/main/lib/agent-thinking-level.ts
apps/electron/src/main/lib/agent-orchestrator.ts
apps/electron/src/main/ipc.ts
```

### Core Provider

```text
packages/core/src/providers/types.ts
packages/core/src/providers/openai-adapter.ts
packages/core/src/providers/openai-responses-adapter.ts
packages/core/src/providers/anthropic-adapter.ts
packages/core/src/providers/google-adapter.ts
```

### Preload / Renderer

```text
apps/electron/src/preload/index.ts
apps/electron/src/renderer/components/settings/ChannelForm.tsx
apps/electron/src/renderer/components/settings/ChannelSettings.tsx
```

### Resources / Build

```text
apps/electron/resources/models.dev/api.json
apps/electron/electron-builder.yml
```

## 12. 测试方案

### 12.1 models.dev 解析测试

新增 `apps/electron/src/main/lib/models-dev-catalog.test.ts`，覆盖 provider/model 解析、上下文和输出限制、reasoning options、modalities、无效字段、provider 精确匹配、重复模型 ID 歧义和未命中默认值。

### 12.2 配置与迁移测试

覆盖旧版 `ChannelModel` 读取、新字段缺失、用户覆盖、目录刷新不覆盖用户配置、恢复目录默认，以及手动模型不被供应商刷新删除。

### 12.3 Runtime 测试

覆盖 models.dev 上下文、用户上下文覆盖、最大输出覆盖、未知模型默认值、思考等级归一化和非法等级不发送。

### 12.4 Provider adapter 测试

覆盖 OpenAI `max_tokens`、Anthropic 思考模式限制、Google `generationConfig.maxOutputTokens`、Responses API 输出限制，以及未配置时保持原有行为。

### 12.5 BDD 验收场景

#### 新增未进入白名单的模型

```text
Given 供应商 API 返回一个 Proma 未硬编码的模型 ID
When 用户在设置页勾选该模型
Then 模型可以被保存并出现在模型选择器中
```

#### 目录命中

```text
Given models.dev 包含该模型的上下文和输出限制
When 用户添加模型
Then 页面显示 models.dev 默认值
And 页面显示“跟随 models.dev”
```

#### 手动覆盖

```text
Given 模型默认上下文为 200K
When 用户修改为 128K 并保存
And models.dev 后续刷新为 1M
Then 模型仍使用 128K
And 页面显示“已手动覆盖”
```

#### 手动输入未知模型

```text
Given models.dev 不包含该模型
When 用户手动添加模型 ID
Then 模型立即出现
And 使用 Proma 通用默认值
And 用户可以继续修改高级配置
```

#### 离线使用

```text
Given models.dev 网络不可用
When 用户打开模型配置页
Then 使用内置或上次缓存的目录
And 已保存的模型不消失
And 模型仍可正常运行
```

#### 凭据隔离

```text
Given 渠道配置了 API Key
When Proma 同步或查询 models.dev
Then 请求中不包含该 API Key
```

## 13. 实施阶段

### Phase 0：目录服务与数据模型

实现并验证内置快照加载、刷新、缓存和模型查询，不改 UI 和 runtime。

### Phase 1：ChannelModel 扩展与迁移

验证旧 `channels.json` 可读取，新字段可以保存，原子写入正常，版本迁移无数据丢失。

### Phase 2：模型添加页改造

实现可用模型/已启用模型分区、搜索、手动添加、异步补全和高级配置。

### Phase 3：Agent/Pi runtime 接入

验证上下文长度、最大输出、思考等级和用户覆盖优先级。

### Phase 4：Chat adapter 接入与打包验证

验证 Chat 请求、各协议输出限制、`bun run typecheck`、相关 `bun test`、`bun run electron:build` 和打包后资源读取。

## 14. 版本策略

正式实施时至少递增：

- `@proma/shared` patch 版本
- `@proma/electron` patch 版本
- 修改 Provider adapter 时递增 `@proma/core` patch 版本

默认 Skill 不涉及本方案，因此不需要递增 Skill 版本。

## 15. 推荐结论

第一版采用以下方向：

1. `models.dev` 使用“随应用分发快照 + 设置页手动同步”。
2. 供应商实时模型列表继续作为真实可用模型边界。
3. `ChannelModel` 增加上下文、最大输出、思考等级和来源字段。
4. 高级配置使用 Proma 现有 `SettingsCard` 与 `SettingsSection` 风格。
5. Agent/Pi runtime 先完整接入。
6. Chat adapter 同步增加 `maxTokens`，但不把上下文窗口直接转换为历史轮数。
7. 用户覆盖永远优先于 models.dev。
8. 未知模型仍可手动添加，不因为目录未收录而阻塞。
