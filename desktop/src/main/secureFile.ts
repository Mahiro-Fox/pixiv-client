import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 本地凭据文件的读写层。
 *
 * Cookie、OAuth token 都是敏感信息，不能以明文落盘：有系统密钥时走
 * `safeStorage` 加密，未启用时退化为明文（仅限当前用户目录），至少保证可用。
 * 旧版本写下的明文文件会在读取时自动改写成加密格式，只需迁移一次。
 */

interface SecureText {
  text: string
  /** true 表示内容来自解密，false 表示按明文读出来的 */
  encrypted: boolean
}

function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** 解密失败时用来判断是不是旧版本明文：合法 UTF-8、无替换字符、可原样还原 */
function isPlainText(buffer: Buffer): boolean {
  const text = buffer.toString('utf-8')
  if (text.includes('\uFFFD')) return false
  return Buffer.from(text, 'utf-8').equals(buffer)
}

/**
 * 读文件：不存在返回 null；可加密时先解密，失败则按 UTF-8 明文返回；
 * 读到旧明文时顺手重写成加密文件（失败不阻塞读取）。
 */
export async function readSecureText(filePath: string): Promise<SecureText | null> {
  let raw: Buffer
  try {
    raw = await readFile(filePath)
  } catch {
    return null
  }

  if (encryptionAvailable()) {
    try {
      return { text: safeStorage.decryptString(raw), encrypted: true }
    } catch {
      // 旧版本明文，或换机后系统密钥变化解不开，都按明文继续
    }
  }

  const text = raw.toString('utf-8')
  if (encryptionAvailable() && text && isPlainText(raw)) {
    await writeSecureText(filePath, text).catch(() => undefined)
  }
  return { text, encrypted: false }
}

/** 写文件：可加密时写加密 Buffer，否则写 UTF-8 明文；目录不存在时自动创建 */
export async function writeSecureText(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const data = encryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf-8')
  await writeFile(filePath, data)
}
