import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CONTENT_DIR,
  IMAGE_CONTENTS,
  type ImageContent,
} from '../shared/layout';
import {
  compileDownloadMatcher,
  DEFAULT_FILE_TEMPLATE,
  type DownloadMatcher,
} from '../shared/template';
import type {
  HistoryEntry,
  LibraryFile,
  LibraryResult,
  LibraryWork,
  LibraryWorkFiles,
  LibraryWorkKey,
} from '../shared/types';
import { listHistoryEntries } from './history';
import { parseAuthorFolder } from './pixiv/files';
import { scanNovelLibrary } from './pixiv/novelLibrary';

function normalizeKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** 可直接作为封面/预览的图片扩展名 */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
/** 动图成品可能出现的扩展名：保留压缩包、转码后的视频与 gif */
const UGOIRA_EXTS = new Set(['.zip', '.mp4', '.gif', '.webm']);

function matchersFor(template: string): DownloadMatcher[] {
  const list = [
    compileDownloadMatcher(template),
    compileDownloadMatcher(DEFAULT_FILE_TEMPLATE),
  ];
  return list
    .filter((matcher): matcher is DownloadMatcher => Boolean(matcher))
    .filter(
      (matcher, index, all) =>
        all.findIndex((item) => item.re.source === matcher.re.source) === index
    );
}

interface Accumulator {
  id: string;
  content: ImageContent;
  userId: string;
  userName: string;
  authorPath: string;
  /** 同一页可能同时有常规图与原图（模板含 {quality}），因此按文件而不是按页收集 */
  files: LibraryFile[];
  history: HistoryEntry | null;
  updatedAt: number;
}

function emptyResult(outDir: string, scannedAt: number): LibraryResult {
  return {
    outDir,
    scannedAt,
    works: [],
    novels: [],
    totalFiles: 0,
    totalBytes: 0,
  };
}

/**
 * 扫描保存目录，生成本地图库。
 *
 * 目录结构固定为 `{作者ID}_{作者名}/{illustration|manga|novel}`：
 * 先按作者分，再按内容类型分，与下载时的落盘规则完全一致。
 * 文件名通过当前模板与默认模板解析出作品 ID 与页码；标题等元数据优先取下载历史索引。
 */
export async function scanLibrary(
  outDir: string,
  template: string,
  force = false
): Promise<LibraryResult> {
  const rootDir = path.resolve(outDir);
  const scannedAt = Date.now();
  const matchers = matchersFor(template || DEFAULT_FILE_TEMPLATE);
  if (matchers.length === 0) return emptyResult(rootDir, scannedAt);

  const history = new Map<string, HistoryEntry>();
  (await listHistoryEntries()).forEach((entry) => {
    history.set(normalizeKey(entry.path), entry);
  });

  const works = new Map<string, Accumulator>();
  let totalFiles = 0;
  let totalBytes = 0;

  let authorDirs;
  try {
    authorDirs = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return emptyResult(rootDir, scannedAt);
  }

  for (const authorDir of authorDirs) {
    if (!authorDir.isDirectory()) continue;
    // 只认 {用户ID}_{作者名}：其它目录（比如用户自己放的文件）不参与图库
    const author = parseAuthorFolder(authorDir.name);
    if (!author) continue;
    const authorPath = path.join(rootDir, authorDir.name);

    for (const content of IMAGE_CONTENTS) {
      const contentPath = path.join(authorPath, CONTENT_DIR[content]);
      let files;
      try {
        files = await readdir(contentPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const fileDir of files) {
        if (!fileDir.isFile()) continue;
        const name = fileDir.name;
        if (name.endsWith('.part') || name.startsWith('.')) continue;

        const matched = matchers
          .map((matcher) => {
            const result = matcher.re.exec(name);
            if (!result) return null;
            const id = result[matcher.idGroup];
            const page = Number(result[matcher.pageGroup]) - matcher.pageOffset;
            if (!id || !Number.isFinite(page) || page < 0) return null;
            return { id, page };
          })
          .find(Boolean);
        if (!matched) continue;

        const filePath = path.join(contentPath, name);
        let info;
        try {
          info = await stat(filePath);
        } catch {
          continue;
        }

        const key = `${authorDir.name}\u0000${content}\u0000${matched.id}`;
        const acc =
          works.get(key) ??
          ({
            id: matched.id,
            content,
            userId: author.userId,
            userName: author.userName,
            authorPath,
            files: [],
            history: null,
            updatedAt: 0,
          } as Accumulator);

        acc.files.push({
          page: matched.page,
          path: filePath,
          name,
          bytes: info.size,
          ext: path.extname(name).toLowerCase(),
        });

        const entry = history.get(normalizeKey(filePath));
        if (
          entry &&
          (!acc.history || (entry.page === 0 && acc.history.page !== 0))
        ) {
          acc.history = entry;
        }
        acc.updatedAt = Math.max(
          acc.updatedAt,
          info.mtimeMs || 0,
          entry?.at || 0
        );
        works.set(key, acc);

        totalFiles += 1;
        totalBytes += info.size;
      }
    }
  }

  const list: LibraryWork[] = [];
  works.forEach((acc) => {
    // 同页多份文件时把体积更大的排在前面，原图通常更大
    const files = acc.files
      .slice()
      .sort((a, b) => a.page - b.page || b.bytes - a.bytes);
    if (files.length === 0) return;
    const coverFile = files
      .filter((file) => IMAGE_EXTS.has(file.ext))
      .sort((a, b) => a.page - b.page || b.bytes - a.bytes)[0];
    const historyMeta = acc.history;
    const ugoiraFile = files.find((file) => UGOIRA_EXTS.has(file.ext));
    const ugoira = Boolean(ugoiraFile) || Boolean(historyMeta?.ugoira);
    const pageCount = new Set(files.map((file) => file.page)).size;

    list.push({
      id: acc.id,
      title: historyMeta?.title || `作品 ${acc.id}`,
      userId: historyMeta?.userId || acc.userId,
      userName: historyMeta?.userName || acc.userName,
      content: acc.content,
      authorPath: acc.authorPath,
      pageCount,
      fileCount: files.length,
      imageCount: files.filter((file) => IMAGE_EXTS.has(file.ext)).length,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      updatedAt: acc.updatedAt || scannedAt,
      cover: coverFile ? coverFile.path : '',
      ugoiraPath: ugoiraFile ? ugoiraFile.path : '',
      dir: path.join(acc.authorPath, CONTENT_DIR[acc.content]),
      ugoira,
      hasHistory: Boolean(historyMeta),
    });
  });

  list.sort((a, b) => b.updatedAt - a.updatedAt);

  // 小说与插画共用作者目录，一起返回，图库才能在同一个作者下切三个栏目
  const readable = await scanNovelLibrary(rootDir, force);
  readable.items.forEach((item) => {
    totalFiles += 1;
    totalBytes += item.size;
  });

  return {
    outDir: rootDir,
    scannedAt,
    works: list,
    novels: readable.items,
    totalFiles,
    totalBytes,
  };
}

/** 作者目录必须落在保存目录内，避免渲染层传入任意路径 */
function isInside(rootDir: string, target: string): boolean {
  const relative = path.relative(rootDir, target);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

/**
 * 按需读取作品文件列表。
 *
 * `library:list` 不再下发全部绝对路径；打开预览、动图或删除选中项时，
 * 只读这几个作品所在的内容目录，避免万级文件时整份 structured clone。
 */
export async function readWorkFiles(
  outDir: string,
  template: string,
  keys: LibraryWorkKey[]
): Promise<LibraryWorkFiles[]> {
  const rootDir = path.resolve(outDir);
  const matchers = matchersFor(template || DEFAULT_FILE_TEMPLATE);
  if (matchers.length === 0) return [];

  const results: LibraryWorkFiles[] = [];
  for (const key of keys) {
    const authorPath = path.resolve(String(key.authorPath || ''));
    const content = key.content;
    const empty: LibraryWorkFiles = {
      id: key.id,
      content,
      authorPath,
      files: [],
    };
    if (
      !isInside(rootDir, authorPath) ||
      (key.content !== 'illustration' && key.content !== 'manga')
    ) {
      results.push(empty);
      continue;
    }

    const contentPath = path.join(authorPath, CONTENT_DIR[content]);
    let entries;
    try {
      entries = await readdir(contentPath, { withFileTypes: true });
    } catch {
      results.push(empty);
      continue;
    }

    const files: LibraryFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (name.endsWith('.part') || name.startsWith('.')) continue;

      const matched = matchers
        .map((matcher) => {
          const result = matcher.re.exec(name);
          if (!result) return null;
          const id = result[matcher.idGroup];
          const page = Number(result[matcher.pageGroup]) - matcher.pageOffset;
          if (!id || id !== key.id || !Number.isFinite(page) || page < 0)
            return null;
          return page;
        })
        .find((page): page is number => page !== null);
      if (matched === undefined) continue;

      const filePath = path.join(contentPath, name);
      let info;
      try {
        info = await stat(filePath);
      } catch {
        continue;
      }

      files.push({
        page: matched,
        path: filePath,
        name,
        bytes: info.size,
        ext: path.extname(name).toLowerCase(),
      });
    }

    files.sort((a, b) => a.page - b.page || b.bytes - a.bytes);
    results.push({ id: key.id, content, authorPath, files });
  }
  return results;
}
