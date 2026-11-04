/**
 * 本地库的目录结构，落盘与扫描共用同一份定义：
 *
 * ```
 * {保存目录}/{作者ID}_{作者名}/illustration/*.jpg
 * {保存目录}/{作者ID}_{作者名}/manga/*.jpg
 * {保存目录}/{作者ID}_{作者名}/novel/*.txt
 * ```
 *
 * 抓取条件（标签、收藏夹）不参与目录命名：同一位作者的作品始终落在同一个作者目录里，
 * 换标签、换栏目下载都不会再多出一层目录。
 */
export const CONTENT_DIR = {
  illustration: 'illustration',
  manga: 'manga',
  novel: 'novel',
} as const;

/** 图片作品的两类内容（小说走单独的 TXT 流程） */
export type ImageContent = 'illustration' | 'manga';

/** 本地库的三类内容 */
export type LocalContent = keyof typeof CONTENT_DIR;

/** 扫描时遍历的图片目录，顺序即界面栏目的顺序 */
export const IMAGE_CONTENTS: ImageContent[] = ['illustration', 'manga'];

/** pixiv illustType：0 插画、1 漫画、2 动图（动图与插画同属 illustration） */
export function imageContentOfIllustType(value: unknown): ImageContent {
  return Number(value) === 1 ? 'manga' : 'illustration';
}
