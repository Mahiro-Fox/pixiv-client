import { Download, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import type * as React from 'react'
import type { UpdateStatus } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { formatBytes } from '@renderer/lib/utils'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Progress } from './ui/progress'

/**
 * 自动更新弹窗。
 * 主进程只负责检查与广播状态，是否下载、是否立刻重启都由这个弹窗决定：
 * 安装包体积不小，先让用户看到版本号与流量再点「更新」。
 */
export function UpdateDialog(props: {
  status: UpdateStatus
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const { status } = props

  if (status.state === 'available') {
    return (
      <Dialog
        title={t('update.title', { version: status.version })}
        description={t('update.hint')}
        icon={<Sparkles className="h-4 w-4 text-primary" />}
        onClose={props.onClose}
        className="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t('update.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void window.pixiv.downloadUpdate()
              }}
            >
              <Download />
              {t('update.update')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">
          {t('update.size', { size: formatBytes(status.size) })}
        </p>
      </Dialog>
    )
  }

  if (status.state === 'downloading') {
    return (
      <Dialog
        title={t('update.title', { version: status.version })}
        icon={<Loader2 className="h-4 w-4 animate-spin text-primary" />}
        onClose={props.onClose}
        className="max-w-md"
        footer={
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            {t('update.background')}
          </Button>
        }
      >
        <div className="space-y-2">
          <Progress value={status.percent} />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {t('update.downloading', {
                percent: status.percent,
                transferred: formatBytes(status.transferred),
                total: formatBytes(status.total)
              })}
            </span>
            {status.bytesPerSecond > 0 ? (
              <span className="tabular-nums">
                {t('update.speed', { speed: formatBytes(status.bytesPerSecond) })}
              </span>
            ) : null}
          </div>
        </div>
      </Dialog>
    )
  }

  if (status.state === 'downloaded') {
    return (
      <Dialog
        title={t('update.readyTitle', { version: status.version })}
        description={t('update.readyHint')}
        icon={<Sparkles className="h-4 w-4 text-primary" />}
        onClose={props.onClose}
        className="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t('update.later')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void window.pixiv.installUpdate()
              }}
            >
              <RotateCcw />
              {t('update.restart')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">{t('update.readyHint')}</p>
      </Dialog>
    )
  }

  if (status.state === 'error') {
    return (
      <Dialog
        title={t('update.failedTitle')}
        description={status.message}
        onClose={props.onClose}
        className="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              {t('update.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void window.pixiv.checkForUpdates()
              }}
            >
              {t('update.retry')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">{t('update.hint')}</p>
      </Dialog>
    )
  }

  return null
}
