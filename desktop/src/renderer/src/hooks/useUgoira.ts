import { useEffect, useRef, useState } from 'react'
import type { UgoiraFrames } from '@shared/types'
import { messageOf } from '../utils/errors'
import { toast } from '../utils/toast'

/**
 * 动图帧的来源。
 * 线上作品按 id 取（主进程负责下载 zip 并解压），本地图库按文件路径取。
 */
export type UgoiraSource =
  | { kind: 'remote'; id: string }
  | { kind: 'local'; path: string; id?: string }

/** 播放器要的一帧：已经是能直接塞进 <img> 的地址 */
export interface UgoiraFrameView {
  src: string
  delay: number
}

/** 来源的内容签名：对象字面量每次渲染都是新引用，只能按内容判断是否换了作品 */
function keyOf(source: UgoiraSource): string {
  return source.kind === 'remote'
    ? `remote:${source.id}`
    : `local:${source.path}:${source.id || ''}`
}

function loadFrames(source: UgoiraSource): Promise<UgoiraFrames> {
  return source.kind === 'remote'
    ? window.pixiv.getUgoiraFrames(source.id)
    : window.pixiv.readLocalUgoiraFrames(source.path, source.id)
}

/**
 * 取回动图帧并转成 blob URL。
 *
 * 帧数据在渲染层只有一个宿主（这些 blob URL），所以生命周期必须自己管：
 * 换作品、关掉预览都要 revoke，否则几十张全尺寸图会一直挂在内存里。
 */
export function useUgoiraFrames(source: UgoiraSource | null): {
  frames: UgoiraFrameView[]
  loading: boolean
  error: string
} {
  const [frames, setFrames] = useState<UgoiraFrameView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 只在 key 变化时重新取数，effect 内部通过 ref 拿最新的 source
  const sourceRef = useRef(source)
  sourceRef.current = source
  const key = source ? keyOf(source) : ''

  useEffect(() => {
    const current = sourceRef.current
    if (!current) {
      setFrames([])
      setLoading(false)
      setError('')
      return
    }

    let alive = true
    const urls: string[] = []
    setFrames([])
    setLoading(true)
    setError('')

    void loadFrames(current)
      .then((payload) => {
        if (!alive) return
        const views = payload.frames.map((frame) => {
          const url = URL.createObjectURL(
            new Blob([frame.data as unknown as BlobPart], { type: frame.mime })
          )
          urls.push(url)
          return { src: url, delay: Math.max(20, frame.delay) }
        })
        setFrames(views)
      })
      .catch((reason: unknown) => {
        if (!alive) return
        // 取帧失败就用缩略图兜底，原因交给轻提示，不在弹窗里再堆一行红字
        setError(messageOf(reason))
        toast.error(messageOf(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.length = 0
    }
  }, [key])

  return { frames, loading, error }
}
