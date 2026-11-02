'use client'

import { useEffect, useState } from 'react'
import { useFriends } from '@/components/friends-sheet'

/**
 * Invite a friend to this table: each friend with one press, beside the copied link. The
 * invitation waits on their menu for two hours. Shown only to a saved account with
 * friends; anybody else still has the link.
 */
export function FriendInvites({
  accessToken,
  inviteCode,
}: {
  accessToken: () => Promise<string>
  inviteCode: string
}) {
  const { load, refresh, act } = useFriends(accessToken)
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (load.kind !== 'ready' || load.state.friends.length === 0 || inviteCode.length === 0) {
    return null
  }
  return (
    <section className="friend-invites" aria-label="Invite a friend">
      <p>Invite a friend</p>
      {load.state.friends.map((friend) => (
        <button
          key={friend.playerId}
          type="button"
          disabled={sent.has(friend.playerId)}
          onClick={() => {
            setSent((current) => new Set(current).add(friend.playerId))
            void act({ kind: 'invite', playerId: friend.playerId, inviteCode })
          }}
        >
          {friend.name}
          <small>
            {sent.has(friend.playerId) ? 'Invited' : friend.atTable ? 'At a table' : 'Invite'}
          </small>
        </button>
      ))}
    </section>
  )
}
