import type { PixivWork, SearchWork, UserWorkThumb } from '@shared/types'

/** SearchWork / 用户列表的缩略图都能转成详情弹窗需要的 PixivWork */
export function toPixivWork(work: SearchWork | UserWorkThumb): PixivWork {
  if ('thumbnail' in work) {
    return {
      id: work.id,
      title: work.title,
      userId: work.userId,
      userName: work.userName,
      url: work.thumbnail,
      pageCount: work.pageCount,
      width: work.width,
      height: work.height,
      xRestrict: work.xRestrict,
      illustType: work.illustType,
      tags: work.tags,
      createDate: work.createDate,
      aiType: work.aiType,
      series: work.series
    }
  }
  return {
    id: work.id,
    title: `ID ${work.id}`,
    userId: '',
    userName: '',
    url: work.url,
    pageCount: 1,
    width: 0,
    height: 0
  }
}
