/**
 * pixiv 官方 Android 客户端的内置常量。
 *
 * 它们随 APK 一起分发、任何第三方库都能反编译拿到，属于「客户端标识」而不是
 * 用户密钥：不绑定任何账号，也不授予任何单独权限。真正的秘密是用户自己的
 * refresh_token，那个只存在本机 `userData/oauth.json` 里。
 *
 * 所以这里给一份内置默认值，用户不必自己去找；设置里仍可覆盖，
 * 万一 pixiv 轮换或封禁了这组常量，不需要更新代码也能改。
 */
const BUILTIN_CLIENT_ID = 'MOBrBDS8blbauoSck0ZfDbtuzpyT'
const BUILTIN_CLIENT_SECRET = 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj'

export interface AppClient {
  clientId: string
  clientSecret: string
}

/**
 * 解析最终使用的客户端常量：留空用内置值。
 * 两者要么都用内置、要么都由用户覆盖——只填一个必然是填错了，
 * 混用会让 refresh_token 对不上 client。
 */
export function resolveAppClient(clientId?: string, clientSecret?: string): AppClient {
  const id = (clientId || '').trim()
  const secret = (clientSecret || '').trim()
  if (id && !secret) throw new Error('填写了 client_id 就必须同时填写 client_secret')
  if (!id && secret) throw new Error('填写了 client_secret 就必须同时填写 client_id')
  return {
    clientId: id || BUILTIN_CLIENT_ID,
    clientSecret: secret || BUILTIN_CLIENT_SECRET
  }
}
