/* eslint-disable svelte/prefer-svelte-reactivity -- selection Sets are replaced wholesale, never mutated in place */
/**
 * Global renderer state built on Svelte 5 runes.
 * The main process is the source of truth; this mirrors its snapshots and
 * holds purely UI-side state (selection, filters, dialogs).
 */
import type { ConnectionSnapshot, IncomingTorrent } from '../../../shared/ipc'
import type { TorrentDetail } from '../../../shared/rpc-types'
import type { AppSettings, DetailTab, UiState } from '../../../shared/settings'
import { defaultSettings, defaultUiState } from '../../../shared/settings'
import { canOpenLocalFiles } from '../../../shared/profile'
import { matchesFilter, type StatusFilter, type TorrentFilter } from './filters'
import { compareTorrents } from './columns'
import { SpeedHistory, type SpeedSample } from './speed-history'

/** Top-level pages selected in the rail. */
export type Page = 'torrents' | 'activity' | 'daemon' | 'settings'

export type DialogKind =
  | { kind: 'addTorrent'; incoming: IncomingTorrent[] }
  | { kind: 'addLink' }
  | { kind: 'connections'; editId?: string }
  | { kind: 'daemonOptions' }
  | { kind: 'appOptions' }
  | { kind: 'properties'; ids: number[]; tab?: 'general' | 'trackers' }
  | { kind: 'moveTorrent'; ids: number[] }
  | { kind: 'setLabels'; ids: number[] }
  | { kind: 'rename'; id: number; path: string; name: string }
  | { kind: 'columns' }
  | { kind: 'about' }
  | { kind: 'licenses' }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel: string
      danger?: boolean
      onConfirm: () => void
    }
  | { kind: 'message'; title: string; message: string }

class AppState {
  // ---- mirrored from main
  snapshot = $state<ConnectionSnapshot>({
    profileId: null,
    status: 'disconnected',
    error: null,
    reconnectIn: 0,
    torrents: [],
    session: null,
    stats: null,
    freeSpace: null,
    lastUpdated: 0
  })
  detail = $state<TorrentDetail | null>(null)
  settings = $state<AppSettings>(defaultSettings())
  ui = $state<UiState>(defaultUiState())
  /** Whether the OS credential store can hold passwords; loaded in init(). */
  vaultAvailable = $state(true)

  // ---- UI-only
  selectedIds = $state<Set<number>>(new Set())
  /** Anchor for shift-click range selection. */
  anchorId = $state<number | null>(null)
  filter = $state<TorrentFilter>({ status: 'all' })
  search = $state('')
  dialog = $state<DialogKind | null>(null)
  toast = $state<{ text: string; error: boolean } | null>(null)
  /** Page shown in the main area (rail navigation). */
  page = $state<Page>('torrents')
  /** Whether the torrent inspector (details panel) is open. It follows `focusedId`. */
  inspectorOpen = $state(false)
  /** Session ↓/↑ speed samples, oldest first, one per poll (max 600). Replaced on every push. */
  speedHistory = $state.raw<SpeedSample[]>([])
  private speedRing = new SpeedHistory()
  private speedProfile: string | null = null

  // ---- derived
  torrents = $derived(this.snapshot.torrents)
  connected = $derived(this.snapshot.status === 'connected')
  activeProfile = $derived(
    this.settings.profiles.find((p) => p.id === this.snapshot.profileId) ?? null
  )
  /** Open / Open containing folder only work for a local daemon or with path mappings. */
  canOpenFiles = $derived(canOpenLocalFiles(this.activeProfile))

  filtered = $derived.by(() => {
    const q = this.search.trim().toLowerCase()
    const list = this.torrents.filter(
      (t) => matchesFilter(t, this.filter) && (!q || t.name.toLowerCase().includes(q))
    )
    const dir = this.ui.sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => compareTorrents(a, b, this.ui.sortKey) * dir || a.id - b.id)
  })

  selected = $derived(this.torrents.filter((t) => this.selectedIds.has(t.id)))
  /** The torrent the details pane follows: the single or last selected one. */
  focusedId = $derived.by(() => {
    if (this.selectedIds.size === 0) return null
    const visible = this.filtered.filter((t) => this.selectedIds.has(t.id))
    return visible.length ? visible[visible.length - 1].id : null
  })

  // ---- actions
  select(ids: number[], anchor?: number | null): void {
    this.selectedIds = new Set(ids)
    if (anchor !== undefined) this.anchorId = anchor
  }

  toggle(id: number): void {
    const next = new Set(this.selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.selectedIds = next
    this.anchorId = id
  }

  selectRange(toId: number): void {
    const rows = this.filtered
    const from = rows.findIndex((t) => t.id === this.anchorId)
    const to = rows.findIndex((t) => t.id === toId)
    if (from < 0 || to < 0) return this.select([toId], toId)
    const [a, b] = from < to ? [from, to] : [to, from]
    this.selectedIds = new Set(rows.slice(a, b + 1).map((t) => t.id))
  }

  selectAll(): void {
    this.selectedIds = new Set(this.filtered.map((t) => t.id))
  }

  setStatusFilter(status: StatusFilter): void {
    this.filter = { status }
  }

  navigate(page: Page): void {
    this.page = page
  }

  openInspector(tab?: DetailTab): void {
    this.inspectorOpen = true
    if (tab && tab !== this.ui.detailTab) void this.updateUi({ detailTab: tab })
  }

  closeInspector(): void {
    this.inspectorOpen = false
  }

  /** Record a speed sample from a snapshot; resets the history when the profile changes. */
  private sampleSpeeds(s: ConnectionSnapshot): void {
    if (s.profileId !== this.speedProfile) {
      this.speedProfile = s.profileId
      this.speedRing.clear()
      this.speedHistory = []
    }
    if (s.status !== 'connected' || !s.stats || !s.lastUpdated) return
    const pushed = this.speedRing.push({
      t: s.lastUpdated,
      down: s.stats.download_speed,
      up: s.stats.upload_speed
    })
    if (pushed) this.speedHistory = this.speedRing.toArray()
  }

  setDetailTab(tab: DetailTab): void {
    void this.updateUi({ detailTab: tab })
  }

  showToast(text: string, error = false): void {
    this.toast = { text, error }
    setTimeout(
      () => {
        if (this.toast?.text === text) this.toast = null
      },
      error ? 6000 : 3000
    )
  }

  async updateUi(patch: Partial<UiState>): Promise<void> {
    // Values taken from $state are proxies, which structured clone (IPC) rejects.
    const plain = $state.snapshot(patch) as Partial<UiState>
    this.ui = { ...this.ui, ...plain }
    this.ui = await window.helm.settings.updateUi(plain)
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    this.settings = await window.helm.settings.update(
      $state.snapshot(patch) as Partial<AppSettings>
    )
  }

  /** Re-read settings the main process changed on its own (e.g. folder history after an add). */
  async refreshSettings(): Promise<void> {
    this.settings = await window.helm.settings.get()
  }

  /** Run an RPC-ish action and surface failures as a toast. */
  async run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn()
    } catch (err) {
      this.showToast(
        `${label} failed: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`,
        true
      )
      return undefined
    }
  }

  /** Wire up IPC subscriptions; call once from App.svelte. Returns a cleanup. */
  init(): () => void {
    const h = window.helm
    void h.settings.get().then((s) => (this.settings = s))
    void h.settings.getUi().then((u) => (this.ui = u))
    void h.settings
      .vaultAvailable()
      .then((v) => (this.vaultAvailable = v))
      .catch(() => {})
    void h.connection.snapshot().then((s) => {
      this.snapshot = s
      this.sampleSpeeds(s)
    })
    const offs = [
      h.connection.onSnapshot((s) => {
        this.snapshot = s
        this.sampleSpeeds(s)
        // Drop selections for torrents that disappeared.
        if (this.selectedIds.size) {
          const alive = new Set(s.torrents.map((t) => t.id))
          const kept = [...this.selectedIds].filter((id) => alive.has(id))
          if (kept.length !== this.selectedIds.size) this.selectedIds = new Set(kept)
        }
      }),
      h.connection.onDetail((d) => (this.detail = d))
    ]
    // Keep the main process informed of which torrent/tab to poll in detail.
    const stop = $effect.root(() => {
      $effect(() => {
        void h.connection.watchTorrent(this.focusedId, this.ui.detailTab)
      })
    })
    return () => {
      offs.forEach((off) => off())
      stop()
    }
  }
}

export const app = new AppState()
