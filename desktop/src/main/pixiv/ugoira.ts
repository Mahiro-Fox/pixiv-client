import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import ffmpegStatic from 'ffmpeg-static'
import type { UgoiraFormat, UgoiraFrame } from '../../shared/types'

/** 动图可转码的目标格式 */
export type UgoiraTarget = Exclude<UgoiraFormat, 'zip'>

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])

let cachedFfmpeg: string | null | undefined

/** asar 打包后路径是 app.asar/…，可执行文件必须落在 app.asar.unpacked 才能启动 */
function unpackedPath(bin: string): string {
  return bin.includes(`app.asar${path.sep}`) || bin.includes('app.asar/')
    ? bin.replace('app.asar', 'app.asar.unpacked')
    : bin
}

/** 依次尝试：环境变量 FFMPEG_PATH → 随包安装的 ffmpeg，都没有时返回 null */
export function resolveFfmpegPath(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg
  const fromEnv = (process.env.FFMPEG_PATH || '').trim()
  if (fromEnv && existsSync(fromEnv)) {
    cachedFfmpeg = fromEnv
    return cachedFfmpeg
  }
  const bundled = typeof ffmpegStatic === 'string' ? unpackedPath(ffmpegStatic) : ''
  cachedFfmpeg = bundled && existsSync(bundled) ? bundled : null
  return cachedFfmpeg
}

export function isFfmpegAvailable(): boolean {
  return Boolean(resolveFfmpegPath())
}

/** 递归列出解压目录里的图片文件（相对路径） */
async function listImages(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const parent = (entry as unknown as { parentPath?: string }).parentPath || dir
      return path.relative(dir, path.join(parent, entry.name)).split(path.sep).join('/')
    })
}

/**
 * 按接口返回的 frames 顺序排列帧；个别帧文件名对不上时，
 * 把剩余图片按名称顺序补到末尾，避免整段转码失败。
 */
function orderFrames(files: string[], frames: UgoiraFrame[]): { file: string; delay: number }[] {
  const byName = new Map(files.map((file) => [file.toLowerCase(), file]))
  const used = new Set<string>()
  const ordered: { file: string; delay: number }[] = []

  frames.forEach((frame) => {
    const key = frame.file.split('/').join('/').toLowerCase()
    const matched =
      byName.get(key) ||
      byName.get(path.posix.basename(key)) ||
      files.find((file) => path.posix.basename(file).toLowerCase() === path.posix.basename(key))
    if (!matched || used.has(matched)) return
    used.add(matched)
    ordered.push({ file: matched, delay: frame.delay })
  })

  if (ordered.length === 0) {
    return files
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((file) => ({ file, delay: 100 }))
  }

  // 帧信息不全时用最后一帧的时长补齐剩余图片
  const fallbackDelay = ordered[ordered.length - 1].delay
  files
    .filter((file) => !used.has(file))
    .sort((a, b) => a.localeCompare(b))
    .forEach((file) => ordered.push({ file, delay: fallbackDelay }))

  return ordered
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''")
}

/**
 * 帧时长的最小单位（毫秒）。pixiv 的 delay 基本都是 10 的整数倍，
 * 这个值也正好是 gif 的 1/100 秒精度。
 */
const FRAME_MS = 10

/**
 * 生成 concat demuxer 清单。
 * image2 读图流的默认时间基是 1/25，直接在 duration 里写毫秒会被量化成 40ms 的倍数，
 * 短帧会全部变成 40ms。改成按 delay 把同一帧重复若干份、再用 `-r 100` 读入，
 * 每份正好占 10ms，短帧时长不再被吞掉；gif 的每帧延迟也随之精确到 1/100 秒。
 */
function buildConcatList(frames: { file: string; delay: number }[], dir: string): string {
  const lines: string[] = []
  // 这个 ffmpeg 版本按进程工作目录解析相对路径，必须写绝对路径
  const absolute = (file: string): string => path.resolve(dir, file).replace(/\\/g, '/')
  frames.forEach((frame) => {
    const repeats = Math.max(1, Math.round(frame.delay / FRAME_MS))
    for (let index = 0; index < repeats; index += 1) {
      lines.push(`file '${escapeConcatPath(absolute(frame.file))}'`)
    }
  })
  return `${lines.join('\n')}\n`
}

function convertArgs(format: UgoiraTarget, listPath: string, output: string): string[] {
  const base = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    // 清单里每行一帧，按 100fps 读入即每帧 10ms
    '-r',
    String(1000 / FRAME_MS),
    '-i',
    listPath
  ]

  if (format === 'mp4') {
    return [
      ...base,
      // yuv420p 要求宽高为偶数，奇数尺寸时裁掉 1px
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      // 毫秒级时间基，避免 muxer 再把 10ms 量化
      '-video_track_timescale',
      '1000',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      output
    ]
  }

  return [
    ...base,
    '-filter_complex',
    '[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse',
    '-f',
    'gif',
    output
  ]
}

function runFfmpeg(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: 180_000 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve()
          return
        }
        const detail = String(stderr || error.message || '').trim().split('\n').slice(-3).join(' ')
        reject(new Error(`ffmpeg 转码失败：${detail || error.message}`))
      }
    )
    if (signal) {
      const onAbort = (): void => {
        child.kill()
      }
      if (signal.aborted) child.kill()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export interface ConvertUgoiraOptions {
  zipPath: string
  /** 最终落盘路径（扩展名已按目标格式生成） */
  destPath: string
  frames: UgoiraFrame[]
  format: UgoiraTarget
  signal?: AbortSignal
}

/**
 * 解压动图 zip 并用 ffmpeg 转成 mp4 / gif。
 * 先输出到同目录临时文件再原子重命名，失败不会留下半成品。
 */
export async function convertUgoira(options: ConvertUgoiraOptions): Promise<void> {
  const bin = resolveFfmpegPath()
  if (!bin) throw new Error('未找到 ffmpeg，请在设置中把动图格式改为「保留压缩包」')

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pixiv-ugoira-'))
  const output = path.join(
    path.dirname(options.destPath),
    `.ugoira-${randomUUID().slice(0, 8)}.${options.format}`
  )

  try {
    new AdmZip(options.zipPath).extractAllTo(tempDir, true)
    const files = await listImages(tempDir)
    if (files.length === 0) throw new Error('压缩包里没有可用帧图片')

    const ordered = orderFrames(files, options.frames)
    const listPath = path.join(tempDir, 'frames.txt')
    await writeFile(listPath, buildConcatList(ordered, tempDir), 'utf-8')

    // 这个 ffmpeg 版本会把清单路径的目录前缀拼到相对帧路径上；
    // 传原生路径时 dirname 只有 "."，再配绝对帧路径即可稳定命中文件
    const args = convertArgs(options.format, listPath, output)
    await runFfmpeg(bin, args, options.signal)

    const info = await stat(output)
    if (!info.isFile() || info.size <= 0) throw new Error('转码产物为空')
    await rename(output, options.destPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    await rm(output, { force: true }).catch(() => undefined)
  }
}
