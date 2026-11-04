import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { app } from 'electron';
import { resolveFfmpegPath } from './ugoira';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
/** 缓存文件可能出现的扩展名：ffmpeg 出 jpg，没有 ffmpeg 时直接落原始帧 */
const COVER_EXTS = ['.jpg', '.png', '.webp', '.bmp'];
/** 缓存键前缀：以后改缩略图尺寸/参数时换一个值即可整体失效 */
const CACHE_VERSION = 'v1';
/** 卡片宽度不到 300px，512 宽足够清晰，也不至于让缓存目录涨起来 */
const COVER_WIDTH = 512;

/** 动图首帧缩略图的缓存目录（放在 userData，不污染用户的下载目录） */
export function ugoiraCoverDir(): string {
  return path.join(app.getPath('userData'), 'ugoira-covers');
}

/** 只有这几种动图成品能出首帧：zip 解压取帧，mp4 / webm / gif 交给 ffmpeg */
export function isUgoiraSource(filePath: string): boolean {
  return ['.zip', '.mp4', '.webm', '.gif'].includes(
    path.extname(filePath).toLowerCase()
  );
}

/** 同一张封面可能被作品卡与作者卡同时请求，合并成一次解码 */
const pending = new Map<string, Promise<string>>();
/** 缓存上限：重新下载会换键，旧图不清就会一直攒；每次启动只清理一次 */
const MAX_COVERS = 600;
let pruned = false;

async function pruneCovers(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  if (names.length <= MAX_COVERS) return;
  const stats = await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name);
      const info = await stat(full).catch(() => null);
      return info ? { full, at: info.mtimeMs } : null;
    })
  );
  const sorted = stats
    .filter((item): item is { full: string; at: number } => Boolean(item))
    .sort((a, b) => a.at - b.at);
  await Promise.all(
    sorted
      .slice(0, Math.max(0, sorted.length - MAX_COVERS))
      .map((item) => rm(item.full, { force: true }).catch(() => undefined))
  );
}

/**
 * 取动图作品的首帧缩略图，返回缓存文件的绝对路径；取不到时返回空串。
 *
 * 卡片本身不播视频，只显示一张静态图，所以这里把「首帧」落成磁盘缩略图而不是
 * 每次现解帧交给渲染层：图库滚动时只有 <img>，没有几十个解码器在跑。
 * 缓存键带上文件大小与 mtime，重新下载后自动换新图，不用手动清缓存。
 */
export async function ensureUgoiraCover(sourcePath: string): Promise<string> {
  if (!isUgoiraSource(sourcePath)) return '';
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(sourcePath);
  } catch {
    return '';
  }
  if (!info.isFile() || info.size === 0) return '';

  const key = createHash('sha1')
    .update(
      `${CACHE_VERSION}|${sourcePath}|${info.size}|${Math.round(info.mtimeMs)}`
    )
    .digest('hex')
    .slice(0, 24);
  const dir = ugoiraCoverDir();

  for (const ext of COVER_EXTS) {
    const cached = path.join(dir, `${key}${ext}`);
    if (existsSync(cached)) return cached;
  }

  const running = pending.get(key);
  if (running) return running;
  const task = buildCover(sourcePath, dir, key)
    .then((value) => {
      if (value && !pruned) {
        pruned = true;
        void pruneCovers(dir);
      }
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

/** 单张缩略图的 ffmpeg 参数：只取一帧、等比缩到目标宽度、出 jpg */
function coverArgs(input: string, output: string): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-frames:v',
    '1',
    // 缩小用 lanczos，放大到 512 也不会糊成一团；高度取 -2 保证是偶数
    '-vf',
    `scale=${COVER_WIDTH}:-2:flags=lanczos`,
    '-q:v',
    '4',
    '-f',
    'mjpeg',
    output,
  ];
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 30_000 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        reject(
          new Error(
            String(stderr || error.message).trim() || 'ffmpeg 生成缩略图失败'
          )
        );
      }
    );
  });
}

/** pixiv 的帧文件名是补零序号，按数值排序才能拿到真正的第一帧 */
function firstZipFrame(zipPath: string): { data: Buffer; ext: string } | null {
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter(
      (entry) =>
        !entry.isDirectory &&
        IMAGE_EXTS.has(path.extname(entry.entryName).toLowerCase())
    )
    .sort((a, b) =>
      a.entryName.localeCompare(b.entryName, undefined, { numeric: true })
    );
  const first = entries[0];
  if (!first) return null;
  return {
    data: first.getData(),
    ext: path.extname(first.entryName).toLowerCase(),
  };
}

/** 没有 ffmpeg 时退回原始帧：不缩放，但至少卡片有图可看 */
async function writeRawFrame(
  dir: string,
  key: string,
  frame: { data: Buffer; ext: string }
): Promise<string> {
  const ext = frame.ext === '.jpeg' ? '.jpg' : frame.ext;
  const output = path.join(dir, `${key}${ext}`);
  const temp = path.join(dir, `.${key}-${randomUUID().slice(0, 6)}${ext}`);
  await writeFile(temp, frame.data);
  await rename(temp, output);
  return output;
}

async function buildCover(
  sourcePath: string,
  dir: string,
  key: string
): Promise<string> {
  const bin = resolveFfmpegPath();
  const ext = path.extname(sourcePath).toLowerCase();
  await mkdir(dir, { recursive: true }).catch(() => undefined);

  try {
    if (ext === '.zip') {
      const frame = firstZipFrame(sourcePath);
      if (!frame) return '';
      if (bin) {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pixiv-cover-'));
        try {
          const tempFile = path.join(
            tempDir,
            `frame${frame.ext === '.jpeg' ? '.jpg' : frame.ext}`
          );
          await writeFile(tempFile, frame.data);
          const output = path.join(dir, `${key}.jpg`);
          await runFfmpeg(bin, coverArgs(tempFile, output));
          if (existsSync(output)) return output;
        } catch {
          // ffmpeg 不认这个帧格式：落到下面的原始帧兜底
        } finally {
          await rm(tempDir, { recursive: true, force: true }).catch(
            () => undefined
          );
        }
      }
      // 没有 ffmpeg、或它转不动时，直接把第一帧原样存一份当封面
      return await writeRawFrame(dir, key, frame);
    }

    // 视频与 gif：直接让 ffmpeg 解第一帧
    if (!bin) return '';
    const output = path.join(dir, `${key}.jpg`);
    await runFfmpeg(bin, coverArgs(sourcePath, output));
    return existsSync(output) ? output : '';
  } catch {
    // 解不出来（成品损坏、ffmpeg 不支持）就让卡片退回占位图标，不打扰用户
    return '';
  }
}
