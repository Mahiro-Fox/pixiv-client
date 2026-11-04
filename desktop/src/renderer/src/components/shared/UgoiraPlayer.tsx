import { Loader2, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { useI18n } from '@renderer/i18n'
import type { UgoiraFrameView } from '@renderer/hooks/useUgoira'

interface UgoiraPlayerProps {
  /** 已按播放顺序排好的帧（blob 地址 + 每帧时长） */
  frames: UgoiraFrameView[]
  /**
   * inline：作品详情里的播放器，带播放/暂停与帧计数；
   * stage：全屏预览里只出图，缩放 / 旋转由外层手势层套在容器上。
   */
  variant?: 'inline' | 'stage'
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}

/**
 * 动图播放器：按时长逐帧切图，不转码。
 *
 * 之所以不用 gif / video：pixiv 的动图本来就是一组完整质量的帧，
 * 转码只是把画质变差、把等待变长；这里直接按 pixiv 给的 delay 播，
 * 变帧节奏（有的帧停 300ms）也能原样还原。
 */
export function UgoiraPlayer(props: UgoiraPlayerProps): React.JSX.Element {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const { frames, variant = 'inline' } = props

  const [index, setIndex] = useState(0)
  /** 帧要全部解码完再开播，否则第一圈会一顿一顿地闪 */
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(!reduce)

  // 换了一组帧（切作品）时重新预加载，并回到第一帧
  const framesRef = useRef(frames)
  framesRef.current = frames
  const signature = frames.map((frame) => frame.src).join('|')
  useEffect(() => {
    const list = framesRef.current
    if (list.length === 0) return
    let alive = true
    setReady(false)
    setIndex(0)
    void Promise.all(
      list.map(
        (frame) =>
          new Promise<void>((resolve) => {
            const image = new Image()
            image.onload = () => resolve()
            image.onerror = () => resolve()
            image.src = frame.src
          })
      )
    ).then(() => {
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [signature])

  useEffect(() => {
    if (!ready || !playing || frames.length < 2) return
    const delay = frames[Math.min(index, frames.length - 1)]?.delay ?? 100
    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % frames.length),
      delay
    )
    return () => window.clearTimeout(timer)
  }, [ready, playing, index, frames])

  const current = frames[Math.min(index, frames.length - 1)]

  if (!current) {
    return (
      <div className="flex h-42 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('preview.ugoiraLoading')}
      </div>
    )
  }

  if (variant === 'stage') {
    return (
      <img
        src={current.src}
        alt=""
        draggable={false}
        data-preview-image
        onClick={props.onClick}
        style={props.style}
        className={props.className}
      />
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={props.onClick}
        className="cursor-zoom-in rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        title={t('library.previewInApp')}
      >
        <img
          src={current.src}
          alt=""
          draggable={false}
          className="max-h-[62vh] max-w-full rounded-lg object-contain"
        />
      </button>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? t('preview.ugoiraPause') : t('preview.ugoiraPlay')}
          title={playing ? t('preview.ugoiraPause') : t('preview.ugoiraPlay')}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-border/60 transition-colors hover:border-primary/50 hover:text-primary"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span className="tabular-nums">
          {index + 1} / {frames.length}
        </span>
        {ready ? null : (
          <span className="flex items-center gap-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('preview.ugoiraLoading')}
          </span>
        )}
      </div>
    </div>
  )
}
