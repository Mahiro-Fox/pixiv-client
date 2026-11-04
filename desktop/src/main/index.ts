import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, session, shell } from 'electron';
import { loadConfig } from './config';
import { flushHistory } from './history';
import {
  pauseAllJobs,
  registerIpcHandlers,
  resumeAllJobs,
  shutdownActiveJob,
} from './ipc';
import { USER_AGENT } from './pixiv/http';
import { setPixivLang } from './pixiv/lang';
import { ugoiraCoverDir } from './pixiv/ugoiraCover';
import { applyProxy } from './proxy';
import { flushQueue } from './queue';
import {
  applyTrayConfig,
  isTrayActive,
  notifyHiddenToTray,
  shouldCloseToTray,
  shouldMinimizeToTray,
  type TrayActions,
} from './tray';
import { flushViews } from './viewHistory';
import { flushWatchLater } from './watchLater';

const LOCAL_SCHEME = 'pixivfile';

/** 主窗口句柄：托盘要用它显示 / 隐藏，窗口关闭后置空 */
let mainWindow: BrowserWindow | null = null;
/** 正在退出：此后关闭窗口不再拦截，也不再弹托盘提示 */
let shuttingDown = false;

/**
 * 全局 UA 兜底。
 * Electron 默认 UA 里带 `Electron/45.0.0` 和 app 名，reCAPTCHA 这类风控
 * 一看到就会把请求判为嵌入式客户端，导致 pixiv 登录页的验证无限循环。
 * 必须用 `userAgentFallback`：`webContents.setUserAgent()` 和
 * `session.setUserAgent()` 都不会传播到跨站 OOPIF，而 reCAPTCHA 恰好
 * 跑在 recaptcha.net 的 iframe 里。此项必须在 app ready 之前设置。
 */
app.userAgentFallback = USER_AGENT;

/**
 * 判断路径是否落在某个根目录内。协议只服务两类文件：
 * 用户下载目录，以及动图首帧缩略图的缓存目录（后者不在下载目录里）。
 */
function isInside(root: string, target: string): boolean {
  const inside = relative(resolve(root), resolve(target));
  return Boolean(inside) && !inside.startsWith('..') && !isAbsolute(inside);
}

/** 本地图库缩略图协议：只允许读取保存目录与缩略图缓存目录内的文件，避免越权访问 */
function registerLocalFileProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

function serveLocalFile(): void {
  protocol.handle(LOCAL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const config = await loadConfig();
      const root = resolve(config.outDir);
      // 形如 pixivfile://local/?path=D%3A%2F... ，host 仅作占位
      const raw = url.searchParams.get('path') || '';
      const target = resolve(raw);
      // 缩略图缓存不在下载目录里，单独放行一个根
      const allowed =
        isInside(root, target) || isInside(ugoiraCoverDir(), target);
      if (!allowed) {
        return new Response('Forbidden', { status: 403 });
      }
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}

function installImageReferer(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://i.pximg.net/*', 'https://*.pximg.net/*'] },
    (details, callback) => {
      details.requestHeaders.Referer = 'https://www.pixiv.net/';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0e',
    title: 'Pixiv Client',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on('ready-to-show', () => window.show());

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  /**
   * 关窗口 = 收进托盘（默认）。
   * 下载任务在跑时尤其重要：关窗口不应该等于取消任务。
   * 退出走托盘菜单或 before-quit，那时 shuttingDown 已置位，不再拦截。
   */
  window.on('close', (event) => {
    if (shuttingDown || !shouldCloseToTray()) return;
    event.preventDefault();
    window.hide();
    notifyHiddenToTray();
  });

  // Windows 的 minimize 事件不可取消，只能先让它最小化再隐藏；
  // 从托盘回来时 showMainWindow 会先 restore，所以不会留下最小化状态
  window.on('minimize', () => {
    if (!shouldMinimizeToTray()) return;
    window.hide();
    notifyHiddenToTray();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
    // 开发模式：F12 / Ctrl+Shift+I 切换 DevTools。
    // 用 before-input-event 而不是 globalShortcut —— 后者是系统级热键，
    // 要和其他程序抢 F12，抢不到就静默失效；这里只在本窗口聚焦时响应，
    // 且打包后不注册。
    const onDevToolsHotkey = (
      event: Electron.Event,
      input: Electron.Input
    ): void => {
      if (input.type !== 'keyDown') return;
      const modifier =
        process.platform === 'darwin' ? input.meta : input.control;
      const toggle =
        input.key === 'F12' ||
        (modifier && input.shift && input.key.toLowerCase() === 'i');
      if (!toggle) return;
      event.preventDefault();
      window.webContents.toggleDevTools();
    };
    window.webContents.on('before-input-event', onDevToolsHotkey);
    // DevTools 打开后焦点在它自己的 webContents 上，主窗口收不到按键，
    // 这里补一份监听，F12 才能再次关闭面板
    window.webContents.on('devtools-opened', () => {
      window.webContents.devToolsWebContents?.on(
        'before-input-event',
        onDevToolsHotkey
      );
    });
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

/** 显示并聚焦主窗口；窗口已被销毁时重建一个 */
function showMainWindow(): void {
  const window = mainWindow ?? createWindow();
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

const trayActions: TrayActions = {
  showWindow: showMainWindow,
  hideWindow: () => mainWindow?.hide(),
  quit: () => app.quit(),
  pauseAll: pauseAllJobs,
  resumeAll: resumeAllJobs,
  isWindowActive: () => {
    const window = mainWindow;
    return Boolean(
      window &&
      window.isVisible() &&
      !window.isMinimized() &&
      window.isFocused()
    );
  },
};

registerLocalFileProtocol();

// 单实例：托盘常驻后用户很容易再次点桌面图标，
// 第二次启动应该把已有窗口叫出来，而不是再起一个进程和托盘图标。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

app.whenReady().then(async () => {
  // Windows 通知 / 任务栏归组都按 AUMID 识别应用，必须在建窗口前设好
  app.setAppUserModelId('com.pixiv.desktop');
  installImageReferer();
  // 先应用代理再建窗口：首屏的接口与图片请求就要走对网络
  await applyProxy().catch(() => undefined);
  // 接口的 lang 参数跟着界面语言走，首屏抓取前就得对齐，否则第一批标题是中文译文
  const config = await loadConfig().catch(() => null);
  if (config) setPixivLang(config.locale);
  serveLocalFile();
  registerIpcHandlers();
  createWindow();
  // 托盘在窗口之后创建：菜单里的「显示/隐藏」需要窗口已经存在
  if (config) applyTrayConfig(config, trayActions);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // 托盘还在时保留进程：窗口可能因异常被销毁，托盘菜单还得能把窗口叫回来
  if (isTrayActive()) return;
  app.quit();
});

// 退出前：中止下载任务，等它把「已暂停」快照写出，再强制落盘队列
app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void (async () => {
    await shutdownActiveJob();
    await flushQueue();
    await flushHistory();
    await flushViews();
    await flushWatchLater();
    app.quit();
  })();
});
