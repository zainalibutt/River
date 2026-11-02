'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import type { FriendAction, FriendsState } from '@/lib/friends-server'

/**
 * Friends: find a player by their exact name, answer requests, see who is at a table, and
 * accept an invitation to one. Guests are asked to save their progress first, because a
 * friendship needs an account that will still be there tomorrow.
 */

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; state: FriendsState }
  | { kind: 'guest' }
  | { kind: 'failed' }

export function useFriends(accessToken: () => Promise<string>) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/friends', {
        headers: { authorization: `Bearer ${await accessToken()}` },
        cache: 'no-store',
      })
      if (response.status === 403) return setLoad({ kind: 'guest' })
      if (!response.ok) return setLoad({ kind: 'failed' })
      setLoad({ kind: 'ready', state: (await response.json()) as FriendsState })
    } catch {
      setLoad({ kind: 'failed' })
    }
  }, [accessToken])
  const act = useCallback(
    async (action: FriendAction): Promise<string | null> => {
      const response = await fetch('/api/friends', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(action),
      })
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      await refresh()
      return body.message ?? (response.ok ? null : 'That did not go through.')
    },
    [accessToken, refresh],
  )
  return { load, refresh, act }
}

export function FriendsSheet({
  accessToken,
  onClose,
  onJoinTable,
  onSaveProgress,
}: {
  accessToken: () => Promise<string>
  onClose: () => void
  onJoinTable: (inviteCode: string) => void
  onSaveProgress: () => void
}) {
  const { load, refresh, act } = useFriends(accessToken)
  const [name, setName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const run = async (action: FriendAction) => {
    setBusy(true)
    setNote(await act(action))
    setBusy(false)
  }
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '') return
    void run({ kind: 'request', name }).then(() => setName(''))
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal friends-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friends-title"
      >
        <button className="modal-close" type="button" onClick={onClose}>
          CLOSE
        </button>
        <p className="eyebrow">FRIENDS</p>
        <h2 id="friends-title">Your friends</h2>

        {load.kind === 'loading' ? <p className="friends-note">Finding your friends.</p> : null}
        {load.kind === 'failed' ? (
          <p className="friends-note">
            Friends could not be reached just now. Try again in a moment.
          </p>
        ) : null}
        {load.kind === 'guest' ? (
          <>
            <p className="friends-note">
              Friends need an account that will still be yours tomorrow. Save your progress, and
              your chips, your record and your friends come with you to any device.
            </p>
            <button type="button" className="friends-primary" onClick={onSaveProgress}>
              Save your progress
            </button>
          </>
        ) : null}

        {load.kind === 'ready' ? (
          <>
            <form className="friends-add" onSubmit={send}>
              <label htmlFor="friend-name">Add a friend by their name</label>
              <div>
                <input
                  id="friend-name"
                  value={name}
                  maxLength={16}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Their exact name"
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                <button
                  type="submit"
                  className="friends-primary"
                  disabled={busy || name.trim() === ''}
                >
                  Send
                </button>
              </div>
              {note === null ? null : (
                <p className="friends-note" role="status">
                  {note}
                </p>
              )}
            </form>

            {load.state.invites.length === 0 ? null : (
              <section className="friends-section" aria-label="Invitations">
                <h3>Invited to a table</h3>
                {load.state.invites.map((invite) => (
                  <div className="friends-row" key={invite.id}>
                    <span>{invite.fromName}</span>
                    <button
                      type="button"
                      className="friends-primary"
                      onClick={() => onJoinTable(invite.inviteCode)}
                    >
                      Join
                    </button>
                  </div>
                ))}
              </section>
            )}

            {load.state.incoming.length === 0 ? null : (
              <section className="friends-section" aria-label="Requests">
                <h3>Asking to be friends</h3>
                {load.state.incoming.map((request) => (
                  <div className="friends-row" key={request.id}>
                    <span>{request.name}</span>
                    <button
                      type="button"
                      className="friends-primary"
                      disabled={busy}
                      onClick={() => void run({ kind: 'accept', requestId: request.id })}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ kind: 'decline', requestId: request.id })}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ kind: 'block', playerId: request.playerId })}
                    >
                      Block
                    </button>
                  </div>
                ))}
              </section>
            )}

            <section className="friends-section" aria-label="Friends">
              <h3>Friends</h3>
              {load.state.friends.length === 0 ? (
                <p className="friends-note">No friends yet. Add one by their name above.</p>
              ) : (
                load.state.friends.map((friend) => (
                  <div className="friends-row" key={friend.playerId}>
                    <span>
                      {friend.name}
                      <small>
                        {friend.balance === null
                          ? ''
                          : `${friend.balance.toLocaleString('en-GB')} chips`}
                        {friend.atTable ? ' · at a table' : ''}
                      </small>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ kind: 'remove', playerId: friend.playerId })}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ kind: 'block', playerId: friend.playerId })}
                    >
                      Block
                    </button>
                  </div>
                ))
              )}
            </section>

            {load.state.outgoing.length === 0 ? null : (
              <section className="friends-section" aria-label="Sent">
                <h3>Waiting for an answer</h3>
                {load.state.outgoing.map((request) => (
                  <div className="friends-row" key={request.id}>
                    <span>{request.name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ kind: 'cancel', requestId: request.id })}
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </section>
            )}

            {load.state.blocked.length === 0 ? null : (
              <section className="friends-section" aria-label="Blocked">
                <h3>Blocked</h3>
                {load.state.blocked.map((entry) => (
                  <div className="friends-row" key={entry.playerId}>
                    <span>{entry.name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run({ kind: 'unblock', playerId: entry.playerId })}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </section>
            )}
          </>
        ) : null}
      </section>
    </div>
  )
}
