import type { PixivApi } from '../shared/types'

declare global {
  interface Window {
    pixiv: PixivApi
  }
}

export {}
