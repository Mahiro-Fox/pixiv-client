# 打包与发布流程

- 适用对象：`desktop/`（Electron + React + TypeScript 桌面端）
- 发布渠道：GitHub Actions 自动构建并创建 Release
- 产物形态：Windows NSIS 安装包（x64），单文件
- 仓库：<https://github.com/Mahiro-Fox/pixiv-client>

---

## 1. 产物一览

| 文件 | 说明 |
| --- | --- |
| `release/pixiv-client-{version}-setup.exe` | NSIS 安装包，唯一对外分发的产物 |
| `release/pixiv-client-{version}-setup.exe.blockmap` | 差分更新用的块映射（自动上传） |
| `release/latest.yml` | 版本与哈希元数据（自动上传） |
| `release/win-unpacked/` | 免安装目录版，仅供本地调试，不发布 |

`release/` 已被 `.gitignore` 忽略。

产物文件名固定为 ASCII（`pixiv-client-...`），避免 Release 下载链接里出现中文百分号编码；用户看到的应用名仍是 `Pixiv Client`（`productName`）。

---

## 2. 关键约束

### 2.1 ffmpeg 必须解包到 asar 外

动图（ugoira）转码依赖随包的 `ffmpeg-static`（当前 **6.1.1**，约 79 MB）。

`electron-builder.yml` 中：

```yaml
asarUnpack:
  - node_modules/ffmpeg-static/**
```

原因：Windows 上 `spawn` 一个位于 `app.asar` 内的可执行文件会直接失败——asar 是虚拟文件系统，没有真实路径。解包后实际路径为：

```
release/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe
```

主进程通过 `src/main/pixiv/ugoira.ts` 的 `unpackedPath()` 把 `app.asar` 改写为 `app.asar.unpacked`，因此开发模式与打包模式共用同一段代码。也支持用环境变量 `FFMPEG_PATH` 覆盖。

### 2.2 版本号与 tag 必须一致

`electron-builder` 用 `desktop/package.json` 的 `version` 决定上传到哪个 Release。推 `v0.1.0` 的 tag 时，package.json 也必须是 `0.1.0`，否则只会新建一个空 Release，安装包不会挂上去。

### 2.3 不签名

当前未配置代码签名证书，构建日志会出现：

```
no code signing certificate configured, signing is skipped
```

属于预期行为。副作用是 SmartScreen 首次运行会提示「未知发布者」。要消除该提示需要购买 OV/EV 证书并在 `win` 下配置 `certificateFile` / `certificatePassword`（见第 7 节）。

---

## 3. 首次发布前的一次性配置

1. **仓库已就绪**：`electron-builder.yml` 的 `publish.owner/repo` 已指向 `Mahiro-Fox/pixiv-client`。
2. **Token**：工作流使用 Actions 内置的 `secrets.GITHUB_TOKEN`，无需手动创建 PAT。仅在需要跨仓库发布时，才改用自定义 `GH_TOKEN` secret。
3. **权限**：工作流已声明 `permissions: contents: write`，这是创建 Release 与上传资产的必要条件。若仓库 Settings → Actions → Workflow permissions 被设为「Read repository contents」，需要改为「Read and write」。
4. **NSIS 资源**：首次构建需联网下载 `nsis` / `nsis-resources` / `winCodeSign`（约几十 MB）。CI 上每次都是干净环境，由 electron-builder 自行缓存。

---

## 4. 本地构建（不发版）

```bash
cd desktop
npm run dist
```

等价于 `npm run build && electron-builder --publish never`。

注意脚本里显式带了 `--publish never`：electron-builder 默认在检测到 CI 环境变量时会「隐式发布」，本地构建不应有副作用，所以明确关闭。

### 4.1 构建后自检清单

```powershell
$r = 'desktop\release'

# 1) 安装包是否产出
Get-ChildItem $r\*.exe | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}}

# 2) ffmpeg 是否被解包出 asar，且可执行
$ff = "$r\win-unpacked\resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe"
Test-Path $ff
& $ff -version   # 期望输出 ffmpeg version 6.1.1-essentials_build-www.gyan.dev

# 3) ffmpeg 不应被打进 asar
Get-Item "$r\win-unpacked\resources\app.asar" | Select-Object @{n='MB';e={[math]::Round($_.Length/1MB,2)}}
# 期望约 36 MB；若接近 120 MB 说明 ffmpeg 被打进了 asar，asarUnpack 未生效

# 4) 图标是否生效
# 构建日志中不应再出现 "default Electron icon is used"
```

### 4.2 构建日志中的健康信号

| 日志 | 含义 |
| --- | --- |
| `loaded configuration file=...electron-builder.yml` | 配置已加载 |
| `signing is skipped path=...ffmpeg.exe`（路径含 `app.asar.unpacked`） | ffmpeg 已正确解包 |
| `building target=nsis file=release\pixiv-client-0.1.0-setup.exe` | NSIS 打包开始 |
| `building block map` | 差分更新映射生成完成 |

---

## 5. 正式发布（打 tag 触发 CI）

```bash
cd desktop
npm version 0.2.0 --no-git-tag-version   # 只改 package.json，不自动提交
cd ..
git add desktop/package.json desktop/package-lock.json
git commit -m "chore: release v0.2.0"
git tag v0.2.0
git push origin main --tags
```

推送 tag 后，`.github/workflows/release.yml` 自动执行：

1. `actions/checkout` 拉取代码
2. `actions/setup-node`（Node 24，缓存 `desktop/package-lock.json`）
3. `npm ci`（会触发 `ffmpeg-static` 的 postinstall，从网络下载 ffmpeg.exe）
4. `npm run typecheck`
5. `npm run dist:publish`（= `npm run build && electron-builder --publish always`），注入 `GH_TOKEN`

因为 `publish.releaseType: release`，构建成功后直接生成**正式 Release**（不是 draft），安装包挂在该 tag 下。

> 若想先人工确认再对外可见，把 `electron-builder.yml` 的 `releaseType` 改成 `draft`，在 GitHub 上确认后手动点 Publish。

### 5.1 工作流文件位置

File: `d:\soft\myFile\code\pixiv-client\.github\workflows\release.yml`

GitHub Actions **只读取仓库根目录**的 `.github/workflows/`。本项目根目录是 `pixiv-client/`，桌面端在 `pixiv-client/desktop/`，因此工作流用 `defaults.run.working-directory: desktop` 切到子目录，缓存路径写 `desktop/package-lock.json`。

### 5.2 一个 tag 只能有一个 Release（否则差分更新失效）

**现象**：Release 列表里同一个 tag 出现两条；其中一条只有 `latest.yml` 与安装包，另一条只有一个 `.blockmap`；更新时每次都全量下载 140MB。

**根因**：electron-builder 的 `PublishManager.getOrCreatePublisher` 不是并发安全的。安装包、`latest.yml`、`.blockmap` 三个 artifact 几乎同时触发上传，`createPublisher` 内部有 `await`（读取 release notes），等待期间后来的 artifact 看到的缓存仍为空，于是又建了一个 publisher。两个 publisher 各自执行「列出 Release → 没有本 tag → 新建」，就创建了两个 Release，资产被拆到两边。而 `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>` 只服务其中一个 Release 的资产，所以 `xxx.exe.blockmap` 返回 404，`electron-updater` 拿不到差分映射，日志出现 `Cannot download differentially, fallback to full download`。

**修法**：工作流在 `Build and publish` 之前用 `gh release create` 先把 Release 建好（`Ensure release exists` 步骤），electron-builder 就只会复用、不再新建；发布后再用 `Verify release assets` 断言安装包 / `.blockmap` / `latest.yml` 三者都在同一个 Release 里，缺一个直接让流水线失败。

**注意**：差分更新同时需要「新版本的 blockmap」和「旧版本的 blockmap」。旧版本的也要能被下载到，所以历史 Release 必须自带 `.blockmap`：如果某个版本的 `.blockmap` 不在它的 Release 里，从这个版本升级到下一个版本依然会全量下载（跳过这个版本之后才恢复增量）。

**清理已产生的重复 Release**（`gh` 需要 repo 写权限）：

```bash
repo=Mahiro-Fox/pixiv-client
tag=v0.1.3

# 1) 先把 blockmap 从「只有 blockmap」的那条 Release 里取出来（按 asset id）
gh api /repos/$repo/releases --jq ".[] | select(.tag_name==\"$tag\") | {id, assets:[.assets[].name]}"
curl -L -H "Accept: application/octet-stream" \
  -o pixiv-client-0.1.3-setup.exe.blockmap \
  https://api.github.com/repos/$repo/releases/assets/<blockmap_asset_id>

# 2) 删掉那条只有 blockmap 的重复 Release
gh api -X DELETE /repos/$repo/releases/<只有blockmap的release_id>

# 3) 把 blockmap 补进真正带安装包的那条 Release
gh release upload $tag pixiv-client-0.1.3-setup.exe.blockmap
```

补完后 `https://github.com/$repo/releases/download/$tag/pixiv-client-0.1.3-setup.exe.blockmap` 应当返回 200（而不是 404）。


---

## 6. 手动发布（CI 不可用时的兜底）

```powershell
cd desktop
$env:GH_TOKEN = "<有 repo 权限的 PAT>"
npm run dist:publish
```

`--publish always` 会创建（或复用）与 package.json `version` 对应的 Release 并上传资产。

---

## 7. 可选增强

### 7.1 代码签名

```yaml
win:
  certificateFile: build/cert.pfx        # 不要提交到仓库
  certificatePassword: ${env.CSC_KEY_PASSWORD}
```

CI 中把 `CSC_LINK`（base64 的 pfx）与 `CSC_KEY_PASSWORD` 配成 secrets，electron-builder 会自动识别，无需改 yml。

### 7.2 自动更新

安装包已生成 `latest.yml` 与 blockmap，具备接入 `electron-updater` 的条件。接入步骤：主进程调用 `autoUpdater.checkForUpdatesAndNotify()`，并把 `publish` 配置保留（`electron-updater` 就读它）。

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 首次构建卡在下载 | electron-builder 在拉 NSIS / winCodeSign。国内可配 `.npmrc` 的 `electron_builder_binaries_mirror`（仓库已有），CI 上走直连 |
| 日志出现 `default Electron icon is used` | `win.icon` 路径不对，确认 `build/icon.ico` 存在且含 256×256 |
| 安装包体积 ~140 MB | 正常：Electron 运行时 + ffmpeg 79 MB + 渲染层产物 |
| 动图下载后直接落 `.zip` | 运行时找不到 ffmpeg，代码会自动退回保留压缩包；检查 `asarUnpack` 与 `app.asar.unpacked` 目录 |
| 构建报 URL/文件名为乱码 | 曾在 PowerShell 5.1 下出现过：含中文的 `.ps1` 会被按 ANSI 解码，脚本应保持纯 ASCII |
| 上传 Release 报 403 | `permissions: contents: write` 缺失，或用了只读的 token |
| tag 推了但没有产物 | tag 名与 package.json `version` 不一致（必须是 `v` + 完全相同的版本号） |
| 同一个 tag 出现两条 Release | electron-builder 并发建 publisher 的竞态，见 5.2；清掉重复项，工作流已改为先建 Release |
| 更新每次都全量下载 140MB | Release 里缺少 `xxx.exe.blockmap`（或它挂在同 tag 的另一条 Release 上），见 5.2 |
| 日志 `Cannot download differentially, fallback to full download` | 同上；也可能是本机没有上一版安装包缓存（首次从旧版本升级时属正常，成功一次后就会有） |

---

## 9. 回滚

- 让某个 Release 不可见：在 GitHub 上删除该 Release（tag 可保留）。
- 让用户回退版本：把目标版本的安装包链接单独发出去；已安装用户需手动卸载再装旧版（当前未接自动更新，不存在静默降级）。
- 撤回一次错误 tag：`git push origin :refs/tags/v0.2.0` 删除远端 tag，再重新打。

---

## 10. 相关文件

| 文件 | 作用 |
| --- | --- |
| `desktop/electron-builder.yml` | 打包与发布配置（图标、asarUnpack、NSIS、publish） |
| `desktop/package.json` | `dist` / `dist:publish` 脚本、版本号、author |
| `desktop/build/icon.ico` | 应用图标（16/24/32/48/64/128/256 七个尺寸） |
| `.github/workflows/release.yml` | 打 tag 自动构建并发布 |
| `desktop/src/main/pixiv/ugoira.ts` | ffmpeg 路径改写与动图转码 |