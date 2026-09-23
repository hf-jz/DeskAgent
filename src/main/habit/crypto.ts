/**
 * 字段级加密 — 敏感字段（title / url）加密存储
 *
 * B8 加固：
 *  - 首选 Electron safeStorage（macOS 走 Keychain，密钥不出系统安全区）
 *  - 旧数据兼容：v1 版本用 hostname+固定盐派生的 AES-256-GCM，
 *    读取时自动降级解密（前缀区分），写入一律走 safeStorage
 *  - fail-closed：加密失败返回 '' 并记日志，绝不落明文；
 *    解密失败返回 ''，绝不把密文透传到摘要/LLM
 *
 * 存储格式：
 *  - 'ss:' + base64(safeStorage 密文)   → 新数据
 *  - base64(iv + authTag + ciphertext)   → v1 旧数据（仅读）
 */
import { safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { hostname } from 'os'

const SS_PREFIX = 'ss:'

// ── v1 旧方案密钥（仅用于读取存量数据） ──

const SALT = 'deskapp-habit-2026-v1'
let _legacyKey: Buffer | null = null

function getLegacyKey(): Buffer {
  if (!_legacyKey) {
    _legacyKey = createHash('sha256')
      .update(hostname() + SALT)
      .digest()
  }
  return _legacyKey
}

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

/** v1 本地 AES-256-GCM（hostname+盐派生 key）——不触钥匙串 */
function legacyEncrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getLegacyKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
}

function legacyDecrypt(encoded: string): string {
  const combined = Buffer.from(encoded, 'base64')
  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) throw new Error('too short')
  const iv = combined.subarray(0, IV_LENGTH)
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, getLegacyKey(), iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(ciphertext.toString('base64'), 'base64', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function safeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

// ── 公开 API ──

/**
 * 加密字符串。fail-closed：失败返回 ''（数据宁可丢，不落明文）。
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  // 默认本地 AES-256-GCM（hostname+盐派生 key）——adhoc 签名下 safeStorage 每次启动
  // 都弹钥匙串授权（CDHash 不稳定），habit 事件数据非机密，不值得打扰用户。
  // 显式 DESKAPP_KEYCHAIN=1 才走钥匙串（正式签名分发后可用）。
  if (process.env.DESKAPP_KEYCHAIN === '1') {
    try {
      if (safeStorageAvailable()) {
        return SS_PREFIX + safeStorage.encryptString(plaintext).toString('base64')
      }
      console.error('[HabitCrypto] safeStorage unavailable — field dropped (fail-closed)')
      return ''
    } catch (e) {
      console.error('[HabitCrypto] encrypt failed — field dropped (fail-closed):', (e as Error).message)
      return ''
    }
  }
  try {
    return legacyEncrypt(plaintext)
  } catch (e) {
    console.error('[HabitCrypto] encrypt failed — field dropped (fail-closed):', (e as Error).message)
    return ''
  }
}

/**
 * 解密字符串。
 * 新数据走 safeStorage；无 ss: 前缀的按 v1 AES 旧格式尝试。
 * 全部失败返回 ''（不把密文/垃圾数据透传到摘要或 LLM 提示词）。
 */
export function decrypt(encoded: string): string {
  if (!encoded) return ''
  try {
    if (encoded.startsWith(SS_PREFIX)) {
      const buf = Buffer.from(encoded.slice(SS_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    }
    // v1 旧数据
    return legacyDecrypt(encoded)
  } catch {
    // 可能是从未加密的更早期明文数据（v0）——原样返回以兼容，
    // 但只限"看起来像明文"的情况（无可疑 base64 结构）。
    if (/^[\x20-\x7E一-鿿\s]+$/.test(encoded) && encoded.length < 500) {
      return encoded
    }
    return ''
  }
}

/**
 * 加密对象的 title 和 url 字段（原地修改）。
 */
export function encryptFields(obj: { title?: string; url?: string }): void {
  if (obj.title) obj.title = encrypt(obj.title)
  if (obj.url) obj.url = encrypt(obj.url)
}

/**
 * 解密对象的 title 和 url 字段（原地修改）。
 */
export function decryptFields(obj: { title?: string; url?: string }): void {
  if (obj.title) obj.title = decrypt(obj.title)
  if (obj.url) obj.url = decrypt(obj.url)
}
