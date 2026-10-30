import { RotateCcw, Sparkles } from 'lucide-react'
import type * as React from 'react'
import type { UpdateStatus } from '@shared/types'
import { useI18n } from '@renderer/i18n'
import { toast } from '@renderer/lib/toast'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

/**
 * 自动更新弹窗。
 *
 * 新版本已经在后台下载完了才走到这里，所以不再展示安装包体积、也不再画进度条——
 * 只问一件事：现在重启装上，还是先放一放。选「取消」就是真的不装（退出程序也不装），
 * 安装包留在缓存里，下次启动会再问一次，不会重新下载。
 */
export function UpdateDialog(props: {
  status: UpdateStatus
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const { status } = props

  if (status.state !== 'downloaded') return null

  const restart = async (): Promise<void> => {
    // 恢复自上次启动的「已就绪」需要主进程补一次校验，失败时别静悄悄没反应
    const ok = await window.pixiv.installUpdate()
    if (!ok) toast.error(t('update.installFailed'))
  }

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
            {t('update.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void restart()
            }}
          >
            <RotateCcw />
            {t('update.restart')}
          </Button>
        </>
      }
    >
      <p className="text-xs text-muted-foreground">{t('update.laterHint')}</p>
    </Dialog>
  )
}
