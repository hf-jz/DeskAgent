import type { DeskAppAPI } from '../preload/index'

declare global {
  interface Window {
    deskAppAPI: DeskAppAPI
  }
}
