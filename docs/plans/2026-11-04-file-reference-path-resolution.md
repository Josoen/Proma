# 会话文件引用跨平台路径解析问题与修复方案

> 状态：待实施；本文记录已完成的排查及建议修复，不代表功能已修复。
>
> 日期：2026-11-04
>
> 排查基线：`main` / `89879a89d0b98fb01f18c1c201f7753195aa93fe`，桌面应用 `0.19.76`，Pi runtime `0.87.1`。
>
> 本次文档交付按工程约定将桌面应用 patch 版本递增至 `0.19.77`，该版本递增不表示修复已经实施。

## 1. 问题与目标

用户发现会话底部的改动文件标签、模型回复正文和思考中的文件引用，有时能够打开，有时显示灰色或没有可用链接。Windows 客户端中，Git Bash 格式的 `/d/Code/...` 路径容易失败，而 Windows 盘符绝对路径通常能够打开。

本方案覆盖 Windows、macOS、Linux 客户端，目标是让同一个本地文件的有效路径写法在底部标签、正文和思考中采用一致的解析结果，并修复过期失败状态。路径转换必须遵循客户端系统语义，保留当前会话的文件访问授权边界。

### 1.1 前提和范围

- 以运行 Electron 主进程的客户端操作系统为准；shell 的名称不能替代宿主平台判断。
- 引用目标是客户端可访问的本地文件，或已经通过现有候选目录、附件机制授权的文件。
- 正文和思考继续处理现有 Markdown 链接、行内代码等文件引用形式，不新增任意自然语言路径扫描。
- 历史消息保留原始内容，在读取和打开时解析，不迁移或重写历史会话。
- 不新增依赖、路径配置页面、文件搜索服务或数据库；不修改 Pi 工具执行行为。
- 不增加远程主机路径映射或 WSL Linux 内部文件系统访问能力。Windows 下仅对齐 Pi 当前已支持的明确盘符别名。

## 2. 底部文件标签的真实来源

底部区域由 Proma 自动生成，但路径取自模型调用工具时提交的参数，不是模型在正文中输出的列表，也不是 `git diff` 扫描结果。

`TurnFileChangesSummary.tsx` 的 `collectFilePaths()` 执行以下步骤：

1. 收集本轮已返回且 `is_error !== true` 的工具结果。
2. 匹配成功的 `Edit / Write / MultiEdit / NotebookEdit` 调用。
3. 提取 `file_path / filePath / path / notebook_path`，按原始字符串去重。
4. 使用 `FilePathChip` 渲染文件标签。

因此，工具执行时支持某种路径，并不保证展示层也正确解析了同一写法。当前仅通过 Bash 命令修改文件，不会因此被此列表自动收集。

正文和思考中的引用文字来自模型，再由 Proma 的 Markdown 渲染器识别。`buildTurnFileNameMap()` 还会收集成功读取过的文件，为本轮正文中的文件名提供补全证据；底部改动列表不包含仅仅读取过的文件。

## 3. 已确认的问题和证据

### 3.1 主要原因：工具端与预览端路径规则不一致

当前 Pi `0.87.1` 的路径工具在 Windows 下会识别以下盘符别名：

```text
/d/Code/project/a.ts          → D:\Code\project\a.ts
/mnt/d/Code/project/a.ts      → D:\Code\project\a.ts
/cygdrive/d/Code/project/a.ts → D:\Code\project\a.ts
```

Pi 消息兼容层的 `normalizeToolUseInput()` 只补齐展示协议的参数字段，没有将这些原始路径替换为 Pi 执行时的实际路径。底部标签因而可能收到未经转换的 `/d/...`。

Proma 的 `file-preview-service.ts` 则把以 `/` 开头的输入判定为绝对路径，再直接调用 Node 的 `resolve()`。Windows 下 `/d/...` 会被解析为当前盘根目录下的 `\d\...`，而不是 `D:\...`。

已在 Windows 上直接调用当前仓库的 `resolveTargetPath()`、`resolveFilePath()`，并与安装的 Pi `resolvePath()` 对照，目标为真实存在的 `D:\Code\Proma\package.json`：

| 输入 | Pi 实际解析 | Proma 预览解析 | 预览存在性结果 |
|---|---|---|---|
| `/d/Code/Proma/package.json` | `D:\Code\Proma\package.json` | `D:\d\Code\Proma\package.json` | `null` |
| `D:/Code/Proma/package.json` | `D:\Code\Proma\package.json` | `D:\Code\Proma\package.json` | 找到文件 |
| `D:\Code\Proma\package.json` | `D:\Code\Proma\package.json` | `D:\Code\Proma\package.json` | 找到文件 |
| `/mnt/d/Code/Proma/package.json` | `D:\Code\Proma\package.json` | `D:\mnt\d\Code\Proma\package.json` | `null` |
| `package.json`，候选根为 `D:/Code/Proma` | `D:\Code\Proma\package.json` | `D:\Code\Proma\package.json` | 找到文件 |

表中错误路径的盘符取决于进程当前盘；本次复现为 `D:`。这些输入均被前端识别为文件引用，问题发生在后续解析阶段。

这可以解释“工具成功修改、底部文件却打不开”：执行端完成了盘符转换，展示端没有。模型在 Windows 原生路径与 shell 路径之间切换，会使问题表现为间歇性出现。

### 3.2 共同原因：失败结果长期缓存且悬浮不刷新

`file-path-chip.tsx` 使用模块级 `fileExistsCache` 保存成功和失败结果，没有过期或文件变化失效处理。缓存 key 包含会话 ID、原始路径和候选目录，但不包含授权目录的修订信息。

代码注释表示悬浮时绕过缓存，实际 `handleTooltipOpenChange()` 仍调用先读缓存的 `resolveCurrentPath()`，没有强制刷新。因此，文件初次检查时不存在，后来被创建，或授权上下文发生变化但 key 不变时，都可能继续显示旧结果。

这是代码确认的附加问题，尚未通过该截图对应的历史会话现场回放证明它也是本次截图的触发因素。

### 3.3 展示与打开的实际路径未收敛

`FilePathChip` 保存了主进程返回的 `resolvedPath`，但点击预览和“在文件管理器中显示”仍传入原始 `cleanPath`，后续再次解析。这增加了展示成功但其他打开入口使用不同路径的可能性。

底部标签变灰时并没有禁用按钮：`onClick` 仍会执行，只是后续预览同样可能失败。正文自由文本引用解析失败时，`ResolvableFilePathChip` 则会保留普通文本或行内代码外观。

### 3.4 失败提示混淆不存在与未授权

`resolveAuthorizedPreviewPath()` 在文件不存在或最终路径未通过会话授权检查时都会返回 `null`。前端统一显示“文件不存在”，不能准确描述授权不足的情形。

### 3.5 代码入口

以下路径均相对仓库根目录，函数名用于定位，实施前应以目标分支代码为准。

| 文件 | 入口和作用 |
|---|---|
| `apps/electron/src/renderer/components/agent/TurnFileChangesSummary.tsx` | `collectFilePaths()`、`buildTurnFileNameMap()`：提取工具路径及本轮文件名映射 |
| `apps/electron/src/main/lib/adapters/pi-message-adapter.ts` | `normalizeToolUseInput()`：保留路径参数的消息转换 |
| `apps/electron/src/renderer/components/ai-elements/message.tsx` | `MarkdownLink`、`MarkdownInlineCode`：正文与思考共用的引用渲染 |
| `apps/electron/src/renderer/components/agent/ContentBlock.tsx` | `ThinkingBlock`：思考内容使用 `MessageResponse` 渲染 |
| `apps/electron/src/renderer/components/ai-elements/file-path-chip.tsx` | 解析缓存、文件标签状态、预览与文件管理器打开入口 |
| `apps/electron/src/renderer/components/ai-elements/file-path-chip-utils.ts` | 文件引用识别、文件名显示与行列号拆分 |
| `apps/electron/src/main/lib/file-preview-service.ts` | `isAbsolutePreviewPath()`、`resolveTargetPath()`、`resolveFilePath()`：公共预览解析 |
| `apps/electron/src/main/ipc.ts` | `resolveAuthorizedPreviewPath()`、`file:resolve-path`、`SHOW_ITEM_IN_FOLDER`：授权和系统打开 |
| `apps/electron/src/preload/index.ts` | `resolveFilePath()`：前端至主进程的现有 bridge |

## 4. 跨平台路径契约

### 4.1 平台与路径规则

| 客户端平台 | 输入 | 期望处理 |
|---|---|---|
| Windows | `D:\Code\a.ts`、`D:/Code/a.ts` | Windows 绝对路径 |
| Windows | `/d/Code/a.ts` | 转换为 `D:\Code\a.ts`，盘符大小写均可识别 |
| Windows | `/mnt/d/Code/a.ts`、`/cygdrive/d/Code/a.ts` | 对齐当前 Pi 的明确盘符别名规则 |
| Windows | `\\server\share\a.ts` | 保留 UNC 语义，按现有授权检查 |
| macOS | `/Users/alice/project/a.ts`、`/Volumes/work/a.ts` | POSIX 本地绝对路径 |
| Linux | `/home/alice/project/a.ts` | POSIX 本地绝对路径 |
| macOS / Linux | `/d/Code/a.ts`、`/mnt/d/Code/a.ts`、`/cygdrive/d/Code/a.ts` | 原样作为本机 POSIX 绝对路径，不转换盘符 |
| 所有平台 | `~/project/a.ts` | 按当前平台既有规则展开客户端用户主目录 |
| 所有平台 | `src/a.ts`、`./src/a.ts` | 使用现有会话实际 cwd 和合法候选根解析 |

shell 使用 bash 并不代表路径属于 Windows。macOS/Linux 上不把 Windows 盘符写法转换为某个猜测的本机目录，也不因其外形像 Windows 路径就视为本机有效绝对路径。

### 4.2 顺序和边界

1. 前端按现有引用语法识别文本，拆分支持的 `:行号[:列号]` 后缀。
2. 主进程按宿主平台规范化文件路径；Windows 才转换明确盘符别名。
3. 使用本平台路径 API 解析绝对路径或现有候选根下的相对路径。
4. 保留存在性和最终 realpath 授权检查，确认文件属于当前会话的显式目录或单文件附件。
5. 返回实际路径，供标签提示和打开使用；原始消息不变。

不统一替换所有反斜杠，不无条件折叠连续斜杠，避免损坏 POSIX 文件名或 UNC。URI 解码仍留在已有 Markdown URL 处理层，不新增对普通工具路径的重复解码。

不使用递归扫描、同名文件搜索或其他盘符探测来补救失败。相对路径继续遵守既有候选根约束，不能通过路径转换扩大授权范围。

Windows 下 `/home/...`、Git Bash 安装目录中的 `/usr/...` 等没有明确盘符映射的路径，不在本次新增映射范围内；不得把它们推断成某个用户目录。WSL 的自定义挂载配置同样不在本次新增支持范围内。

## 5. 最小修复方案

### 5.1 主进程统一路径规范化

在现有 `agent-file-path.ts` 增加一个小型纯函数，专门处理 Windows shell 盘符别名；平台参数默认取 `process.platform`，测试可显式传入平台。

- 规则对齐当前 Pi 的明确盘符转换，不从 `node_modules` 的私有深层路径导入实现。
- `file-preview-service.ts` 的公共路径判断与解析入口使用规范化结果，避免判断和解析采用不同语义。
- `SHOW_ITEM_IN_FOLDER` 等已有公共解析调用方自然复用该转换。
- 主进程继续承担最终存在性和授权判断，前端不复制一套盘符转换逻辑。
- 保留已有相对路径候选顺序和确定性规则；不顺带重构其他路径服务。

### 5.2 缓存与重查

保留同 key 的进行中请求合并；不长期缓存失败结果。为现有解析请求增加显式刷新能力，悬浮及点击时能够绕过已有结果重新检查，并用最新结果更新组件状态。

仅删除失败缓存还不够：正文中已降级为普通文本的引用没有可悬浮的文件标签，文件创建后必须有再次解析的触发点。实施时复用现有会话文件变化通知，对当前候选引用触发重查；不新增文件监听器或轮询任务。会话授权上下文变化时同样重新检查当前引用，不能仅依赖旧缓存。

继续保留组件卸载和请求代次保护，防止旧请求覆盖新路径或新会话的状态。各处解析都必须携带消息所属会话，不能因为切换活动会话而借用其他会话的授权。

### 5.3 使用实际路径打开

标签点击和“在文件管理器中显示”先取得当前解析结果，再把主进程返回的实际路径交给对应入口。行列号仍作为引用展示信息单独保留，不拼进实际文件系统路径。

这样底部标签、正文与思考共用同一条解析链路，不为三个展示位置分别增加平台补丁。预览后续读取仍执行现有会话授权校验。

### 5.4 提示与 IPC

不为此次修复新增失败原因枚举或扩大 IPC 返回类型。解析失败提示调整为：

> 无法访问文件：可能不存在或不在当前会话授权范围内。

解析成功时提示实际路径。正文解析失败继续保留原 Markdown 外观，不把无效引用强制渲染为可用链接。

现有 IPC 请求/响应结构可以维持不变；实施仍须核对 shared 类型、主进程 handler、preload bridge、renderer 的会话与候选目录传递。

## 6. 实施顺序与验收

### 6.1 步骤

1. 补充跨平台路径规范化及现有解析回归测试，复现 Windows shell 路径失败；验证：正常路径与主要边界有 BDD 用例。
2. 实施主进程公共解析修复；验证：Windows 别名解析一致，macOS/Linux 保留 POSIX 语义，授权校验仍生效。
3. 修复缓存、重查和实际路径打开，调整失败提示；验证：覆盖底部、正文、思考以及文件创建后的状态恢复。
4. 运行最小相关 `bun test <测试文件>`，再运行 `bun run typecheck`；分别完成目标系统的实际打开冒烟验证，按结果记录验证边界。

本次方案没有运行时依赖、external 或打包规则变更，不新增打包工作；若实施时实际涉及这些内容，则遵守仓库构建和目标平台打包要求。后续实施提交按当时分支版本继续递增 patch，不复用文档交付版本作为“已修复”标记。

### 6.2 BDD 验收矩阵

| 场景 | Given / When | Then |
|---|---|---|
| Windows 原生路径 | 文件存在且已授权，引用反斜杠或正斜杠盘符路径 | 得到同一实际文件并可打开 |
| Windows Git Bash 路径 | 同一文件使用 `/d/...` 引用 | 与 `D:\...` 解析一致 |
| Windows 其他 Pi 盘符别名 | 使用 `/mnt/d/...` 或 `/cygdrive/d/...` | 与当前 Pi 的明确盘符映射一致 |
| macOS / Linux 本地路径 | 引用已存在且已授权的 POSIX 绝对路径 | 保持原路径语义并可打开 |
| macOS / Linux 类盘符目录 | 输入 `/d/...`、`/mnt/d/...` 等 | 不转换为 Windows 盘符；只检查本机目标 |
| UNC 与路径分隔符 | Windows 引用合法 UNC；POSIX 测试合法文件名中的反斜杠 | 不被通用字符串替换损坏 |
| 相对路径与主目录 | 引用现有 cwd 下的相对文件或本机 `~/...` 文件 | 按现有根目录和授权规则解析 |
| 引用外观 | 中文、空格、括号、受支持的行列号后缀 | 文件名和实际路径不被破坏，行列号不参与存在性检查 |
| 三个展示位置 | 底部工具路径、正文链接/行内代码、思考引用指向同一文件 | 实际解析目标一致 |
| 初次不存在后创建 | 引用先解析失败，随后工具创建文件并产生现有文件变化通知 | 可重新解析，正文候选也能恢复为文件标签 |
| 旧成功结果后删除 | 文件已解析成功后被删除，再次悬浮或点击 | 不继续把旧缓存作为当前存在性结论 |
| 不存在或未授权 | 目标不存在，或真实路径不在当前会话授权范围内 | 不开放预览，失败提示准确表达不确定原因 |
| 会话与异步边界 | 切换会话、嵌入子会话或旧请求延后返回 | 不借用其他会话授权，不被旧结果覆盖 |
| 历史会话 | 旧消息保留 `/d/...` 等原始引用 | 读取时应用修复规则，无需重写消息 |

平台参数测试验证条件分支，不能代替各系统的原生文件系统行为。Windows、macOS、Linux 的打开预览与文件管理器操作应分别记录实机结果；无法验证的平台必须标为待验证。

## 7. 当前验证状态与交付边界

- 已完成：当前基线代码调用链排查；Windows 上对实际文件直接调用 Pi 与 Proma 解析函数的对照复现。
- 已确认但未对截图会话现场回放：缓存失效缺失、悬浮未绕过缓存、失败提示混淆、打开入口继续使用原始路径。
- 待实施：本方案中的路径规范化、缓存刷新、实际路径打开、提示调整及相关测试。
- 待验证：截图对应的具体历史会话；macOS/Linux 实机行为；修复后的三平台 UI 冒烟。
- 本次交付仅新增方案文档并按工程约定递增应用版本，不包含修复代码，不修改 README、tutorial 或 release notes。
