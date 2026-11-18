import { useEffect, useSyncExternalStore } from 'react'
import type { Profile } from '../../shared/profile'

/** What the head of the Print profile section says: `Bambu X1C, PETG`; `none` for a project made for neither. */
export function profileSaid(profile: Profile | null): string {
  return [profile?.printer?.name, profile?.material?.name].filter((n): n is string => n !== undefined).join(', ') || 'none'
}

/**
 * The profile of each project, read once and shared: the section's head says it while the section is folded, and its body, when
 * open, changes it. Main keeps it (`<project>/.torno/profile.json`); this is only what the window has read of it.
 */
const known = new Map<string, Profile | null>()
const asked = new Set<string>()
const listeners = new Set<() => void>()
const tell = (): void => listeners.forEach((l) => l())

/** Keeps what main answered for a project, and tells whoever shows it. */
export function setKnownProfile(objectId: string, profile: Profile | null): void {
  known.set(objectId, profile)
  tell()
}

/** Reads the profile of a project from main, unless it has been or is being read (`again` reads it anew). */
export function loadProfile(objectId: string, again = false): void {
  const bridge = (globalThis as { window?: { torno?: Window['torno'] } }).window?.torno
  if (!bridge || (!again && (known.has(objectId) || asked.has(objectId)))) return
  asked.add(objectId)
  void bridge.profile
    .get(objectId)
    .then((profile) => setKnownProfile(objectId, profile))
    .catch(() => {})
    .finally(() => asked.delete(objectId))
}

/** The profile of a project as the window has read it: null until it is, and for a project made for neither. */
export function useProfile(objectId: string | null): Profile | null {
  const read = (): Profile | null => (objectId === null ? null : (known.get(objectId) ?? null))
  const profile = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    read,
    read
  )
  useEffect(() => {
    if (objectId !== null) loadProfile(objectId)
  }, [objectId])
  return profile
}
