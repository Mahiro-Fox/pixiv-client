# 功能搁置清单

记录已评估、但当前版本暂不实现的功能，避免需求丢失，也方便后续排期。
已实现功能见 [REQUIREMENTS.md](./REQUIREMENTS.md)，本文件只收录未落地项。

## 开发交接（换设备 / 换会话先读这一节）

**代码位置**：`D:\soft\myFile\code\pixiv-client`，桌面端在 `desktop/`，当前分支 `refactor`。

**技术栈**：Electron 45 + electron-vite + React 19 + TypeScript + Tailwind + react-router-dom（Hash 路由）。主进程用 Electron `net` 直连 pixiv，渲染层只管 UI。

**命令**（cwd = `desktop`）：
```bash
npm install          # 首次
npm run dev          # 开发
npm run typecheck    # 提交前必跑
npm run build        # 提交前必跑
```

**目录约定**（改动前先看这几处）：
- `src/shared/types.ts`：跨层类型的唯一来源，新增接口先加类型。
- `src/main/pixiv/`：pixiv 接口层。`http.ts` 是所有请求的底座（代理、超时、429 冷却、重试），`search.ts` / `user.ts` / `novels.ts` / `api.ts` 是各业务，`oauth.ts` 是 App API 凭据。
- `src/main/ipc.ts`：所有 IPC handler 的注册处（含参数清洗与白名单）。
- `src/preload/index.ts`：`window.pixiv` 的类型化桥接，新增能力必须三处齐改（types → ipc → preload）。
- `src/renderer/src/pages/`：页面；`components/`：复用组件；`components/ui/`：基础控件。
- `src/renderer/src/i18n/messages.ts`：三语言文案，zhCN 是 MessageKey 的来源，en / ja 必须同步补齐，否则类型报错。

**关键机制**：
- 图片防盗链：主进程 `installImageReferer()` 给 `i.pximg.net` 补 Referer，渲染层直接用 `https://i.pximg.net/...` 即可。
- 请求节流：`main/pixiv/throttle.ts` 全局闸门（冷却、并发、最小间隔），所有 API 请求经 `acquireSlot('api')` 排队。
- 页面状态放 URL（`word / order / mode / page / tab`），便于返回与分享状态。

**协作约束**：中文回复；禁止面向对象写法，统一用函数式（纯函数 + hooks）；不主动创建文档文件。

**当前进度**：读取类功能（搜索、用户、关注、预览、下载工作台、设置、自动更新）已完成；App API OAuth 凭据层已完成（见下节）；收藏页 / 浏览记录页仍是占位；写操作接口与 UI 未接。

## 搁置项

| 功能 | 优先级 | 搁置原因 | 后续前置条件 |
| --- | --- | --- | --- |
| 关注画师批量同步（入口已屏蔽） | P2 | 勾选画师后没有挑选具体作品的操作空间，只能全量同步；多任务队列已覆盖大部分批量场景。界面入口已注释，代码保留在 `FollowDialog` 与 `App.batchSync` | 需要补「先抓取 → 挑选作品 → 再入队」的中间步骤；需求确认后取消注释即可恢复 |
| 批量同步的抓取阶段并行 | P2 | 批量同步的下载阶段已走全局并行调度；但多名画师同时翻页最容易触发 429，抓取仍保持逐个串行 | 需要任务级限流与 `BatchSyncProgress` 改为多画师结构（进度条重做）后再评估 |
| 定时任务 + 托盘常驻 | P2 | 关注画师批量同步已实现（入口暂时屏蔽）；自动执行需要托盘常驻与调度，当前手动触发已覆盖日常增量备份 | 托盘菜单、开机自启、错过执行是否补跑、失败通知策略一并设计 |
| SQLite 下载历史库（含 FTS5 检索） | P2 | 已提供 `history.json` 元数据索引，图库有 15s 缓存 + `fs.watch` 增量刷新 + 虚拟滚动，当前规模足够；收益主要在跨维度检索而非性能 | `better-sqlite3` 是原生模块，需确认 Electron ABI 预编译包，否则要 electron-rebuild 与 `asarUnpack`；图库要做复杂组合检索时再迁移 |
| 单张图片 HTTP Range 断点续传 | P2 | 当前按「文件粒度」重下，单文件失败重试成本可接受 | 需要记录已下载字节、校验服务端是否支持 Range |
| 磁盘空间预检 | P3 | 下载前预估体积不准（原图尺寸差异大），收益有限 | 需要稳定的体积估算来源 |
| 剪贴板监听作品链接 | P3 | 与批量备份主流程关联弱 | 需要链接解析与单作品下载入口 |
| 安装包代码签名 | P3 | 分发与自动更新已打通；未签名的安装包会触发 Windows SmartScreen 警告 | 需要代码签名证书与相应构建流程 |
| 排行榜等更多作品来源 | P3 | 作者标签与收藏夹已覆盖主要场景 | 新增来源适配层与对应筛选字段 |

## 与 Pixeval 的功能差距（2026-10-28 评估）

参考源码：`D:\soft\myFile\code\Pixeval-main`（C# / Avalonia）与 `D:\soft\myFile\code\Mako-master`（Pixeval 的 pixiv 客户端子模块，已单独拉取）。

只列我们未实现或明显不足的能力：

| 功能 | Pixeval 侧依据 | 我们的现状 | 复刻难度 | 建议优先级 |
| --- | --- | --- | --- | --- |
| 收藏浏览页 | `WorkBookmarks` 导航页；`WorkSubscriptionDownloadService.cs:601-625` | `/favorites` 为占位页，`CollectPanel` 只做批量下载配置 | 低 | P1 |
| 浏览历史 | 本地 SQLite，`HistoryPersistHelper.cs:116-139` | `/history` 为占位页 | 低 | P1 |
| 全局屏蔽（标签 / 用户） | `BrowsingExperienceSettingsGroup.cs:14-49`，浏览设置里全局生效 | `FilterDialog` 仅在下载器内生效，搜索结果页不过滤 | 低 | P1 |
| 图片查看器能力 | 缩放 / 旋转 / 镜像 / 原图 / Fit / 幻灯片自动播放 / 页 Slider / 悬浮工具栏，`IllustrationViewerPage.axaml:237-357` | `WorkDetailDialog` 单图 + 简单翻页 | 中 | P1 |
| 小说阅读设置 | 背景色 / 字色 / 字体 / 字重 / 字号 / 行高 / 最大宽度，`NovelViewerPageViewModel.cs:156-203` | 有阅读页，无可调阅读设置 | 低 | P2 |
| 系列聚合浏览 | `Series` 导航页 | 仅单部小说系列页 | 低 | P2 |
| 收藏 / 关注 / 取关等写操作 | `MakoHelper.cs:54-77`；端点见 `IAppApiEndPoint.cs:21-128` | 只读 GET；**OAuth 凭据层已完成**，写接口与 UI 未接 | 中（接口调用已无阻塞） | P2 |
| 推荐 / 排行榜 / 用户推荐 | `NavigationMenuYaml.cs:8-40`；`WorkRankingPage.axaml.cs:70-75` | 无 | 低 | P2（与上方「排行榜等更多作品来源」合并评估） |
| 下载任务状态机 | `Channel` 队列 + `DownloadTaskKey` 去重，状态含 Queued / Running / Paused / Error / Cancelled / Completed，`DownloadManager.cs:83-140`、`DownloadItemViewModel.cs:38-131` | `QueuePanel` / `ProgressPanel` 为批处理进度，无单任务暂停 / 重试 / 删除 | 高 | P2 |
| 稍后看 | `WatchLater` 导航页 | 无 | 中 | P3（接口需确认） |
| 订阅式增量下载 | 按收藏 / 关注 / 搜索条件定期拉新作，`WorkSubscriptionDownloadService.cs:601-625` | 无 | 高 | P3 |

不需要复刻：YAML 可配置导航、MCP Server、扩展（Extensions）系统、多端（Android / iOS / Browser）适配。

## 可直接复刻清单

**第一档：纯前端或接口已通，成本最低**
1. 浏览历史：主进程落一张表（作品 id、标题、作者、缩略图、时间），打开预览 / 查看器时写一条；页面按时间倒序并提供清空。可直接照搬 Pixeval 的字段设计。
2. 收藏浏览页：`fetchUserContent` 的 `bookmarks` 分支已支持 `rest=show/hide` 与分页，补页面与「公开 / 私密」切换，复用 `SearchWorkGrid`。
3. 全局屏蔽：把 `FilterDialog` 的排除标签 + 新增「屏蔽用户」提到主进程，搜索结果、用户作品、收藏统一走 `shouldHide(work, rules)`。
4. 小说阅读设置：字号 / 行高 / 字体 / 主题 / 宽度存 `localStorage`，套在现有 `NovelReaderPage` 上。
5. 排行榜 / 推荐 / 用户推荐：三个新页面，各一次 GET，复用现有卡片与 `Pagination`。

**第二档：需新增能力**
6. 图片查看器升级：把 `ImagePreview` 扩成支持缩放 / 旋转 / 镜像 / 原图 / Fit / 键盘（←→ 翻页、+/- 缩放、F 全屏、Esc 退出）/ 幻灯片播放的组件，Pixeval 的快捷键与工具栏可 1:1 映射。
7. 写操作（收藏 / 关注 / 取关）：OAuth 凭据层已落地（见下节），剩余工作是新增 App API 请求封装与卡片/用户页上的按钮。

**第三档：不建议现在做**
8. 下载引擎重构为队列式任务 + 订阅增量下载。收益大，但要重写 `QueuePanel` / `ProgressPanel` 与任务持久化，按独立迭代排期。

## 写操作接口细节（Mako 调研结论）

Mako 的写操作全部走 **App API**（`https://app-api.pixiv.net`）+ OAuth Bearer，表单编码；其 Web API 通道只注入 `Cookie`（`PixivWebApiHttpMessageHandler.cs:23-24`），并未实现网页端 POST。这和我们当前「`www.pixiv.net` + Cookie」的读取链路是两套体系，**这是写操作落地的真正前置条件**。

端点清单（`Mako/Net/EndPoints/IAppApiEndPoint.cs`）：

| 操作 | 方法 | 端点 | 表单字段 |
| --- | --- | --- | --- |
| 收藏插画 / 漫画 | POST | `/v2/illust/bookmark/add` | `illust_id`、`restrict`、`tags[]`（可选，空格拼接） |
| 取消收藏插画 / 漫画 | POST | `/v1/illust/bookmark/delete` | `illust_id` |
| 查询收藏状态 | GET | `/v2/illust/bookmark/detail` | `illust_id` |
| 收藏小说 | POST | `/v2/novel/bookmark/add` | `novel_id`、`restrict`、`tags[]` |
| 取消收藏小说 | POST | `/v1/novel/bookmark/delete` | `novel_id` |
| 关注用户 | POST | `/v1/user/follow/add` | `user_id`、`restrict` |
| 取消关注 | POST | `/v1/user/follow/delete` | `user_id` |
| 追更漫画系列 | POST | `/v1/watchlist/manga/add`、`/v1/watchlist/manga/delete` | `series_id` |
| 追更小说系列 | POST | `/v1/watchlist/novel/add`、`/v1/watchlist/novel/delete` | `series_id` |

请求与认证要点：

- Header：`Authorization: Bearer {access_token}`（`[OAuthToken]` 特性注入）+ `Content-Type: application/x-www-form-urlencoded`。
- access_token 由 `POST https://oauth.secure.pixiv.net/auth/token` 换取：`grant_type=refresh_token`、`refresh_token`、`client_id`、`client_secret`、`include_policy=true`；`client_id` / `client_secret` 为 pixiv 官方 Android 客户端常量，硬编码在 `Mako/Net/Requests/SessionRequest.cs:14-17`。返回 `access_token` / `expires_in` / `refresh_token`，过期后用 refresh_token 续期（`PixivTokenProvider.cs:29-61`）。
- 首次授权走 PKCE 授权码模式，`redirect_uri=https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback`（`SessionRequest.cs:44`）。
- `restrict` 取 `public` / `private`（`PrivacyPolicy.cs` 小写下划线枚举）；`private` 只允许操作自己的资源。
- App API 有统一节流：默认 800ms 冷却 + 429 上报（`PixivAppApiHttpMessageHandler.cs:23-32`、`MakoConfiguration.cs:32`），批量收藏必须串行限速，不能像只读接口那样并发。

落地路径（已按方案 1 实现，见下节）：

1. **补 OAuth 层（已落地，Mako 已验证）**：refresh_token 导入 + 过期前续期，写操作直连 App API。
2. **网页端 POST + csrf（未验证，不采用）**：Mako 没有实现，本地无依据，必须实机抓包确认 URL、请求头（csrf 字段名）与请求体后再考虑；风险是网页端接口随时可能变更。

UI 初始化状态：收藏状态用 `GET /v2/illust/bookmark/detail`，关注状态可直接取用户详情接口的 `is_followed` 字段。

### OAuth 层已实现（2026-10-28）

**原则**：源码不含任何密钥。client_id / client_secret / refresh_token 全部由用户在设置里填写，存在本地 `userData/oauth.json`。

- `src/main/pixiv/oauth.ts`
  - `getOAuthStatus()`：返回 `{ connected, hasClient, tail, expiresAt, userId }`。
  - `saveOAuthCredentials({ clientId, clientSecret, refreshToken })`：先刷新一次校验，成功才落盘；失败抛错（`invalid_grant` / `invalid_client` 已翻成中文提示）。
  - `getAccessToken()`：写操作用，过期前 60 秒自动续期；并发去重（多个写操作同时触发只发一次刷新）。
  - `clearOAuth()`：清空凭据，不影响 Cookie。
  - pixiv 每次刷新都会下发新的 refresh_token，代码会跟着更新落盘。
- `src/main/pixiv/http.ts`
  - 新增 `RequestOptions`（method / form / headers / readErrorBody / notifyAuthFailure），`buildRequest` 与 `open` 支持表单 POST。
  - 新增 `postFormJson<T>()`，复用同一套代理、超时、429 冷却与重试通道。
  - `fetchJson` 行为不变（内部重构为共用 `requestJson`）。
  - App API 的 401 不触发「Cookie 失效」提示（`notifyAuthFailure: false`）。
- IPC / preload：`oauth:status`、`oauth:save`、`oauth:clear` → `getOAuthStatus` / `saveOAuthCredentials` / `clearOAuth`。
- 设置面板新增「App API 凭据（写操作）」区块：三项输入 + 保存并验证 + 清除（二次确认）；已连接时显示用户 id 与 refresh_token 尾号。
- 三语言文案 key：`settings.oauth.*`（12 个）。

**下一步（写操作接线）**：
1. 在 `src/main/pixiv/` 新增 `appApi.ts`：`appApiGet` / `appApiPostForm`，内部 `Authorization: Bearer ${await getAccessToken()}`，串行限速（App API 要求 ≥800ms，不能并发）。
2. 按上表接入收藏 / 关注端点，IPC 通道建议 `work:bookmark`、`user:follow`。
3. UI：作品卡与预览弹窗加收藏按钮（`GET /v2/illust/bookmark/detail` 初始化状态）、用户主页与作者悬停浮层加关注按钮（用 `is_followed` 初始化）。
4. 未配置 OAuth 时按钮置灰并提示去设置页，不要弹错误。

**验证方式**：填入有效凭据后点「保存并验证」，状态变为「已连接」即说明 token 换取成功；`oauth.json` 只出现在 `%APPDATA%/pixiv-client/`。

## 代码改进建议

1. 统一分页数据源：`WorksSearchPage` / `UsersPage` / `UserDetailPage` / `UsersFollowingPage` 各自一套 `useState + useEffect + URL 参数`，抽 `usePagedQuery`（函数式 hook），页面只声明取数方式与参数映射。
2. 主进程请求层：底层已收敛到 `http.ts` 的 `requestJson`（GET 走 `fetchJson`，表单 POST 走 `postFormJson`）；剩余问题是各业务模块仍各自拼错误文案，可再抽 `pixivRequest` 统一错误语义。
3. 预览升级为路由：新增 `/viewer/:id?page=` 承载大图缩放与幻灯片，`WorkDetailDialog` 保留为轻量快速预览。
4. 列表性能：搜索页一页 60+ 卡片全量渲染大图，加 `loading="lazy"` + IntersectionObserver 分批挂载，并统一使用 `c/250x250` 缩略图。
5. 过滤下沉到数据层：屏蔽标签 / 用户应作用于搜索结果与用户作品，而不是只管下载队列，保证「看到什么就能下载什么」。
6. 本地存储统一：搜索历史走 `localStorage`、下载历史走 `history.json`，若浏览历史再起一套会更碎；建议统一到主进程存储模块，渲染层通过 IPC 读写。
7. 状态全放 URL：新页面（收藏 / 历史 / 推荐）沿用 `word / order / mode / page / tab` 约定，保证返回键与「从详情退回」行为一致。
8. 右键菜单：作品卡 / 用户卡加 portal 菜单，收纳「打开 pixiv / 复制链接 / 加入下载 / 屏蔽该作者」，减少卡片上的常驻图标。

## 建议推进顺序

浏览历史 → 收藏浏览页 → 全局屏蔽 → 小说阅读设置 → 排行榜 / 推荐页 → 图片查看器升级 → 写操作，下载引擎重构单独排期。
