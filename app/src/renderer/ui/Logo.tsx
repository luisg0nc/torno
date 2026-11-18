import { ScribedLogo } from './plate/ScribedVise'

/**
 * torno's logo: a bench vise seen from the side, its jaws and slide holding a part, its screw and handle, its base.
 * It is the drawing of the icons without their tile (`scripts/torno.svg`, and `scripts/torno-16.svg` for `small`;
 * `launcher.test.ts` holds them equal): the vise in the colour of the text around it, the part in the accent.
 * `plain` draws the part in the vise's colour too, for where the logo stands in for a picture; `small` is for 20 px
 * and less, where the large drawing goes soft. `scribed` is the vise as lines and no fill, in `--on-dye`, for a dyed
 * plate (`plate/ScribedVise.tsx` draws it).
 */
export function Logo({ small = false, plain = false, scribed = false }: { small?: boolean; plain?: boolean; scribed?: boolean }) {
  if (scribed) return <ScribedLogo />
  const className = plain ? 'logo logo-plain' : 'logo'
  return small ? (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1 12V4a1 1 0 0 1 1-1h3v6h5V3h2a1 1 0 0 1 1 1v8Z" />
      <rect x="13" y="7" width="1" height="1" />
      <rect x="14" y="3" width="1" height="9" />
      <rect x="2" y="13" width="10" height="1" />
      <rect className="logo-part" x="6" y="4" width="3" height="4" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      <path d="M8 42V17a3 3 0 0 1 3-3h11v20h14V14h7a3 3 0 0 1 3 3v25Z" />
      <rect x="46" y="26" width="6" height="4" />
      <rect x="52" y="14" width="4" height="28" rx="2" />
      <rect x="10" y="44" width="34" height="4" rx="2" />
      <rect className="logo-part" x="24" y="18" width="10" height="14" rx="1" />
    </svg>
  )
}
