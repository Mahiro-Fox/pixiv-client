import { Construction } from 'lucide-react'
import type * as React from 'react'
import { useI18n } from '@renderer/i18n'
import type { MessageKey } from '@renderer/i18n'

/** 预备路由占位页：先占住入口，同时说明后续会接入哪些能力 */
export function PlaceholderPage(props: {
  titleKey: MessageKey
  /** 一句话说明这个页面未来是什么 */
  descKey?: MessageKey
  /** 后续计划接入的能力清单 */
  points?: MessageKey[]
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-muted-foreground">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-secondary/30 text-muted-foreground/70">
        <Construction className="h-7 w-7" />
      </span>
      <h2 className="text-base font-semibold text-foreground">{t(props.titleKey)}</h2>
      {props.descKey ? (
        <p className="max-w-md text-center text-xs leading-5">{t(props.descKey)}</p>
      ) : null}

      {props.points && props.points.length > 0 ? (
        <div className="mt-2 w-full max-w-md rounded-xl border border-border/60 bg-card/40 p-3">
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            {t('placeholder.plan')}
          </p>
          <ul className="space-y-1.5">
            {props.points.map((key) => (
              <li key={key} className="flex items-start gap-2 text-[11px] leading-4">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground/70">{t('placeholder.soon')}</p>
    </main>
  )
}
