import { useState, useCallback } from 'react'
import { t } from '../../lib/i18n'

/** P1-B1 #11: composer attachments — whitelist + 15MB/8 caps + name/size dedupe.
 *  Rejected entries stay in the tray (red, with reason) and auto-clear after 2s. */

export interface Attachment {
  id: string
  file: File
  name: string
  size: number
  /** reject reason when the file was refused */
  rejected?: string
}

const MAX_SIZE = 15 * 1024 * 1024
const MAX_COUNT = 8
const OK_EXT = ['.pdf', '.txt', '.md', '.csv', '.json']

export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([])

  const add = useCallback((files: FileList | File[]) => {
    const rejectedIds: string[] = []
    setItems(prev => {
      const next = [...prev]
      for (const f of Array.from(files)) {
        const okType = f.type.startsWith('image/') || OK_EXT.some(e => f.name.toLowerCase().endsWith(e))
        let reason = ''
        if (!okType) reason = t('att.unsupported')
        else if (f.size > MAX_SIZE) reason = t('att.tooLarge')
        else if (next.some(a => a.name === f.name && a.size === f.size)) continue // dedupe
        else if (next.filter(a => !a.rejected).length >= MAX_COUNT) reason = t('att.tooMany')
        const att: Attachment = {
          id: 'att-' + Date.now() + Math.random().toString(36).slice(2, 6),
          file: f, name: f.name, size: f.size, rejected: reason || undefined,
        }
        next.push(att)
        if (reason) rejectedIds.push(att.id)
      }
      return next
    })
    for (const id of rejectedIds) {
      setTimeout(() => setItems(cur => cur.filter(a => a.id !== id)), 2000)
    }
  }, [])

  const remove = useCallback((id: string) => setItems(prev => prev.filter(a => a.id !== id)), [])
  const clear = useCallback(() => setItems([]), [])
  return { items, add, remove, clear }
}
