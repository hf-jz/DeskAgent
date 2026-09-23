// ── D3 #48: PDF text extraction for attachments ──
// Runs pypdf in the hermes engine venv (already deskapp's own python), writes
// <name>.txt next to the imported PDF inside the workspace vfs, and caches by
// sha256 (LRU 20) so re-attaching the same PDF is free. Extraction is capped
// at 200K chars — beyond that the agent can page through the file itself.
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const MAX_CACHE = 20
const MAX_CHARS = 200_000
const cache = new Map<string, string>() // sha256 → txt path (insertion order = LRU)

function venvPython(): string | null {
  const p = join(process.env.HOME || '', '.hermes', 'hermes-agent', 'venv', 'bin', 'python3')
  return existsSync(p) ? p : null
}

const EXTRACT_SRC = `
import sys
from pypdf import PdfReader
try:
    r = PdfReader(sys.argv[1])
    parts = []
    for pg in r.pages:
        try: parts.append(pg.extract_text() or '')
        except Exception: parts.append('')
    sys.stdout.write('\\n'.join(parts)[:${MAX_CHARS}])
except Exception as e:
    sys.stderr.write(str(e)); sys.exit(1)
`

/** Extract text from a PDF into `<pdfPath minus .pdf>.txt`. Returns txt path
 *  or null when extraction is unavailable/fails (degrades silently — the
 *  attachment manifest then lists the raw PDF only). */
export async function extractPdfText(pdfPath: string): Promise<string | null> {
  if (!pdfPath.toLowerCase().endsWith('.pdf')) return null
  const py = venvPython()
  if (!py) return null

  let sha: string
  try {
    sha = createHash('sha256').update(readFileSync(pdfPath)).digest('hex')
  } catch { return null }

  const cached = cache.get(sha)
  if (cached && existsSync(cached)) {
    // touch → most-recently-used
    cache.delete(sha); cache.set(sha, cached)
    return cached
  }

  const txt = await new Promise<string | null>((resolve) => {
    execFile(py, ['-c', EXTRACT_SRC, pdfPath], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout))
  })
  if (txt === null || txt.trim().length === 0) return null

  const txtPath = pdfPath.replace(/\.pdf$/i, '.txt')
  try {
    writeFileSync(txtPath, txt, 'utf8')
  } catch { return null }

  cache.set(sha, txtPath)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return txtPath
}
