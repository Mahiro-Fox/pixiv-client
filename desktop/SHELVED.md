# 功能搁置清单

记录已评估、但当前版本暂不实现的功能，避免需求丢失，也方便后续排期。
已实现功能见 [REQUIREMENTS.md](./REQUIREMENTS.md)，本文件只收录未落地项。

## 开发交接（换设备 / 换会话先读这一节）

**代码位置**：`D:\work\pixiv-client`，桌面端在 `desktop/`，当前分支 `refactor`。

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
- `src/main/pixiv/`：pixiv 接口层。`http.ts` 是所有请求的底座（代理、超时、429 冷却、重试），`search.ts` / `user.ts` / `novels.ts` / `api.ts` 是各业务，`ranking.ts` 是网页排行榜，`oauth.ts` 是 App API 凭据，`appApi.ts` 是 App API 的 GET / POST 通道，`recommend.ts` / `write.ts` 是推荐与写操作。
- `src/main/ipc.ts`：所有 IPC handler 的注册处（含参数清洗与白名单）。
- `src/preload/index.ts`：`window.pixiv` 的类型化桥接，新增能力必须三处齐改（types → ipc → preload）。
- `src/renderer/src/pages/`：页面；`components/`：复用组件；`components/ui/`：基础控件。
- `src/renderer/src/i18n/messages.ts`：三语言文案，zhCN 是 MessageKey 的来源，en / ja 必须同步补齐，否则类型报错。

**关键机制**：
- 图片防盗链：主进程 `installImageReferer()` 给 `i.pximg.net` 补 Referer，渲染层直接用 `https://i.pximg.net/...` 即可。
- 请求节流：`main/pixiv/throttle.ts` 全局闸门（冷却、并发、最小间隔），所有 API 请求经 `acquireSlot('api')` 排队。
- 页面状态放 URL（`word / order / mode / page / tab`），便于返回与分享状态。

**协作约束**：中文回复；禁止面向对象写法，统一用函数式（纯函数 + hooks）；不主动创建文档文件。

**当前进度**：读取类功能（搜索、用户、关注、预览、下载工作台、设置、自动更新）已完成；App API OAuth 凭据层与 App API 通道（GET / 表单 POST）已完成；收藏浏览页、浏览记录页、全局屏蔽、小说阅读设置、排行榜页、推荐页、写操作（收藏 / 关注 / 取关）、稍后看、系列聚合浏览已完成（2026-10-29）；图片查看器升级经确认**暂不做**。

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

## 与 Pixeval 的功能差距（2026-10-28 评估）

参考源码：`D:\work\Pixeval-main`（C# / Avalonia）与 `D:\work\Mako-master`（Pixeval 的 pixiv 客户端子模块，已单独拉取）。

只列我们未实现或明显不足的能力：

| 功能 | Pixeval 侧依据 | 我们的现状 | 复刻难度 | 建议优先级 |
| --- | --- | --- | --- | --- |
| 收藏浏览页 | `WorkBookmarks` 导航页；`WorkSubscriptionDownloadService.cs:601-625` | **已实现**：`/favorites`，公开 / 私密切换 + 标签筛选 + 分页 | — | ✅ |
| 浏览历史 | 本地 SQLite，`HistoryPersistHelper.cs:116-139` | **已实现**：`/history`，`viewHistory.json` + 搜索 + 清空 | — | ✅ |
| 全局屏蔽（标签 / 用户） | `BrowsingExperienceSettingsGroup.cs:14-49`，浏览设置里全局生效 | **已实现**：`shared/block.ts`，主进程过滤搜索 / 用户作品 / 收藏 / 批量同步 | — | ✅ |
| 图片查看器能力 | 缩放 / 旋转 / 镜像 / 原图 / Fit / 幻灯片自动播放 / 页 Slider / 悬浮工具栏，`IllustrationViewerPage.axaml:237-357` | `WorkDetailDialog` 单图 + 简单翻页；**2026-10-28 确认现有预览够用，暂不升级** | 中 | 暂缓 |
| 系列聚合浏览 | `Series` 导航页 | **已实现**：`/series/:seriesId`，App API 取完整目录 + 追更；未连接凭据时用作品页 `seriesNavData` 兜底 | — | ✅ |
| 收藏 / 关注 / 取关等写操作 | `MakoHelper.cs:54-77`；端点见 `IAppApiEndPoint.cs:21-128` | **已实现**：`appApi.ts` 表单 POST + `write.ts`；详情弹窗收藏（公开 / 私密）、用户主页关注 / 取关 | — | ✅ |
| 推荐 / 排行榜 / 用户推荐 | `NavigationMenuYaml.cs:8-40`；`WorkRankingPage.axaml.cs:70-75` | **已实现**：`/ranking`（网页排行榜）与 `/recommend`（App API 推荐作品 / 画师，未连接时网页发现兜底） | — | ✅ |
| 下载任务状态机 | `Channel` 队列 + `DownloadTaskKey` 去重，状态含 Queued / Running / Paused / Error / Cancelled / Completed，`DownloadManager.cs:83-140`、`DownloadItemViewModel.cs:38-131` | 已有排队 / 解析 / 下载 / 暂停 / 完成状态与单任务暂停恢复、同作者去重；缺 Error / Cancelled 独立状态与任务级错误重试策略 | 中 | P2 |
| 稍后看 | `WatchLater` 导航页 | **已实现**：`/watch-later`，本地 `watchLater.json` + 详情弹窗「稍后看」按钮 + 搜索 / 移出 / 清空 | — | ✅ |
| 订阅式增量下载 | 按收藏 / 关注 / 搜索条件定期拉新作，`WorkSubscriptionDownloadService.cs:601-625` | 无 | 高 | P3 |

不需要复刻：YAML 可配置导航、MCP Server、扩展（Extensions）系统、多端（Android / iOS / Browser）适配。

## 可直接复刻清单

**第一档：纯前端或接口已通，成本最低**

1. ✅ 浏览历史（2026-10-28 完成）：`src/main/viewHistory.ts` 落 `viewHistory.json`，打开作品详情写一条，`/history` 按时间倒序 + 关键词过滤 + 清空。
2. ✅ 收藏浏览页（2026-10-28 完成）：`/favorites` 复用 `fetchUserContent` 的 `bookmarks` 分支，支持公开 / 私密切换、标签筛选与分页。
3. ✅ 全局屏蔽（2026-10-28 完成）：`src/shared/block.ts`，主进程统一过滤搜索 / 用户作品 / 收藏 / 批量同步，渲染层再兜一层。
4. ✅ 小说阅读设置（2026-10-28 完成）：`NovelReaderSettings` 浮层，字号 / 行高 / 宽度 / 主题存 `localStorage`，在线阅读与本地 TXT 阅读共用。
5. ✅ 排行榜 / 推荐 / 用户推荐（2026-10-28 完成）：`/ranking` 走网页 `ranking.php?format=json`（7 种榜单 × 插画/漫画 + 历史日期 + 10 页）；`/recommend` 的推荐作品与画师走 App API，未连接 OAuth 时作品退回 `/ajax/illust/discovery` 兜底。

**第二档：需新增能力**
6. 图片查看器升级（**暂缓**）：2026-10-28 确认现有 `WorkDetailDialog` 预览已满足使用，不做缩放 / 旋转 / 幻灯片改造；若后续要做，把 `ImagePreview` 扩成支持缩放 / 旋转 / 镜像 / 原图 / Fit / 键盘 / 幻灯片播放的组件即可。
7. ✅ 写操作（2026-10-28 完成）：`appApi.ts` 增加 `appApiPost` 表单通道，`write.ts` 封装收藏状态 / 收藏 / 关注状态 / 关注四个操作；详情弹窗加收藏按钮与公开 / 私密切换，用户主页加关注按钮（自己的主页不显示），未连接 OAuth 时不渲染按钮。

**第三档：不建议现在做**
8. 下载引擎重构为队列式任务 + 订阅增量下载。收益大，但要重写 `QueuePanel` / `ProgressPanel` 与任务持久化，按独立迭代排期。

**已完成补充（2026-10-29）**
9. ✅ 稍后看：`src/main/watchLater.ts` 落 `watchLater.json`（防抖 + 原子写入 + 退出 flush），`/watch-later` 页支持关键词过滤、分页、移出、清空；详情弹窗加「稍后看」按钮，不依赖 OAuth。
10. ✅ 系列聚合浏览：`src/main/pixiv/series.ts` 走 App API `/v1/illust/series`（`next_url` 翻页）+ 网页 `seriesNavData` 兜底；`/series/:seriesId` 页展示封面 / 元信息 / 话列表，详情弹窗加系列入口；追更走 `/v1/watchlist/manga/add|delete`。IPC：`series:detail`、`series:watch`。**App API 分支未实机验证**（本轮 Shell 最初不可用），仅类型检查与构建通过。
11. ✅ 推荐页「加载更多」改为触底自动续拉：`IntersectionObserver` 哨兵放在滚动容器末尾（`SearchWorkGrid` 新增 `footer` 插槽，画师列表哨兵放进自身滚动区），`rootMargin` 300px 提前量；保留 ID 去重与刷新重置。
12. ✅ 列表页离开再回来保留数据（keep-alive + 已加载标记 + 滚动位置 hook）：
   - **库**：`keepalive-for-react(-router)` v6。`App.tsx` 用不带 path 的布局路由 `KeepAliveOutlet` 包住全部路由，`include` 为 `/recommend`、`/illust`、`/manga`、`/novel`、`/ranking`、`/users`，`max=12`，**`activeCacheKey={location.pathname}`**（改筛选 / 翻页 / 回车只改 search，复用同一实例）。`main.tsx` 已移除 `StrictMode`（该库硬性要求）。
   - **推荐页切标签 / 切插画漫画不重取**：作品按 `kind` 分桶 `WorksBucket { works, next, token }`（`token = kind:连接状态`），命中即跳过；画师用 `usersLoaded` 布尔标记。只有点「刷新」才删掉当前桶重取；kind / 凭据变化会让标记不匹配并自动重取。
   - **后台页面不读全局 URL（关键根因）**：keep-alive 页面在后台没卸载，`useSearchParams()` 读到的是全局位置；进详情页时 URL 无 `word` / `page`，后台页把它们算成空值触发 effect，返回时参数复原又跑一遍，表现为「点作者→返回后搜索页重新请求」。`lib/pageActive.ts` 的 `usePageActive()` 在 effect 首行判断，后台不请求也不清空；六个缓存页均已接入。
   - **请求签名**：各页用 `loadedSig` ref 保存「取数据的条件」（kind / word / 筛选 / 页码 / 提交序号），一致即跳过，失败清空以便重试，作为第二道防线。
   - **搜索框同步只在栏目页**：`App.tsx` 只在 `/illust`、`/manga`、`/novel`、`/users` 用 URL 的 `word` 回填输入框，进 `/user/:id` 等详情页不同步，避免输入框被清空再跳回。
   - **滚动位置**：库不做滚动恢复。`lib/scrollMemory.ts` 提供 `useKeepAliveScroll(key)`（回调 ref + 挂载还原 + `useLayoutEffectOnActive` 激活还原 + rAF 兜底）与 `useScrollMemory(key)`。**ref 必须挂到真正滚动的容器上**：推荐页与排行榜挂外层 `main`（推荐页列表包一层 `shrink-0` 防止内部 grid 在 flex 收缩下变成独立滚动区）；插画 / 漫画 / 小说 / 用户四页挂内层 `overflow-y-auto` 列表容器。推荐页用动态键 `recommend:works:{kind}` / `recommend:users`，切键时直接还原新键位置；位置只在滚动事件里实时记录，切键时**不要**补读 `scrollTop`（此时 DOM 已换成新列表，旧列表更长会被 clamp，补读会把真实位置覆盖成 0）。`reset()` 用于数据整批重置时归零。
   - **刷新时机**：`lib/searchSubmit.ts` 全局提交序号，`submitSearch` 每次回车都递增并进入搜索页 effect 依赖，同一关键词再回车也重取。
   - 旧的 `lib/pageCache.ts`（内存快照）已删除，避免与 keep-alive 两套机制并存。
   - 顺带给排行榜页与推荐页的 `main` 补了 `overflow-y-auto`（此前内容会被根布局裁掉）。所有缓存与滚动位置只在内存，重启失效。

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
  - `completePixivAuthorization({ clientId, clientSecret, code, codeVerifier })`：PKCE 授权码换令牌并落盘。
  - `clearOAuth()`：清空凭据，不影响 Cookie。
  - pixiv 每次刷新都会下发新的 refresh_token，代码会跟着更新落盘。
- `src/main/pixiv/oauthLogin.ts`（PKCE 授权登录，见 REQUIREMENTS 3.31）
  - 生成 32 字节 `code_verifier`（base64url），`code_challenge = base64url(SHA256(verifier))`。
  - 打开 `https://app-api.pixiv.net/web/v1/login?code_challenge=…&code_challenge_method=S256&client=pixiv-android`，复用 `LOGIN_PARTITION`（Cookie 登录窗口分区，已登录则直接跳转）。
  - `will-navigate` / `will-redirect` / `did-navigate` 三处拦截 `…/auth/pixiv/callback?code=`，取到 code 后关窗并换令牌；关窗或拒绝授权返回 null。
  - IPC `oauth:login` → preload `loginOAuth`。
- `src/main/pixiv/http.ts`
  - 新增 `RequestOptions`（method / form / headers / readErrorBody / notifyAuthFailure），`buildRequest` 与 `open` 支持表单 POST。
  - 新增 `postFormJson<T>()`，复用同一套代理、超时、429 冷却与重试通道。
  - `fetchJson` 行为不变（内部重构为共用 `requestJson`）。
  - App API 的 401 不触发「Cookie 失效」提示（`notifyAuthFailure: false`）。
- IPC / preload：`oauth:status`、`oauth:save`、`oauth:clear` → `getOAuthStatus` / `saveOAuthCredentials` / `clearOAuth`。
- 设置面板新增「App API 凭据（写操作）」区块：三项输入 + 保存并验证 + 清除（二次确认）；已连接时显示用户 id 与 refresh_token 尾号。
- 三语言文案 key：`settings.oauth.*`（12 个）。

**写操作已接线（2026-10-28）**：
1. `src/main/pixiv/appApi.ts`：`appApiGet` / `appApiPost`，内部 `Authorization: Bearer ${await getAccessToken()}`，复用 `http.ts` 的全局 API 闸门做限速。
2. `src/main/pixiv/write.ts`：`getBookmarkState` / `setBookmark` / `getFollowState` / `setFollow`；401 / 403 翻成中文提示，凭据缺失时直接报「写操作需要先连接 App API 凭据」。
3. IPC / preload：`write:bookmarkState`、`write:setBookmark`、`write:followState`、`write:setFollow`。
4. UI：`WorkDetailDialog` 底部收藏按钮 + 公开 / 私密切换（打开时读取状态）；`UserDetailPage` 关注 / 取关按钮（自己的主页不显示）；未连接 OAuth 时按钮不渲染。
5. 尚未覆盖：小说收藏与系列追更（端点已列在上表，需要小说阅读页 / 系列页的入口）。

**验证方式**：填入有效凭据后点「保存并验证」，状态变为「已连接」即说明 token 换取成功；`oauth.json` 只出现在 `%APPDATA%/pixiv-client/`。

## 代码改进建议

1. 统一分页数据源：`WorksSearchPage` / `UsersPage` / `UserDetailPage` / `UsersFollowingPage` 各自一套 `useState + useEffect + URL 参数`，抽 `usePagedQuery`（函数式 hook），页面只声明取数方式与参数映射。
2. 主进程请求层：底层已收敛到 `http.ts` 的 `requestJson`（GET 走 `fetchJson` / `fetchJsonWithHeaders`，表单 POST 走 `postFormJson` / `postFormWithHeaders`）；剩余问题是各业务模块仍各自拼错误文案，可再抽 `pixivRequest` 统一错误语义。
3. 预览升级为路由：新增 `/viewer/:id?page=` 承载大图缩放与幻灯片，`WorkDetailDialog` 保留为轻量快速预览。
4. 列表性能：搜索页一页 60+ 卡片全量渲染大图，加 `loading="lazy"` + IntersectionObserver 分批挂载，并统一使用 `c/250x250` 缩略图。
5. ✅ 过滤下沉到数据层（2026-10-28 完成）：`shared/block.ts` + `withoutBlocked()`，屏蔽规则作用于搜索结果与用户作品，保证「看到什么就能下载什么」。
6. ✅ 本地存储统一（2026-10-28 完成）：浏览历史走主进程 `viewHistory.json`（800ms 防抖 + 原子写 + 退出前 flush），与 `history.json` 同属主进程存储模块。
7. ✅ 状态全放 URL（2026-10-28 完成）：新页面沿用 `word / order / mode / page / tab` 约定；`/ranking` 用 `kind / mode / date / page`，`/recommend` 用 `tab / kind`。
8. 右键菜单：作品卡 / 用户卡加 portal 菜单，收纳「打开 pixiv / 复制链接 / 加入下载 / 屏蔽该作者」，减少卡片上的常驻图标。

## 建议推进顺序

图片查看器升级已按用户决定跳过。剩余候选：下载任务状态机补 Error / Cancelled、右键菜单、统一分页 hook；下载引擎重构单独排期。系列聚合浏览已于 2026-10-29 完成。

已完成（2026-10-28）：浏览历史、收藏浏览页、全局屏蔽、小说阅读设置、排行榜页、推荐页、写操作（收藏 / 关注 / 取关）。
已完成（2026-10-29）：稍后看、系列聚合浏览。
