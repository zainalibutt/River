import type { Metadata } from 'next'
import { PlayerProfile } from './player-profile'

/**
 * A member's public profile, `/p/:name`.
 *
 * The title stays generic, and the page shows no name until the server has
 * found a member who goes by it. Otherwise anybody could put any words they
 * liked on a page that looks like River's, just by choosing the address.
 */
export const metadata: Metadata = {
  title: 'Player profile — River',
}

export default async function ProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return <PlayerProfile name={name} />
}
