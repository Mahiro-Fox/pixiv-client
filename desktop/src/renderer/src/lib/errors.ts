/**
 * 剥掉 Electron IPC 自动加的错误前缀，只留真正的原因。
 *
 * `ipcRenderer.invoke` 抛出来的 message 形如
 * `Error invoking remote method 'pixiv:search': Error: 请求超时`，
 * 直接贴到界面上既长又没信息量，统一在这里裁一刀。
 */
export function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
