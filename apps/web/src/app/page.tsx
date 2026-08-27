import { ClubMenu } from '@/components/club-menu'

/**
 * The front door.
 *
 * Links shared before this route existed point at `/?room=...&code=...`,
 * because the table used to be the whole site. Those are forwarded to `/table`
 * by a redirect in next.config.ts, which happens as an HTTP 308 before any
 * React runs - a redirect thrown from here instead resolved through the RSC
 * payload and left the address bar where it started.
 */
export default function HomePage() {
  return <ClubMenu />
}
