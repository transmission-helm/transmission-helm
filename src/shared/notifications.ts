export type NotificationEvent =
  | { kind: 'torrentFinished'; name: string }
  | { kind: 'torrentAdded'; name: string }
  | { kind: 'torrentError'; name: string; message: string }
  | { kind: 'connectionLost'; profileName: string }
  | { kind: 'connectionRestored'; profileName: string }
  | { kind: 'updateAvailable'; version: string; url: string }

export interface NotificationContent {
  title: string
  body: string
  /** Stable identifier used to de-duplicate repeated notifications. */
  tag: string
  /** URL to open when the notification is clicked, if any. */
  url?: string
}

export function notificationContent(event: NotificationEvent): NotificationContent {
  switch (event.kind) {
    case 'torrentFinished':
      return {
        title: 'Download Complete',
        body: `${event.name} finished downloading.`,
        tag: 'torrent-done'
      }
    case 'torrentAdded':
      return { title: 'Torrent Added', body: `${event.name} was added.`, tag: 'torrent-added' }
    case 'torrentError':
      return {
        title: 'Torrent Error',
        body: `${event.name}: ${event.message}`,
        tag: 'torrent-error'
      }
    case 'connectionLost':
      return {
        title: 'Connection Lost',
        body: `Lost connection to ${event.profileName}.`,
        tag: 'conn-lost'
      }
    case 'connectionRestored':
      return {
        title: 'Reconnected',
        body: `Connection to ${event.profileName} restored.`,
        tag: 'conn-restored'
      }
    case 'updateAvailable':
      return {
        title: 'Update Available',
        body: `Transmission Helm ${event.version} is available.`,
        tag: 'app-update',
        url: event.url
      }
  }
}
