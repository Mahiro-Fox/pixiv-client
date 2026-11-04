import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { throttleLimitsFromConfig } from '../../shared/throttle';
import type {
  AppConfig,
  OAuthClientInput,
  OAuthCredentials,
  ProxyConfig,
} from '../../shared/types';
import {
  clearCookie,
  getCookieStatus,
  loadConfig,
  resolveCookie,
  saveConfig,
  saveCookie,
} from '../config';
import { probeCookieHealth } from '../pixiv/api';
import { setAuthFailureHandler } from '../pixiv/http';
import { setPixivLang } from '../pixiv/lang';
import { clearPixivLoginSession, openPixivLogin } from '../pixiv/login';
import {
  clearOAuth,
  getOAuthStatus,
  saveOAuthCredentials,
} from '../pixiv/oauth';
import { autoLoginOAuth, loginOAuthWithPKCE } from '../pixiv/oauthLogin';
import {
  applyThrottleLimits,
  onThrottleChange,
  throttleStates,
} from '../pixiv/throttle';
import {
  applyProxy,
  getProxyState,
  saveProxyPassword,
  testProxy,
} from '../proxy';
import { applyTrayConfig } from '../tray';
import {
  checkForUpdates,
  getUpdateStatus,
  initUpdater,
  installUpdate,
} from '../updater';
import {
  broadcast,
  clearLibraryCache,
  pumpQueue,
  watchLibraryDir,
} from './runtime';

export function registerSettingsHandlers(): void {
  // 自动更新：状态统一走广播，界面订阅 update:status 即可
  initUpdater((status) => broadcast('update:status', status));

  onThrottleChange((state) => broadcast('throttle:state', state));

  // 任何接口回 401/403 都说明 Cookie 已失效，推给界面提醒用户重新登录
  setAuthFailureHandler(() => broadcast('cookie:invalid', null));

  // 启动时应用已保存的限流参数，并监听保存目录变化
  void loadConfig().then((config) => {
    applyThrottleLimits(throttleLimitsFromConfig(config));
    watchLibraryDir(config.outDir);
  });

  ipcMain.handle('config:get', () => loadConfig());

  ipcMain.handle('config:set', async (_event, patch: Partial<AppConfig>) => {
    // 代理走独立的 proxy:set 通道：这里忽略 proxy 字段，
    // 否则关闭设置弹窗时的整份配置可能覆盖刚保存的代理值
    const rest = { ...patch };
    delete rest.proxy;
    const config = await saveConfig(rest);
    // 语言可能刚被改过：接口的 lang 参数要立刻跟着变，下一次抓取就是新语言
    setPixivLang(config.locale);
    clearLibraryCache();
    // 限流参数改完立即生效，不必等下一次下载；保存目录变化时重建监听
    applyThrottleLimits(throttleLimitsFromConfig(config));
    watchLibraryDir(config.outDir);
    // 并行任务数调大时，排队中的任务可以立刻补位
    void pumpQueue();
    // 托盘开关 / 关窗行为 / 提醒开关都在这份配置里，改完立即生效
    applyTrayConfig(config);
    return config;
  });

  ipcMain.handle('cookie:get', () => getCookieStatus());

  ipcMain.handle('cookie:set', (_event, raw: string) => saveCookie(raw));

  // 应用内登录：开一个独立窗口走 pixiv 登录页，成功后直接读取自己的会话 Cookie
  ipcMain.handle('cookie:login', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const cookie = await openPixivLogin(parent);
    if (!cookie) return null;
    // 登录成功顺手静默完成 App API 授权（复用同一登录分区，通常不弹任何界面），
    // 完成后通知界面刷新凭据状态，这样收藏 / 关注按钮不用重启就能用
    void autoLoginOAuth(parent).then(async () => {
      const status = await getOAuthStatus();
      if (status.connected) broadcast('oauth:changed', status);
    });
    return saveCookie(cookie);
  });

  // 清除 Cookie：同时清空登录窗口分区的旧会话，
  // 否则下次点登录会被残留会话直接跳过，窗口来不及显示就关掉了。
  // App API 的 refresh_token 绑定的也是当前账号，只删 Cookie 会让收藏 / 关注
  // 等写操作继续以已退出的账号执行，所以两套凭据必须一起清。
  // 三个清理动作彼此独立：任何一步失败都要继续把其余状态清掉，
  // 否则会留下「点了清除但仍按旧身份请求」的假象
  ipcMain.handle('cookie:clear', async () => {
    // 凭据清理失败时内存缓存也已置空，回读一次真实状态再广播，避免界面显示还在连线
    const oauthStatus = await clearOAuth().catch(() => getOAuthStatus());
    broadcast('oauth:changed', oauthStatus);
    // 登录分区只影响下次登录要不要重过验证码，失败不该阻塞退出
    await clearPixivLoginSession().catch(() => undefined);
    // Cookie 文件是主凭据，删不掉要如实报给界面，不能假装已退出
    return clearCookie();
  });

  // Cookie 体检：界面启动时和用户手动触发时调用
  ipcMain.handle('cookie:health', async () => {
    const { cookie } = await resolveCookie();
    return probeCookieHealth(cookie);
  });

  // App API（OAuth）凭据：写操作（收藏、关注）走 app-api.pixiv.net + Bearer
  ipcMain.handle('oauth:status', () => getOAuthStatus());
  ipcMain.handle('oauth:save', async (_event, credentials: unknown) => {
    const value = (credentials ?? {}) as Partial<OAuthCredentials>;
    return saveOAuthCredentials({
      clientId: String(value.clientId ?? ''),
      clientSecret: String(value.clientSecret ?? ''),
      refreshToken: String(value.refreshToken ?? ''),
    });
  });
  ipcMain.handle('oauth:clear', () => clearOAuth());
  ipcMain.handle('oauth:login', async (event, client: unknown) => {
    const value = (client ?? {}) as Partial<OAuthClientInput>;
    const parent = BrowserWindow.fromWebContents(event.sender);
    return loginOAuthWithPKCE(parent, {
      clientId: value.clientId
        ? String(value.clientId).slice(0, 200)
        : undefined,
      clientSecret: value.clientSecret
        ? String(value.clientSecret).slice(0, 200)
        : undefined,
    });
  });

  ipcMain.handle('dialog:pick-dir', async () => {
    const config = await loadConfig();
    const result = await dialog.showOpenDialog({
      defaultPath: config.outDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('shell:open-dir', async (_event, dir: string) => {
    await shell.openPath(dir);
  });

  ipcMain.handle('throttle:get', () => throttleStates());

  ipcMain.handle('app:version', () => app.getVersion());

  // 自动更新：新版本由主进程在后台自动下载，check 只用来手动触发一次检查，
  // install 仅在已下载完成时生效
  ipcMain.handle('update:status', () => getUpdateStatus());
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:install', () => installUpdate());

  ipcMain.handle('proxy:get', () => getProxyState());

  // 保存并立即应用：密码 undefined 表示沿用已保存的密码，空串表示清除
  ipcMain.handle(
    'proxy:set',
    async (_event, patch: Partial<ProxyConfig>, password?: string) => {
      const current = await loadConfig();
      await saveConfig({ proxy: { ...current.proxy, ...(patch || {}) } });
      await saveProxyPassword(password);
      return applyProxy();
    }
  );

  ipcMain.handle('proxy:test', () => testProxy());
}
