/**
 * asset-codec.ts — pure data-URL / name helpers for custom pet assets.
 * Kept free of Electron imports so vitest can test it directly.
 */

/** Decode `data:image/png;base64,...` into mime + base64 payload. */
export function decodeImageDataUrl(
  dataUrl: string,
): { mime: 'png' | 'jpeg' | 'webp'; base64: string } | null {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const kind = m[1] === 'jpg' ? 'jpeg' : (m[1] as 'png' | 'jpeg' | 'webp')
  return { mime: kind, base64: m[2] }
}

/** Trim and cap a pet display name; falls back to a default. */
export function normalizePetName(name: string, fallback = '我的宠物'): string {
  const clean = name.trim().slice(0, 40)
  return clean || fallback
}

/** Common subject keywords for the zero-LLM fallback (filename hint). */
const NAME_KEYWORDS: [RegExp, string][] = [
  [/(cat|猫咪|猫猫|小猫|喵)/i, '猫'],
  [/(dog|狗狗|柴犬|小狗|旺|汪)/i, '狗'],
  [/(rabbit|兔子|兔兔|bunny)/i, '兔子'],
  [/(hamster|仓鼠|鼠鼠)/i, '仓鼠'],
  [/(bird|小鸟|鸟|鹦鹉|parrot|chicken|鸡|duck|鸭)/i, '小鸟'],
  [/(fish|鱼|金鱼)/i, '鱼'],
  [/(turtle|乌龟|龟)/i, '乌龟'],
  [/(frog|青蛙|蛙)/i, '青蛙'],
  [/(horse|马|pony)/i, '马'],
  [/(bear|熊|熊猫|panda)/i, '熊'],
  [/(tiger|老虎|虎)/i, '老虎'],
  [/(lion|狮子|狮)/i, '狮子'],
  [/(monkey|猴子|猴)/i, '猴子'],
  [/(penguin|企鹅)/i, '企鹅'],
  [/(dragon|龙|恐龙|dino)/i, '龙'],
  [/(robot|机器人|机械)/i, '机器人'],
  [/(figure|手办|玩偶|doll|娃娃|毛绒|plush|toy|玩具)/i, '玩偶'],
  [/(car|汽车|车)/i, '汽车'],
  [/(plane|飞机)/i, '飞机'],
  [/(rocket|火箭)/i, '火箭'],
  [/(flower|花|植物|plant|蘑菇|mushroom)/i, '植物'],
  [/(star|星星|星)/i, '星星'],
  [/(moon|月亮|月)/i, '月亮'],
  [/(ghost|幽灵|鬼)/i, '幽灵'],
  [/(alien|外星)/i, '外星人'],
]

/**
 * Zero-LLM fallback: extract a subject label from the filename/name hint
 * (e.g. "my_cat.jpg" → "猫"). Pure + unit-tested.
 */
export function classifyByNameKeyword(nameHint: string): string | null {
  for (const [re, label] of NAME_KEYWORDS) {
    if (re.test(nameHint)) return label
  }
  return null
}
