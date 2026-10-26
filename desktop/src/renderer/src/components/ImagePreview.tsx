import {
  ChevronLeft,
  ChevronRight,
  FlipHorizontal,
  FlipVertical,
  Loader2,
  Maximize2,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { createPortal } from 'react-dom'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type * as React from 'react'

/* -------------------------------- 常量 / 类型 -------------------------------- */

const MIN_SCALE = 0.1
const MAX_SCALE = 10
const ZOOM_STEP = 1.25
const CLICK_SLOP = 6 // 判定为「点击」的最大移动距离(px)

interface Point {
  x: number
  y: number
}

interface ViewState {
  x: number
  y: number
  scale: number
  rotate: number
  flipX: boolean
  flipY: boolean
}

const DEFAULT_VIEW: ViewState = {
  x: 0,
  y: 0,
  scale: 1,
  rotate: 0,
  flipX: false,
  flipY: false
}

type Gesture =
  | { type: 'pan'; startX: number; startY: number; startTx: number; startTy: number }
  | {
      type: 'pinch'
      startDist: number
      startScale: number
      startTx: number
      startTy: number
      startMid: Point
    }

export interface PreviewImage {
  src: string
  alt: string
  width?: number
  height?: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/* --------------------------------- Context -------------------------------- */

interface PreviewContextValue {
  /** 打开预览：可传单张或数组，index 为初始下标 */
  open: (images: PreviewImage[], index?: number) => void
  close: () => void
  isOpen: boolean
}

const PreviewContext = createContext<PreviewContextValue | null>(null)

export function useImagePreview(): PreviewContextValue {
  const context = useContext(PreviewContext)
  if (!context) throw new Error('useImagePreview 必须在 <ImagePreviewProvider> 内使用')
  return context
}

/* -------------------------------- Provider -------------------------------- */

export function ImagePreviewProvider({ children }: { children?: ReactNode }): React.JSX.Element {
  const [images, setImages] = useState<PreviewImage[]>([])
  const [index, setIndex] = useState(0)
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback((next: PreviewImage[], start?: number) => {
    if (next.length === 0) return
    setImages(next)
    setIndex(start || 0)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo<PreviewContextValue>(
    () => ({ open, close, isOpen }),
    [open, close, isOpen]
  )

  return (
    <PreviewContext.Provider value={value}>
      {children}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <PreviewOverlay
              images={images}
              index={index}
              onIndexChange={setIndex}
              onClose={close}
            />,
            document.body
          )
        : null}
    </PreviewContext.Provider>
  )
}

/* -------------------------------- Overlay -------------------------------- */

interface PreviewOverlayProps {
  images: PreviewImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

function PreviewOverlay({
  images,
  index,
  onIndexChange,
  onClose
}: PreviewOverlayProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [view, setView] = useState<ViewState>(DEFAULT_VIEW)
  const viewRef = useRef<ViewState>(DEFAULT_VIEW)

  const [animate, setAnimate] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)

  const pointersRef = useRef<Map<number, Point>>(new Map())
  const gestureRef = useRef<Gesture | null>(null)
  const movedRef = useRef(0)
  const lastPointRef = useRef<Point | null>(null)
  const downTargetRef = useRef<Element | null>(null)

  // 给原生事件监听器提供最新数据
  const latestRef = useRef({ images, index, onIndexChange, onClose })
  useEffect(() => {
    latestRef.current = { images, index, onIndexChange, onClose }
  }, [images, index, onIndexChange, onClose])

  /* ------------------------------ 视图更新工具 ------------------------------ */

  const patchView = useCallback(
    (patch: Partial<ViewState> | ((value: ViewState) => Partial<ViewState>)) => {
      const prev = viewRef.current
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
      viewRef.current = next
      setView(next)
    },
    []
  )

  /** 以 anchor(相对容器中心的坐标) 为锚点缩放到 targetScale */
  const applyZoom = useCallback(
    (targetScale: number, anchor: Point = { x: 0, y: 0 }) => {
      const prev = viewRef.current
      const scale = clamp(targetScale, MIN_SCALE, MAX_SCALE)
      if (Math.abs(scale - prev.scale) < 1e-4) return
      const ratio = scale / prev.scale
      patchView({
        scale,
        x: anchor.x - ratio * (anchor.x - prev.x),
        y: anchor.y - ratio * (anchor.y - prev.y)
      })
    },
    [patchView]
  )

  const resetView = useCallback(() => {
    viewRef.current = DEFAULT_VIEW
    setView(DEFAULT_VIEW)
    setAnimate(true)
  }, [])

  /* ------------------------------ 副作用：切图 / 键盘 / 滚动锁 ------------------------------ */

  useEffect(() => {
    viewRef.current = DEFAULT_VIEW
    setView(DEFAULT_VIEW)
    setLoaded(false)
    setAnimate(false)
  }, [index])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const {
        images: list,
        index: current,
        onIndexChange: change,
        onClose: close
      } = latestRef.current

      switch (event.key) {
        case 'Escape':
          close()
          break
        case 'ArrowLeft':
          if (list.length > 1) change((current - 1 + list.length) % list.length)
          break
        case 'ArrowRight':
          if (list.length > 1) change((current + 1) % list.length)
          break
        case '+':
        case '=':
          setAnimate(true)
          applyZoom(viewRef.current.scale * ZOOM_STEP)
          break
        case '-':
        case '_':
          setAnimate(true)
          applyZoom(viewRef.current.scale / ZOOM_STEP)
          break
        case '0':
          resetView()
          break
        default:
          return
      }
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [applyZoom, resetView])

  /* ------------------------------ 手势（原生监听） ------------------------------ */

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const getCenter = (): Point => {
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return

      const pointers = pointersRef.current
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (pointers.size === 1) {
        downTargetRef.current = event.target as Element
        movedRef.current = 0
        lastPointRef.current = { x: event.clientX, y: event.clientY }
        gestureRef.current = {
          type: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          startTx: viewRef.current.x,
          startTy: viewRef.current.y
        }
        setAnimate(false)
        setDragging(true)
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const center = getCenter()
        gestureRef.current = {
          type: 'pinch',
          startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          startScale: viewRef.current.scale,
          startTx: viewRef.current.x,
          startTy: viewRef.current.y,
          startMid: {
            x: (a.x + b.x) / 2 - center.x,
            y: (a.y + b.y) / 2 - center.y
          }
        }
        setAnimate(false)
        setDragging(true)
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const pointers = pointersRef.current
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (lastPointRef.current) {
        movedRef.current += Math.hypot(
          event.clientX - lastPointRef.current.x,
          event.clientY - lastPointRef.current.y
        )
      }
      lastPointRef.current = { x: event.clientX, y: event.clientY }

      const gesture = gestureRef.current
      if (!gesture) return

      if (gesture.type === 'pan' && pointers.size === 1) {
        patchView({
          x: gesture.startTx + (event.clientX - gesture.startX),
          y: gesture.startTy + (event.clientY - gesture.startY)
        })
        return
      }

      if (gesture.type === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const center = getCenter()
        const mid = {
          x: (a.x + b.x) / 2 - center.x,
          y: (a.y + b.y) / 2 - center.y
        }
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        const scale = clamp((gesture.startScale * dist) / gesture.startDist, MIN_SCALE, MAX_SCALE)
        const ratio = scale / gesture.startScale
        patchView({
          scale,
          x: mid.x - ratio * (gesture.startMid.x - gesture.startTx),
          y: mid.y - ratio * (gesture.startMid.y - gesture.startTy)
        })
      }
    }

    const onPointerUp = (event: PointerEvent): void => {
      const pointers = pointersRef.current
      if (!pointers.has(event.pointerId)) return
      pointers.delete(event.pointerId)

      if (pointers.size === 0) {
        gestureRef.current = null
        lastPointRef.current = null
        setDragging(false)

        const target = downTargetRef.current
        const isBlank = !target?.closest('[data-preview-image], [data-preview-ui]')
        if (isBlank && movedRef.current < CLICK_SLOP) latestRef.current.onClose()
        return
      }

      // 双指松开一根 → 回到单指拖拽
      if (pointers.size === 1) {
        const point = [...pointers.values()][0]
        gestureRef.current = {
          type: 'pan',
          startX: point.x,
          startY: point.y,
          startTx: viewRef.current.x,
          startTy: viewRef.current.y
        }
        lastPointRef.current = point
      }
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const center = getCenter()
      const anchor = { x: event.clientX - center.x, y: event.clientY - center.y }

      const rawDelta =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * 100
            : event.deltaY
      // 触控板捏合通常带 ctrlKey，给一个更灵敏的系数
      const intensity = event.ctrlKey ? 0.01 : 0.002
      const factor = Math.exp(-rawDelta * intensity)

      setAnimate(false)
      applyZoom(viewRef.current.scale * factor, anchor)
    }

    element.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    element.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      element.removeEventListener('wheel', onWheel)
    }
  }, [applyZoom, patchView])

  /* --------------------------------- 操作 --------------------------------- */

  const zoomIn = (): void => {
    setAnimate(true)
    applyZoom(viewRef.current.scale * ZOOM_STEP)
  }

  const zoomOut = (): void => {
    setAnimate(true)
    applyZoom(viewRef.current.scale / ZOOM_STEP)
  }

  const rotate = (): void => {
    setAnimate(true)
    patchView((value) => ({ rotate: value.rotate + 90 }))
  }

  const toggleFlipX = (): void => patchView((value) => ({ flipX: !value.flipX }))
  const toggleFlipY = (): void => patchView((value) => ({ flipY: !value.flipY }))

  const goTo = (target: number): void => {
    const total = latestRef.current.images.length
    if (total <= 1) return
    latestRef.current.onIndexChange(((target % total) + total) % total)
  }

  /* --------------------------------- 渲染 --------------------------------- */

  const current = images[index]

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      className="fixed inset-0 z-[9999] select-none overflow-hidden bg-black/90 backdrop-blur-sm"
      style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 pb-28 pt-16">
        {current ? (
          <img
            key={current.src}
            src={current.src}
            alt={current.alt}
            draggable={false}
            data-preview-image
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className="pointer-events-auto max-h-full max-w-full object-contain will-change-transform"
            style={{
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale}) rotate(${
                view.rotate
              }deg) scaleX(${view.flipX ? -1 : 1}) scaleY(${view.flipY ? -1 : 1})`,
              transition: animate ? 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
              opacity: loaded ? 1 : 0
            }}
          />
        ) : null}
      </div>

      {!loaded ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
        </div>
      ) : null}

      {images.length > 1 ? (
        <div
          data-preview-ui
          className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium tabular-nums text-white/80 backdrop-blur"
        >
          {index + 1} / {images.length}
        </div>
      ) : null}

      <button
        type="button"
        data-preview-ui
        onClick={onClose}
        aria-label="关闭"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur transition-colors hover:bg-white/15 hover:text-white"
      >
        <X size={20} />
      </button>

      {images.length > 1 ? (
        <>
          <NavButton side="left" onClick={() => goTo(index - 1)} />
          <NavButton side="right" onClick={() => goTo(index + 1)} />
        </>
      ) : null}

      <div
        data-preview-ui
        className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/60 px-2 py-2 text-white shadow-2xl backdrop-blur-md"
      >
        <ToolButton label="缩小" onClick={zoomOut}>
          <ZoomOut size={18} />
        </ToolButton>

        <button
          type="button"
          onClick={resetView}
          title="重置视图"
          aria-label="重置视图"
          className="min-w-[58px] rounded-full px-2 py-1.5 text-xs font-medium tabular-nums text-white/80 transition-colors hover:bg-white/15 hover:text-white"
        >
          {Math.round(view.scale * 100)}%
        </button>

        <ToolButton label="放大" onClick={zoomIn}>
          <ZoomIn size={18} />
        </ToolButton>

        <Divider />

        <ToolButton label="顺时针旋转 90°" onClick={rotate}>
          <RotateCw size={18} />
        </ToolButton>
        <ToolButton label="水平翻转" onClick={toggleFlipX} active={view.flipX}>
          <FlipHorizontal size={18} />
        </ToolButton>
        <ToolButton label="垂直翻转" onClick={toggleFlipY} active={view.flipY}>
          <FlipVertical size={18} />
        </ToolButton>
        <ToolButton label="适应屏幕" onClick={resetView}>
          <Maximize2 size={18} />
        </ToolButton>

        <Divider />

        <ToolButton label="关闭" onClick={onClose}>
          <X size={18} />
        </ToolButton>
      </div>
    </div>
  )
}

/* -------------------------------- 小组件 -------------------------------- */

function ToolButton(props: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        props.active ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/15 hover:text-white'
      }`}
    >
      {props.children}
    </button>
  )
}

function Divider(): React.JSX.Element {
  return <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
}

function NavButton(props: {
  side: 'left' | 'right'
  onClick: () => void
}): React.JSX.Element {
  const isLeft = props.side === 'left'
  return (
    <button
      type="button"
      data-preview-ui
      onClick={props.onClick}
      aria-label={isLeft ? '上一张' : '下一张'}
      className={`absolute top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur transition-colors hover:bg-white/15 hover:text-white ${
        isLeft ? 'left-4' : 'right-4'
      }`}
    >
      {isLeft ? <ChevronLeft size={26} /> : <ChevronRight size={26} />}
    </button>
  )
}
