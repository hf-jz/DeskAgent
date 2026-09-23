// ── Theme — Three-state CSS variable system (P0-10) ──
//
// Based on openworker's theme.ts pattern:
//   - light / dark / auto (follows prefers-color-scheme)
//   - CSS custom properties on :root and [data-theme="light"]
//   - Pre-paint inline script in index.html eliminates FOUC
//   - Tokens mapped from openworker design token table (03-frontend-ui.md)
//
// Usage:
//   import { applyTheme, getTheme, setTheme } from './theme'
//   applyTheme('dark') // sets data-theme on documentElement

export type Theme = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'deskapp-theme'

// ── Get/set ──

export function getTheme(): Theme {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme) || 'dark'
  } catch { return 'dark' }
}

export function setTheme(theme: Theme): void {
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
}

// ── Apply ──

export function applyTheme(theme?: Theme): void {
  const t = theme || getTheme()
  const root = document.documentElement

  if (t === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.dataset.theme = prefersDark ? 'dark' : 'light'
  } else {
    root.dataset.theme = t
  }

  setTheme(t)
}

// ── Listen for system changes (auto mode) ──

export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (getTheme() === 'auto') applyTheme('auto')
  }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

// ── Pre-paint inline script (paste into index.html <head>) ──
// This runs BEFORE React mounts — no flash of wrong theme.
//
//   <script>
//     (function(){
//       try {
//         var t = localStorage.getItem('deskapp-theme') || 'dark';
//         var root = document.documentElement;
//         if (t === 'auto') {
//           root.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
//         } else {
//           root.dataset.theme = t;
//         }
//       } catch(e) {}
//     })();
//   </script>
