# 侧边栏双层置顶与项目归档实施方案

> 状态：功能代码已实施；自动化、构建与 Chromium 冒烟结果见第 13 节，原生 Electron 验收尚未完成。
>
> 日期：2026-11-03
>
> 文档版本：0.1.2
>
> 设计依据：[侧边栏会话双层置顶与项目归档设计方案](./2026-11-02-sidebar-session-pinning-project-archive-design.md)

## 1. 执行合同与完成定义

用户已认可设计方案，本文将设计第 1.2 节建议纳入实施基线。用户随后于 2026-11-03 授权“开始实施”，代码和验证已按本文推进，实际完成边界见第 13 节。未操作真实会话数据，未提交或推送 Git。原设计文档作为设计过程记录保留，不回写其历史评审状态。

| 能力 | 固定行为 |
| --- | --- |
| 项目内置顶 | 会话留在项目，全部置顶排在普通会话前；多个置顶按更新时间降序，不手动排序 |
| 全局置顶 | 只有已项目内置顶的活跃项目会话能进入；全局只展示一份，标注项目，不改变归属 |
| 移回项目 | 拖回原项目或菜单移回，保留项目内置顶；拖到其他项目不迁移 |
| 取消项目内置顶 | 同时清除全局标记 |
| 项目归档 | 默认项目拒绝；该项目全部会话归档并清除双层置顶，关闭相关标签，保留文件与配置 |
| 忙碌项目 | 有运行、启动预检或待发送队列时拒绝归档，不自动停止 Agent |
| 项目恢复 | 只恢复项目，不批量激活会话，不自动重新置顶 |
| 会话恢复 | 所属项目必须先恢复；母子会话级联保留既有行为 |
| 已归档入口 | 一个按钮、一个视图，项目/会话两个区域分别计数，空归档项目也可恢复 |
| 后台执行 | Automation、Collaboration、IM、元数据更新不能唤醒归档项目 |
| 历史保留 | 项目仍归档时不按归档期限清理正文；恢复项目后重新适用原规则并告知 |
| 存量数据 | 旧 pinned 解释为项目内置顶；新字段缺省 false，不搬文件、不批量改写历史 |

完成条件：相关 BDD 测试通过、全仓类型检查通过、Electron 构建通过，并在隔离数据中完成实际桌面验收。分别记录单元测试、构建、桌面交互结果，不相互替代。

不新增依赖、数据库、通用状态机、会话手动排序、归档快照或跨文件事务框架；不重写普通 Chat、运行身份、权限、项目目录布局和活跃列表渲染架构。

## 2. 基线、实施前检查与代码依据

本文编写开始时应用版本为 `0.19.75`，共享包为 `0.1.78`。工作区已有设计文档、应用版本修改和 `bun.lock` 差异；不得整体还原或覆盖。实际实现时重新核对版本，不照抄过期 patch 数字。

实施前依次执行：

1. 重读 `AGENTS.md`、设计与本文，检查 `git status --short` 和 `git diff`。
2. 记录原有 `bun.lock` 差异，仅在后续需要时同步本功能的 workspace 版本项，保留原差异。
3. 先运行既有最小相关测试及 `bun run typecheck`，单独记录基线失败。
4. 核对 `config-paths.ts` 中 `PROMA_DEV` 的目录规则；测试使用临时目录，桌面验收用可丢弃开发数据，不写真实用户配置。
5. 测试前保存 fixture 的项目、JSONL、Pi artifact、workbench 和配置校验信息，用于验证归档不删文件。

本轮补充核实的现有实现：

| 位置 | 现状与实施要求 |
| --- | --- |
| `renderer/lib/session-reference-drag.ts`、`LeftSidebar.tsx` | 会话已有拖入输入框引用，MIME 独立且 effectAllowed 为 copy；全局拖拽不能破坏它 |
| `main/lib/agent-service.ts`：`isAgentSessionBusy()` | 覆盖 renderer 启动占用、active 与 deferred queue；复用并补 headless 预检空窗 |
| `main/lib/agent-orchestrator.ts`：`sendMessage()` | 项目根/凭据 await 早于 activeSessions 登记；归档必须能识别这段已接受的请求 |
| `main/lib/automation-manager.ts`：`appendRun()` | skipped 不推进 nextRunAt，一次性任务仍指向原计划时间；只跳过 tick 不能满足恢复不补跑 |
| `renderer/main.tsx` | 持久标签可能加载归档会话；恢复时要检查项目 |
| `main/lib/storage-service.ts` | getActiveSessionIds/getActiveWorkspaceSlugs 实际保留完整索引，不可改成仅活跃集合 |

## 3. 顺序与修改落点

```text
T1 数据和持久化 -> T2 归档编排/运行门禁 -> T3 四层 IPC
 -> T4 分组/会话树 -> T5 双层置顶 UI/拖拽
 -> T6 归档视图/标签/导航 -> T7 后台任务/历史保留
 -> T8 集成验证与交付
```

每个任务先写失败测试，再做最小实现；前置任务验收后进入下一项。最终交付必须包含 T7，不能只看到侧栏隐藏就宣布完成。

以下路径均相对仓库根；列出需核查的落点，不强制每个文件都改。

| 文件 | 修改职责 |
| --- | --- |
| `packages/shared/src/types/agent.ts` | 字段、请求响应、IPC 常量；检查 types/index.ts 和 src/index.ts 导出 |
| `apps/electron/src/main/lib/agent-workspace-manager.ts` | 项目归档持久化、活跃校验、完整数组槽位重排 |
| `apps/electron/src/main/lib/agent-session-manager.ts` | 双层置顶、批量归档、恢复守卫、自动解归档与迁移规则 |
| `apps/electron/src/main/lib/agent-project-archive.ts`（新增） | 组合 managers 与 busy 判断的项目归档编排 |
| `apps/electron/src/main/lib/agent-service.ts`、`agent-orchestrator.ts` | 启动、预检、排队门禁 |
| `apps/electron/src/main/ipc.ts`、`src/preload/index.ts` | handler、bridge、类型与返回处理 |
| `apps/electron/src/renderer/atoms/agent-atoms.ts` | 全部项目真源与活跃/归档派生列表 |
| `apps/electron/src/renderer/lib/agent-session-list.ts`、`collapsed-agent-rail.ts` | 分区、去重、会话树、置顶预览与 Rail |
| `apps/electron/src/renderer/lib/sidebar-session-drag.ts`（新增） | 新拖拽 payload/资格纯逻辑，不替代引用模块 |
| `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` | 会话/项目菜单、全局放置目标、归档双区域与 pending/error |
| `apps/electron/src/renderer/hooks/useProjectActions.ts`、`components/agent/CollapsedWorkspacePopover.tsx` | 活跃项目切换候选 |
| `apps/electron/src/renderer/components/agent/AgentView.tsx`、`MoveSessionDialog.tsx` | 只读历史执行限制、迁移目标 |
| `apps/electron/src/renderer/hooks/useOpenSession.ts`、`useSyncActiveTabSideEffects.ts`、`useGlobalAgentListeners.ts` | 打开、聚焦、回调不可重新激活归档项目 |
| `apps/electron/src/renderer/main.tsx`、`components/tabs/TabBar.tsx`、`TabSwitcher.tsx`、`components/shortcuts/GlobalShortcuts.tsx` | 初始化、标签恢复、导航、托盘入口 |
| `apps/electron/src/main/lib/automation-scheduler.ts`、`automation-manager.ts` | 自动任务跳过及不补跑 |
| `apps/electron/src/main/lib/bridge-command-handler.ts`、`feishu-bridge.ts`、`slack-bridge.ts`、`agent-collaboration-tools.ts` | 外部/协作入口返回与绑定保留 |
| `apps/electron/src/main/lib/tray-menu-model.ts`、`storage-service.ts` | 活跃入口过滤与归档正文保护 |
| `apps/electron/src/renderer/components/automation/AutomationFormView.tsx`、`AutomationsListView.tsx`、`components/planning/PlanningView.tsx` | 活跃项目选项和已有归档关联提示 |

未使用的组件不为形式完整而重构；例如 `WorkspaceSelector.tsx` 先核查调用。能由公共门禁覆盖的调用点不重复写另一套业务规则。

## 4. T1：数据与持久化

### 4.1 字段和状态转换

增补既有接口：`AgentWorkspace.archived?: boolean`、`AgentSessionMeta.globalPinned?: boolean`，保留 `pinned` 并改注释为项目内语义。

```text
普通 --项目内置顶--> 项目内置顶 --进入全局--> 全局置顶
普通 <--取消置顶--- 项目内置顶 <--移回项目-- 全局置顶
普通 <--------------取消项目内置顶-------- 全局置顶
任意活跃状态 --会话/项目归档--> 已归档，清双层置顶
已归档 --所属项目活跃且恢复会话--> 普通
```

写入约束：全局 true 必须项目内 true、会话未归档、归属真实活跃项目。设置全局 false 只清标记，不得自动解归档。所有归档写路径（含自动归档）都不得残留全局 true。

保留既有更新时间和星标例外。批量归档仅更新实际变化条目的更新时间，重复请求同一状态不再次推进全部历史时间。新字段缺省 false，不批量迁移、不升索引版本。

### 4.2 管理器最小能力

建议函数名可按现有风格微调，职责固定：

- workspace manager：`assertAgentWorkspaceActive(id)`、`setAgentWorkspaceArchived(id, archived)`。
- session manager：`setAgentSessionGlobalPinned(input)`、`archiveAgentSessionsInWorkspace(workspaceId)`。
- 批量归档从完整索引选项目全部会话，含草稿、已有归档、子会话、探索、自动任务；返回全部受影响 ID，不仅返回发生变化的 ID。
- 一次构造并写入新索引，设置 archived true、pinned/globalPinned false、isDraft false；不逐条调用 toggle，不改正文。
- `updateAgentSessionMeta()` 加可更新字段；归档项目下拒绝显式 archived false/激活置顶，允许后台元数据更新但保留 archived。
- `appendAgentMessage()` 不自动恢复归档项目会话；`appendSDKMessages()` 继续合法追加，不丢弃已产生记录。
- 创建、fork、迁移目标校验活跃项目。元数据有 workspaceId 时以其为准，不能用请求传来的另一个活跃 ID 绕过。
- 跨项目迁移对根及随迁子会话清除 globalPinned，保留各自 pinned/archived 等既有语义。

缓存安全：新批量写入不得原地污染缓存对象；先构造副本、写成功再更新缓存，失败保持磁盘及后续读取一致。复用 `safe-file.ts`，不重构整个持久化系统。

### 4.3 项目槽位排序

输入是活跃真实项目 ID，按新顺序填回完整数组的活跃槽位，归档槽位不变。例：`[A, X(归档), B]` 重排为 B、A，得到 `[B, X(归档), A]`。沿用去重与遗漏项按原顺序接续的行为，不接受归档 ID 被拖入活跃重排。

任务合成组不写项目索引，仍按活跃项目展示列表计算已有 settings 索引。

### 4.4 测试与出口

扩展 `agent-session-manager.test.ts`；新增 `agent-workspace-manager.test.ts`。覆盖缺省字段、全部状态转换、完整索引批量归档、草稿可恢复、迁移清标记、默认项目拒绝、槽位排序、写盘失败不污染缓存。测试只用临时数据，普通 Chat 不变。

## 5. T2：归档编排与运行门禁

### 5.1 同步保存

新增 `agent-project-archive.ts`，组合 workspace/session managers 与 service 的 busy 判断；workspace manager 不反向导入 session manager，避免既有 session -> workspace 依赖成环。

归档：校验项目存在/非默认 -> 从完整索引取会话 -> 任一 busy 即拒绝 -> 一次写会话 -> 写项目 -> 返回结果。检查至两个索引写入之间不插 await。重复归档可收敛数据但不反转状态。恢复不写会话，返回空的受影响会话 ID；按 T7 先整理关联任务调度，再写项目 false。

### 5.2 预检空窗

保留 `isAgentSessionActive()` 的真实运行语义，不将它扩大为所有 busy，以免改变队列注入行为。在 orchestrator 中记录已接受但尚在异步预检的会话，用窄查询方法让 `isAgentSessionBusy()` 同时识别预检占用。

在首次 await 前登记，转 active 时交接，所有早退/异常释放；renderer 已有 start reservation 不重复抢占，同一请求不能拒绝自己。测试将 headless 请求暂停在项目根/凭据 await，随后归档必须无写入地拒绝。

在 `runAgent()` 更新元数据前、队列入队前校验活跃项目；公共 `sendMessage()` 在写用户消息、清旧错误和启动 runtime 前校验，覆盖 headless 及直接调用。拒绝路径须完成错误/终态回调，不留下永久 starting/running。

不要调用删除专用 `stopAgentAndDrain()`，不要设置或清除删除墓碑，不自动停止执行。

### 5.3 部分失败

第一次写会话失败：reject，项目和会话都不宣称成功。会话写成功、项目写失败：返回 partial、实际会话 ID 和未归档项目；renderer 关闭已归档会话标签、刷新真实数据并提示重试，不能把失败项目从活跃列表隐藏。

不做跨文件回滚或事务日志。再次设置同一状态可重试。新增 `agent-project-archive.test.ts` 验证空项目、默认项目、重复操作、busy/预检/队列、两种写失败及恢复不激活会话。

## 6. T3：四层 IPC

| 常量 / 通道 | preload 方法 | 返回 |
| --- | --- | --- |
| `SET_GLOBAL_PIN` / `agent:set-global-pin` | `setAgentSessionGlobalPinned(input)` | `Promise<AgentSessionMeta>` |
| `SET_WORKSPACE_ARCHIVED` / `agent:set-workspace-archived` | `setAgentWorkspaceArchived(input)` | `Promise<SetAgentWorkspaceArchivedResult>` |

输入固定为 `{ sessionId: string; globalPinned: boolean }` 与 `{ workspaceId: string; archived: boolean }`，主进程校验 ID 和 boolean，不用真值强转。新增结果沿用设计的项目与 ID，最小补充实际存在的部分失败区分：

```ts
export interface SetAgentWorkspaceArchivedResult {
  workspace: AgentWorkspace
  affectedSessionIds: string[]
  status: 'success' | 'partial'
  error?: string // 仅 partial，说明项目字段未保存。
}
```

校验及首次保存失败继续 reject，不建立通用错误码框架。现有 TOGGLE_PIN 保留名称但改项目内语义；TOGGLE_ARCHIVE 检查所属项目并清两层置顶。

同步修改共享类型与导出、main handler、preload 声明及 bridge、renderer pending/error/刷新。使用轻量 Electron mock 实际执行 handler 和 bridge 的参数/返回测试，不仅搜索源码是否含通道字符串。

## 7. T4：分组、会话树与可见性

### 7.1 唯一行归属

在 `agent-session-list.ts` 增加必要纯函数：先过滤 archived/draft，确定全局和项目/任务分区，再构树。不能只将 `!pinned` 替成 `!globalPinned`。

- 全局母会话收纳其未独立全局的活跃直接子会话，原项目排除这些已展示 ID。
- 独立全局子会话只在全局作根，不能同时出现在任何母树下。
- 单独项目内置顶子会话、母未置顶时，沿用原置顶可独立展示语义：子作项目置顶根，从母树中排除。
- 母子均项目内置顶时保持一棵母树；移入/移出全局不批量改子标记。
- 保留父不在候选集时孤立子作为根的行为，不隐藏历史。不扩展为无限递归树系统。
- 任务会话留在既有合成组；不为其新增全局拖入资格，不顺带重写已有毕业规则。

### 7.2 预览和 Rail

先取全部项目 pinned 根树，再对其余应用原状态优先、近期窗口、预览名额和显示更多。hiddenCount 和当前会话补入只计算唯一未展示根；置顶不占普通预览额。

Rail 候选是当前项目会话加所有全局会话，去重后沿用现有当前/运行优先。五行不足时，已有 Popover 可访问其余全局候选，不另做一套侧栏。

新增 `agent-session-list.test.ts`，扩展 `collapsed-agent-rail.test.ts`：旧 pinned、混合归档/草稿、超预览名额置顶、母子跨分区、唯一 ID、全局跨项目可达、合成任务组。

## 8. T5：双层置顶 UI 与长按拖拽

### 8.1 菜单和展示

在 `AgentSessionItem` 的右键/三点共用菜单统一文案及动作；保留母会话本身/含子会话选择。全局行标项目，原项目不重复。用 T4 分区替换旧 pinnedAgentSessions 与 hasPinnedVisibleParent 的单一 pinned 判断，仅清理本改动造成的废弃局部代码。

### 8.2 与既有引用拖拽共存

不能通过“未置顶行不再 draggable”实现资格限制：未置顶会话仍要能拖入输入框引用。

| 手势 | 输入框 | 全局区/项目头 |
| --- | --- | --- |
| 未置顶或短按即拖 | 原引用行为 | 不允许全局操作 |
| 合法会话长按约 300ms 后拖 | 仍允许引用 | 允许移入全局/移回原项目 |
| 拖项目 | 不插会话引用 | 仅项目排序 |

保留 `session-reference-drag.ts` MIME；长按达标才追加 `sidebar-session-drag.ts` 专用 MIME、sessionId、源项目与意图。原引用函数设置 copy 后，对双用途拖拽改 `effectAllowed = copyMove`；输入框目标选择 copy，全局目标选择 move。

dragover 不能读取 payload 内容，仿照已有引用模块用本次内存 ID 判断高亮；drop 解析后由主进程重验。项目头先按 MIME 分流，合法处理阻止冒泡，不读 text/plain 猜类型。

约 6px 提前移动取消长按；pointerup/cancel、dragend、失焦、卸载清理计时器。菜单/输入/展开控件不参与长按。普通点击不延迟，拖拽后抑制意外 click，关闭悬停预览。

在活跃滚动列表外放拖拽时才显示的顶部固定放置条，保证全局区为空或已滚出视口仍可达；正常状态不占大块空白。

### 8.3 验证

纯逻辑测试资格、payload、取消、目标分流；Electron 实测“长按后移动能否触发原生 dragstart”，fake timer 不等于交互验收。若 Chromium 接线有差异，修正事件处理，不删长按语义、不直接加依赖。失败请求不乐观移动，成功后才替换元数据。

## 9. T6：归档视图、标签与导航

### 9.1 归档操作

全部项目保留在 `agentWorkspacesAtom`，派生 activeAgentWorkspacesAtom/archivedAgentWorkspacesAtom。项目计数从元数据取得，会话计数复用现有 IPC，不新增统计服务。

项目菜单加确认与 pending，默认禁用且主进程再校验。归档入口按任一区域非空显示，标题分别显示项目数/会话数。虚拟归档行分两个区域，各有空状态；会话仍按项目分组，项目已归档则显示“先恢复项目”。

恢复项目后留在归档视图供按需恢复会话，不自动开旧会话、不创建新会话。确认中明确恢复后旧会话重新受期限清理规则约束。

### 9.2 标签和当前项目

收到成功或 partial 后刷新项目/会话，按 affectedSessionIds 关闭 Agent/preview 标签并清临时 UI，最后确定当前项目与设置。不要复用删除项目流程，不删任务、绑定、正文或配置。

归档当前项目后默认项目优先；若剩余活动 Agent 标签属于别的项目，应选择默认项目已有可用入口或空欢迎态，不能显示项目 B 的会话而把新建目标强写成默认 A。归档非当前项目保持原焦点。

partial 只关闭已归档会话标签，不移除失败项目；reject 不提前关闭。刷新失败提示同步失败并可重试，不显示虚假成功。

### 9.3 历史只读和恢复门禁

- useOpenSession、TabBar、TabSwitcher、快捷导航/托盘共用项目状态判断，不各写另一套恢复规则。
- 历史可按会话自身路径读取；归档项目不能写为全局当前项目。AgentView 显示“先恢复项目”，禁用发送、附件投递、重试、fork、rewind、压缩等执行/正文改写操作。
- 项目恢复而会话仍归档时，提示恢复会话再继续；不能借后台元数据更新恢复。
- 入口只有 ID 时，按需补齐已有归档元数据再判断，不能把未知状态当活跃，也不每次全量读历史。
- 活跃列表刷新时保留当前已打开的只读历史元数据，或从已加载归档集合解析当前会话；否则刷新后会话元数据丢失，AgentView 会错误回退全局项目。只保留已打开条目，不将全部归档历史常驻活跃列表。
- useSyncActiveTabSideEffects、useGlobalAgentListeners 不因历史聚焦或后台完成写回归档项目 ID。
- main.tsx 初始化/标签恢复排除归档项目活跃入口，旧设置指向归档项目则选择默认项目。Chat 不变。
- 项目切换、迁移、Todo/Automation 新关联只列活跃候选；旧归档关联保留并显示“已归档”，不静默改为第一个项目。

为标签转换/最终项目选择提取必要纯函数并测试，不借机重构全部导航。

## 10. T7：后台执行与历史保留

### 10.1 自动任务不补跑

自动触发/手动立即运行都在新建或复用会话前检查项目；自动归档期间跳过，手动明确拒绝。不创建空会话、不消耗 runCount/maxRuns、不增加失败次数、不改 active 偏好/lastSessionId。

不能只调用现有 appendRun(skipped)：它不推进 nextRunAt，会导致恢复后立即补跑，且可能每个 tick 重复写历史。

周期任务的最小处理：归档期间只在到期时将 nextRunAt 用 computeNextRunAt(task, now) 推进到未来，不每个 tick 写盘；恢复项目时再把仍过期的周期任务推进到未来，不补归档期间漏跑。恢复后自动复用会话应排除 archived 的旧会话，正常创建新会话，不隐式恢复项目归档的历史。

一次性任务没有“下一个周期”，且不能改 active 偏好：约定归档期间到期的 once 自动跳过、不重排过去时间、不每 tick 记一条；恢复前将仍过期的 once 保持原计划但自动调度资格为 false，需用户改为未来 scheduledAt 后才能再次自动触发，手动立即运行在项目恢复后仍可显式执行。

实现该资格需要持久记录“因项目归档错过一次性计划”，不能靠内存集合，否则重启补跑。复用已有 runHistory 的 skipped 项，不新增持久字段：skipReason 使用固定前缀及原 scheduledAt（例如 `项目已归档，跳过一次性计划:<scheduledAt>`），由一个小函数生成/判定；UI 展示友好提示。自动资格检查该 once 计划是否有对应记录，记录只写一次；用户修改 scheduledAt 后不再匹配。不要把一般 skipped 全部改成推进时间，也不要将 once 写成 completed 或 disabled。

项目恢复前的调度整理先于项目 archived false 保存，需覆盖归档期间应用未运行、因而没有 tick 记录的过期 once。只整理现有的关联任务；无任务项目无额外保存。整理失败保持项目归档、提示重试；项目字段后续保存失败时保留已整理的调度状态，不反向恢复旧过期时间。整理不改会话恢复语义，仍用原子写封装，不引入新调度服务。

测试使用假时间覆盖 interval/daily/weekly/monthly、once、active false、maxRuns、跨重启、恢复不立即触发、手动执行、scheduledAt 修改、旧归档会话不被复用。检查项目恢复保存失败时不宣称成功。

### 10.2 外部、协作与最近入口

公共创建/运行守卫覆盖桥接与协作；逐一核查通用 bridge、飞书、Slack 及协作 spawn，确认错误可返回用户/父任务，不留下等待。已有绑定保留且显示归档原因，不将“项目已归档”当“项目已删除”自动重绑默认项目。

桥接项目选择列表、tray-menu-model、renderer 最近候选排除归档项目；历史查询可以继续读完整元数据。只改实际绕过点，不重写各 IM adapter。

### 10.3 正文清理

cleanupArchivedSessions() 构造一次归档项目 ID 集合，跳过其全部会话 JSONL 删除。getActiveSessionIds/getActiveWorkspaceSlugs 仍从完整索引取值，归档不是 orphan。

测试构造过期归档会话：归档项目正文保留、活跃项目归档会话按原规则清理；两者元数据、Pi artifact、workbench、项目配置均不因本次筛选改变。项目恢复的提示说明旧会话清理重新适用，防止误以为永久保留。

## 11. T8：测试矩阵与验收命令

### 11.1 自动化覆盖

测试名使用 Given/When/Then 或中文“给定/当/则”结构。下列新增文件为计划，不表示已存在或已通过。

| 测试文件（apps/electron/src 下） | 必须覆盖 |
| --- | --- |
| `main/lib/agent-session-manager.test.ts`（扩展） | 双层约束、批量全覆盖、隐式解归档门禁、迁移、旧字段、写失败 |
| `main/lib/agent-workspace-manager.test.ts`（新增） | 默认拒绝、恢复仅项目、槽位排序、缺省 active |
| `main/lib/agent-project-archive.test.ts`（新增） | 空项目、busy/预检/队列、幂等、partial、完整受影响 ID |
| `main/lib/agent-project-archive-ipc.test.ts`（新增） | handler/bridge 四层调用、输入类型、success/partial/reject |
| `main/lib/agent-workspace-run-guard.test.ts`（新增） | renderer/headless/队列守卫、预检释放、无伪造项目绕过、无用户消息误写 |
| `renderer/lib/agent-session-list.test.ts`（新增） | 置顶全展示、普通额度、父子去重、归档双区空项目 |
| `renderer/lib/collapsed-agent-rail.test.ts`（扩展） | 全局跨项目候选、指示状态与父子去重 |
| `renderer/lib/sidebar-session-drag.test.ts`（新增） | 长按资格、MIME、引用共存、取消、无效目标 |
| `renderer/lib/sidebar-project-navigation.test.ts`（新增） | 当前项目 fallback、partial 关闭标签、历史只读、启动恢复 |
| `main/lib/automation-project-archive.test.ts`（新增） | 跳过、时间推进、once 不补跑、重启、恢复不复用归档会话 |
| `main/lib/storage-project-archive.test.ts`（新增） | 归档项目正文保留、非归档项目期限清理、非孤儿 |

最小验证命令（仓库根执行；新增文件实现后才运行对应项）：

```powershell
bun test ./apps/electron/src/main/lib/agent-session-manager.test.ts
bun test ./apps/electron/src/main/lib/agent-workspace-manager.test.ts ./apps/electron/src/main/lib/agent-project-archive.test.ts
bun test ./apps/electron/src/main/lib/agent-project-archive-ipc.test.ts ./apps/electron/src/main/lib/agent-workspace-run-guard.test.ts
bun test ./apps/electron/src/renderer/lib/agent-session-list.test.ts ./apps/electron/src/renderer/lib/collapsed-agent-rail.test.ts
bun test ./apps/electron/src/renderer/lib/sidebar-session-drag.test.ts ./apps/electron/src/renderer/lib/sidebar-project-navigation.test.ts
bun test ./apps/electron/src/main/lib/automation-project-archive.test.ts ./apps/electron/src/main/lib/storage-project-archive.test.ts
bun run typecheck
bun test
bun run electron:build
git diff --check
```

先最小测试再全量；Bun mock 模块相互污染时分进程复核，记录实际原因，不能把测试删掉当通过。构建失败应保留准确命令、错误与阻塞项，不能笼统报告功能完成。

### 11.2 隔离桌面验收

准备默认、活跃甲乙、待归档丙、空归档丁；会话涵盖旧 pinned、普通、多个置顶、草稿、母子、独立子、自动任务、探索分支及已有归档。深浅主题各走关键路径。

| 编号 | 操作 | 验收结果 |
| --- | --- | --- |
| M1 | 菜单置顶多个旧/新会话 | 留项目最上，不受近期/预览限制，不出现全局副本 |
| M2 | 短拖未置顶会话到输入框 | 原引用插入正常，不得出现全局资格 |
| M3 | 合法长按拖顶部，含全局空态、滚动长列表 | 成功进入，全局一次展示且显示项目，引用拖放仍可用 |
| M4 | 拖回原项目、错项目、Escape、保存失败 | 回原项目保留置顶；其余不改变持久位置，不触发项目排序 |
| M5 | 项目排序混有归档条目，随后恢复 | 活跃顺序与归档槽位正确，合成任务组位置正常 |
| M6 | 默认项目、运行/预检/队列项目请求归档 | 全部拒绝，不停 Agent，不产生部分写入 |
| M7 | 当前项目全量归档 | 全会话含隐藏记录归档，标签关闭，默认焦点正确，文件/配置保持 |
| M8 | 一个已归档按钮，空归档项目 | 两区域/计数/空态正确，空项目不失去恢复入口 |
| M9 | 项目归档时恢复会话/置顶/搜索发送/IM/协作 | 先恢复项目限制有效，不后台激活、不静默重绑 |
| M10 | 恢复项目后按需恢复会话并运行 | 不批量恢复，会话可正常继续，未设置删除墓碑 |
| M11 | 调度跨归档与重启 | 不补跑、不刷 skipped 历史、不复用归档会话、不改 active 偏好 |
| M12 | 清理旧归档正文 | 归档项目正文保留；恢复后的适用规则与提示一致 |
| M13 | 键盘打开菜单、保存 pending/error、重启旧标签 | 可操作、无重复提交/虚假成功、不自动切回归档项目 |

检查日志不输出会话正文或凭据；归档不动本地项目根和受管指令文件，不影响附加目录授权及 Pi resume。没有可用真实外部 IM/模型配置时，自动化 mock 通过与未做 live 验证分别写清。

## 12. 版本、差异与最终交付

- 本轮文档交付按仓库规则仅将应用 patch 由 `0.19.75` 递增到 `0.19.76`，共享包不改。
- 功能实现时从当时版本逐包递增受影响的 apps/electron 与 packages/shared patch，核查 lock 中 workspace 版本，不覆盖用户已有 lock 差异。
- 本方案不授予 commit/push 权限。用户另行要求提交时再按独立可验证阶段组织，提交前检查全部相关差异，不夹带无关内容。
- README/tutorial/release notes 如需更新，另取授权；本轮不更新。
- 交付报告列文件改动、版本、实际命令及结果、桌面场景通过情况、外部验证缺口，不将“写了测试计划”说成“测试通过”。

实施与交付检查清单：

- [x] 基线与用户已有改动已记录。
- [x] T1 数据与持久化测试通过。
- [x] T2 归档编排与 headless 预检门禁通过。
- [x] T3 IPC 接线、preload 执行测试与归档 partial 反馈通过。
- [x] T4 分组去重测试通过，置顶预览规则已接入。
- [ ] T5 长按/引用拖放实际桌面验收通过。
- [x] T6 归档双区、标签及只读代码已落地，恢复顺序通过 Chromium 冒烟。
- [x] T7 调度不补跑、headless 门禁、历史正文保留自动化通过。
- [ ] T8 类型、全量测试、构建、重启及深浅主题验收完成。
- [x] 用户已有差异保留，未自动提交或推送。

## 13. 2026-11-03 实施与验证记录

- 应用版本：`0.19.77`；共享包版本：`0.1.79`。仅同步 lock 中这两个 workspace 版本，保留原有 lock 差异，不新增依赖。
- 相关测试：9 个文件、35 项通过。包含完整索引归档、草稿、幂等、保存失败缓存/partial、默认项目、槽位排序、headless 异步预检、伪造项目启动、调度推进与 once、正文保留、分区、导航与拖拽 payload。
- `bun run typecheck` 通过；`bun run electron:build` 通过。构建保留既有大 chunk 提示，macOS native helper 在 Windows 按脚本跳过，未做安装包冒烟。
- 全量 `bun test`：522 通过、10 失败。另用 `git archive HEAD` 导出未改动源码到临时目录、复用本地依赖复测，512 通过、同名同组 10 失败；本次新增 10 项测试未增加全量失败项。
- 既有失败分为：规划数据库 1 项（全量运行中 Electron 替身不提供可执行路径，独立运行则因缺少二进制无法启动）；Pi 标题真实请求构造 7 项（全量运行中 SDK 替身污染，同文件单独执行 12 项全部通过）；更新缓存 2 项（Windows 下 `/dev/null` 和 chmod 测试假设不成立）。未顺带修改这些无关测试。
- Chromium 冒烟使用实际 LeftSidebar、Jotai、Radix 和主题 CSS，IPC 为隔离内存替身；通过长按后原生 dragstart、全局投放、引用/全局 MIME 共存、归档双区与计数、恢复会话先引导恢复项目、恢复项目不批量恢复会话。临时页面已移除，开发服务已停止。
- 上述浏览器冒烟不是原生 Electron 验收，也不是实际 IM/模型连通验证。本机 Electron 二进制缺失，尝试下载因网络连接失败；未删除或重装依赖。原生桌面深浅主题、重启持久化、真实外部 IM 及完整 M1–M13 验收仍有缺口。
- 真实文件持久化与正文保留通过临时目录自动化验证；未读写真实用户会话或凭据。未自动提交、推送或更新 README/tutorial/release notes。
