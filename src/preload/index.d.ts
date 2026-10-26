import type { HelmApi } from '../shared/ipc'

declare global {
  interface Window {
    helm: HelmApi
  }
}

export {}
