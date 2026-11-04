import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import type {
  BatchSyncParams,
  DownloadParams,
  FailureItem,
} from '../../shared/types';
import { loadConfig, resolveCookie } from '../config';
import { createQueuedJob } from '../pixiv/jobs';
import {
  findJob,
  flushQueue,
  listFailures,
  listQueued,
  listSummaries,
  loadStore,
  removeJob,
  upsertJob,
} from '../queue';
import {
  activeRuns,
  executeBatch,
  pauseJobById,
  pumpQueue,
  pushQueue,
  resumeJobById,
  toInt,
  toUgoiraFormat,
} from './runtime';
import { toFailureCsv } from './works';

export function registerQueueHandlers(): void {
  // 加入队列：校验后立即返回，任务由调度器按并行额度自动启动
  ipcMain.handle('download:enqueue', async (event, params: DownloadParams) => {
    const config = await loadConfig();
    const { cookie } = await resolveCookie();
    if (!cookie) throw new Error('未配置 Cookie：R-18 内容会被 pixiv 过滤');

    const outDir = (params?.outDir || config.outDir).trim();
    if (!outDir) throw new Error('未设置保存目录');
    if (!path.isAbsolute(outDir)) throw new Error('保存目录必须是绝对路径');

    const works = params?.works || [];
    if (works.length === 0) throw new Error('没有选择作品');
    const tag = (params?.tag || config.tag).trim() || config.tag;

    const queued = createQueuedJob({
      works,
      tag,
      outDir,
      imageQuality:
        (params.imageQuality ?? config.imageQuality) === 'original'
          ? 'original'
          : 'regular',
      ugoiraFormat: toUgoiraFormat(params.ugoiraFormat ?? config.ugoiraFormat),
      workers: toInt(params.workers, config.workers, 1, 32),
      delay: Math.max(0, Math.min(5, Number(params.delay) || 0)),
    });

    // 同一位作者在队列里只允许存在一个任务（含已暂停的），避免重复抓取同一批作品
    if (queued.artistId) {
      const sameArtist = listSummaries().find(
        (job) => job.artistId && job.artistId === queued.artistId
      );
      if (sameArtist) {
        throw new Error(
          `已存在 ${sameArtist.artistLabel || sameArtist.tag} 用户的任务`
        );
      }
    }

    upsertJob(queued);

    await pushQueue();
    void pumpQueue();
    return listSummaries();
  });

  ipcMain.handle('batch:sync', (event, params: BatchSyncParams) =>
    executeBatch(params, event.sender)
  );

  // 批量同步有自己的中止入口：只停批量任务本身。
  // 不能再复用 download:cancel —— 那会连带把队列里的普通任务一起标成「已取消」
  ipcMain.handle('batch:cancel', async () => {
    for (const [key, run] of activeRuns) {
      if (key.startsWith('batch-')) run.controller.abort('cancel');
    }
    return true;
  });

  ipcMain.handle('download:cancel', async () => {
    // 先撤回排队中的任务再中止运行中的：顺序反过来的话，运行任务结束时的
    // pumpQueue 会把队首任务拉起来，紧接着又被标成已取消，白白启动一次
    for (const job of listQueued()) {
      upsertJob({
        ...job,
        status: 'cancelled',
        error: undefined,
        progress: {
          ...job.progress,
          phase: 'cancelled',
          finishedAt: Date.now(),
        },
      });
    }
    // 全局「取消」中止所有运行中的任务，逐个落盘为「已取消」（保留已下载文件，可重新开始）
    activeRuns.forEach((run) => run.controller.abort('cancel'));
    await pushQueue();
    return true;
  });

  ipcMain.handle('queue:list', async () => {
    await loadStore();
    return listSummaries();
  });

  // 继续任务：重新放回队列，由调度器在额度允许时自动启动
  ipcMain.handle('queue:resume', async (_event, id: string) => {
    const result = await resumeJobById(id);
    if (result === 'missing') throw new Error('任务不存在或已完成');
    if (result === 'running') throw new Error('该任务正在下载中');
    await pushQueue();
    void pumpQueue();
    return listSummaries();
  });

  // 暂停单个任务：运行中只中止它自己的 controller，排队中直接转为未完成
  ipcMain.handle('queue:pause', async (_event, id: string) => {
    if (!(await pauseJobById(id))) throw new Error('任务不存在或已完成');
    await pushQueue();
    return listSummaries();
  });

  // 取消单个任务：与「暂停」的区别是语义上放弃这次下载。
  // 已下载的文件全部保留，任务留在列表里显示「已取消」，可以重新开始。
  ipcMain.handle('queue:cancel', async (_event, id: string) => {
    const job = findJob(id);
    if (!job) throw new Error('任务不存在或已完成');

    const run = activeRuns.get(id);
    if (run) {
      run.controller.abort('cancel');
    } else {
      upsertJob({
        ...job,
        status: 'cancelled',
        error: undefined,
        progress: {
          ...job.progress,
          phase: 'cancelled',
          finishedAt: Date.now(),
        },
      });
    }

    await pushQueue();
    return listSummaries();
  });

  // 失败清单里逐条重试：只放行被点的那一项，其余失败记录保持不变
  ipcMain.handle(
    'queue:retry-item',
    async (event, id: string, item: FailureItem) => {
      const job = findJob(id);
      if (!job) throw new Error('任务不存在或已完成');
      if (activeRuns.has(id)) throw new Error('该任务正在下载中');
      if (!item || !item.illustId) throw new Error('失败项无效');

      const retry =
        item.kind === 'work'
          ? { illustIds: [item.illustId] }
          : item.url
            ? { taskUrls: [item.url] }
            : { illustIds: [item.illustId] };

      upsertJob({ ...job, status: 'queued', retry, error: undefined });
      await pushQueue();
      void pumpQueue();
      return listSummaries();
    }
  );

  ipcMain.handle('queue:remove', async (_event, id: string) => {
    if (activeRuns.has(id)) throw new Error('该任务正在下载中');
    removeJob(id);
    await flushQueue();
    await pushQueue();
    return listSummaries();
  });

  ipcMain.handle('queue:failures', async (_event, id: string) => {
    await loadStore();
    return listFailures(id);
  });

  ipcMain.handle('queue:export-failures', async (_event, id: string) => {
    await loadStore();
    const job = findJob(id);
    if (!job) throw new Error('任务不存在或已完成');
    const failures = listFailures(id);
    if (failures.length === 0) throw new Error('该任务没有失败项');

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog({
      defaultPath: path.join(
        app.getPath('downloads'),
        `pixiv-failures-${stamp}.csv`
      ),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;

    await writeFile(result.filePath, toFailureCsv(failures), 'utf-8');
    return result.filePath;
  });
}
