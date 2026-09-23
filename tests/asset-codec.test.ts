import { describe, it, expect } from 'vitest'
import { decodeImageDataUrl, normalizePetName, classifyByNameKeyword } from '../src/shared/asset-codec'

describe('decodeImageDataUrl', () => {
  it('decodes png data urls', () => {
    const d = decodeImageDataUrl('data:image/png;base64,aGVsbG8=')
    expect(d).toEqual({ mime: 'png', base64: 'aGVsbG8=' })
  })

  it('normalizes jpg → jpeg and accepts webp', () => {
    expect(decodeImageDataUrl('data:image/jpg;base64,AA==')?.mime).toBe('jpeg')
    expect(decodeImageDataUrl('data:image/webp;base64,AA==')?.mime).toBe('webp')
  })

  it('rejects non-image or malformed payloads', () => {
    expect(decodeImageDataUrl('data:text/html;base64,AA==')).toBeNull()
    expect(decodeImageDataUrl('data:image/png;base64,###')).toBeNull()
    expect(decodeImageDataUrl('not a data url')).toBeNull()
    expect(decodeImageDataUrl('data:image/svg+xml;base64,AA==')).toBeNull()
  })
})

describe('normalizePetName', () => {
  it('trims, caps at 40 chars, and falls back to the default', () => {
    expect(normalizePetName('  我的猫猫  ')).toBe('我的猫猫')
    expect(normalizePetName('x'.repeat(80))).toHaveLength(40)
    expect(normalizePetName('   ')).toBe('我的宠物')
    expect(normalizePetName('')).toBe('我的宠物')
  })
})

describe('classifyByNameKeyword', () => {
  it('extracts a subject label from common filename hints', () => {
    expect(classifyByNameKeyword('my_cat.jpg')).toBe('猫')
    expect(classifyByNameKeyword('IMG_2026_小狗.png')).toBe('狗')
    expect(classifyByNameKeyword('orange-cat-photo')).toBe('猫')
    expect(classifyByNameKeyword('bunny')).toBe('兔子')
    expect(classifyByNameKeyword('手办-初音')).toBe('玩偶')
  })

  it('returns null when the hint has no known keyword', () => {
    expect(classifyByNameKeyword('IMG_20260814_001.jpg')).toBeNull()
    expect(classifyByNameKeyword('')).toBeNull()
  })
})
