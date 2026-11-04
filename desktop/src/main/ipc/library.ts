import { rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { ipcMain, shell } from 'electron';
import type { LibraryWorkKey, ViewRecordInput } from '../../shared/types';
import { loadConfig } from '../config';
import { forgetHistory } from '../history';
import { readWorkFiles, scanLibrary } from '../library';
import { clearViews, listViews, recordView } from '../viewHistory';
import {
  addWatchLater,
  clearWatchLater,
  isWatchLater,
  listWatchLater,
  removeWatchLater,
} from '../watchLater';
import {
  clearLibraryCache,
  LIBRARY_CACHE_MS,
  readLibraryCache,
  watchLibraryDir,
  writeLibraryCache,
} from './runtime';

export function registerLibraryHandlers(): void {
  ipcMain.handle('library:list', async (_event, force?: boolean) => {
    const config = await loadConfig();
    const outDir = (config.outDir || '').trim();
    if (!outDir || !path.isAbsolute(outDir))
      throw new Error('保存目录无效，请先在设置中选择目录');
    const resolved = path.resolve(outDir);
    // 保存目录可能在 config:set 之外被改动，这里兜底对齐监听目标
    watchLibraryDir(resolved);
    const cached = readLibraryCache();
    if (
      !force &&
      cached &&
      cached.result.outDir === resolved &&
      Date.now() - cached.at < LIBRARY_CACHE_MS
    ) {
      return cached.result;
    }
    const result = await scanLibrary(
      resolved,
      config.fileNameTemplate,
      Boolean(force)
    );
    writeLibraryCache({ at: Date.now(), result });
    return result;
  });

  ipcMain.handle('library:files', async (_event, keys: LibraryWorkKey[]) => {
    const config = await loadConfig();
    const outDir = (config.outDir || '').trim();
    if (!outDir || !path.isAbsolute(outDir))
      throw new Error('保存目录无效，请先在设置中选择目录');
    const list = Array.isArray(keys) ? keys : [];
    return readWorkFiles(path.resolve(outDir), config.fileNameTemplate, list);
  });

  ipcMain.handle('library:open-dir', async (_event, dir: string) => {
    const config = await loadConfig();
    const root = path.resolve(config.outDir);
    const target = path.resolve(String(dir || root));
    const relative = path.relative(root, target);
    // relative 为空表示就是保存目录本身；以 .. 开头或跨盘符说明越界
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('目录不在保存目录内');
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });

  ipcMain.handle('library:delete', async (_event, paths: string[]) => {
    const config = await loadConfig();
    const outDir = (config.outDir || '').trim();
    if (!outDir || !path.isAbsolute(outDir))
      throw new Error('保存目录无效，请先在设置中选择目录');
    const root = path.resolve(outDir);

    const removed: string[] = [];
    const dirs = new Set<string>();
    for (const item of Array.isArray(paths) ? paths : []) {
      const target = path.resolve(String(item || ''));
      const relative = path.relative(root, target);
      // 只允许删除保存目录内、且不是目录本身的文件
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        continue;
      try {
        await rm(target, { force: true });
        removed.push(target);
        dirs.add(path.dirname(target));
      } catch {
        // 单个文件删除失败不影响其它文件
      }
    }
    if (removed.length === 0) throw new Error('没有可删除的文件');

    forgetHistory(removed);
    // 顺带清理变空的内容目录（illustration / manga）与作者目录
    for (const dir of dirs) {
      try {
        await rmdir(dir);
        await rmdir(path.dirname(dir));
      } catch {
        // 目录非空或已不存在，忽略
      }
    }

    clearLibraryCache();
    const result = await scanLibrary(root, config.fileNameTemplate);
    writeLibraryCache({ at: Date.now(), result });
    return result;
  });

  // 浏览记录：打开作品详情时写一条，页面按时间倒序读取
  ipcMain.handle('viewHistory:list', async () => listViews());
  ipcMain.handle(
    'viewHistory:record',
    async (_event, entry: ViewRecordInput) => {
      await recordView(entry);
    }
  );
  ipcMain.handle('viewHistory:clear', async () => clearViews());

  // 稍后看：纯本地列表，与 pixiv 收藏无关；add 幂等，返回最新列表
  ipcMain.handle('watchLater:list', async () => listWatchLater());
  ipcMain.handle('watchLater:state', async (_event, id: unknown) =>
    isWatchLater(String(id ?? ''))
  );
  ipcMain.handle('watchLater:add', async (_event, entry: ViewRecordInput) =>
    addWatchLater(entry)
  );
  ipcMain.handle('watchLater:remove', async (_event, id: unknown) =>
    removeWatchLater(String(id ?? ''))
  );
  ipcMain.handle('watchLater:clear', async () => clearWatchLater());
}
