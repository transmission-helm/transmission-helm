import { randomUUID } from 'crypto'
import { session, type Session } from 'electron'
import type { ConnectionProfile } from '../shared/profile'
import type { MakeFetchOptions, ProfileFetch } from './connection'

/**
 * Build a fetch function for a profile, backed by an Electron session so that
 * per-profile proxy settings and self-signed certificate acceptance apply
 * without touching the default session the renderer uses.
 *
 * The regular partition is keyed on the profile id and reconfigured on every call, so it must
 * only be used for the profile being connected. `ephemeral` (Test connection, possibly with
 * unsaved edits) uses a throwaway in-memory partition instead, leaving the live one untouched;
 * call `dispose()` on the result when done.
 */
export async function fetchForProfile(
  profile: ConnectionProfile,
  options: MakeFetchOptions = {}
): Promise<ProfileFetch> {
  // No "persist:" prefix: both kinds of partition live in memory only.
  const partition = options.ephemeral ? `helm:test:${randomUUID()}` : `helm:${profile.id}`
  const ses: Session = session.fromPartition(partition, { cache: false })

  if (profile.proxyUrl) {
    await ses.setProxy({ proxyRules: profile.proxyUrl, proxyBypassRules: '<local>' })
  } else {
    await ses.setProxy({ mode: 'direct' })
  }

  if (profile.allowInsecureSSL) {
    const host = profile.host.toLowerCase()
    ses.setCertificateVerifyProc((request, callback) => {
      callback(request.hostname.toLowerCase() === host ? 0 : -3)
    })
  } else {
    ses.setCertificateVerifyProc(null)
  }

  // session.fetch routes through this session's proxy and certificate settings.
  const fetch: ProfileFetch = (url, init) =>
    ses.fetch(url, {
      ...init,
      // Never let Chromium attach cookies or answer HTTP auth prompts on our behalf.
      credentials: 'omit',
      cache: 'no-store'
    })
  if (options.ephemeral) {
    fetch.dispose = async () => {
      ses.setCertificateVerifyProc(null)
      await ses.closeAllConnections()
      await ses.clearStorageData()
    }
  }
  return fetch
}
