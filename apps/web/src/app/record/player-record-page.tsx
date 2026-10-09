'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { RiverHandHistory } from '@/components/river-hand-history'
import { createRiverAuthClient, ensureRiverSession, loadBrowserAuthConfig } from '@/lib/auth'
import {
  againstNell,
  type RecordedHand,
  recordedHandFrom,
  type Scorecard,
  scorecard,
  sessions,
} from '@/lib/player-record'

/** How many hands the page reads: the newest, which is what a player looks back over. */
const READ_LIMIT = 500
/** Below this many hands every number here still moves a lot, and the page says so. */
const SHORT_RECORD = 50

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; playerId: string; hands: RecordedHand[] }
  | { kind: 'failed' }

function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('en-GB')} bb`
}

function when(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ScoreRows({ card }: { card: Scorecard }) {
  return (
    <>
      <div className="club-row club-row-fixed">
        <span className="club-row-label">Hands</span>
        <span className="club-row-value">{card.hands.toLocaleString('en-GB')}</span>
      </div>
      <div className="club-row club-row-fixed">
        <span className="club-row-label">Result</span>
        <span className="club-row-value">{signed(card.netBigBlinds)}</span>
      </div>
      <div className="club-row club-row-fixed">
        <span className="club-row-label">Showdowns won</span>
        <span className="club-row-value">
          {card.showdownsWon} of {card.showdowns}
        </span>
      </div>
    </>
  )
}

export function PlayerRecordPage() {
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [replaying, setReplaying] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const client = createRiverAuthClient(await loadBrowserAuthConfig())
        const session = await ensureRiverSession(client)
        // Row-level security returns this player's rows and nobody else's.
        const { data, error } = await client
          .from('player_hands')
          .select(
            'hand_id, played_at, room_kind, big_blind, net_chips, showed, record, own_hole, opponents',
          )
          .order('played_at', { ascending: false })
          .limit(READ_LIMIT)
        if (error !== null) throw error
        const hands = (data ?? []).flatMap((row) => {
          const hand = recordedHandFrom(row as Record<string, unknown>)
          return hand === null ? [] : [hand]
        })
        if (!cancelled) setLoaded({ kind: 'ready', playerId: session.user.id, hands })
      } catch {
        if (!cancelled) setLoaded({ kind: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const hands = loaded.kind === 'ready' ? loaded.hands : []
  const overall = useMemo(() => scorecard(hands), [hands])
  const nell = useMemo(() => againstNell(hands), [hands])
  const sittings = useMemo(() => sessions(hands).slice(0, 8), [hands])
  const replayable = useMemo(
    () =>
      hands
        .slice(0, 24)
        .map((hand, index) => ({ sessionNumber: hands.length - index, record: hand.record })),
    [hands],
  )

  return (
    <div className="club">
      <nav className="club-rail" aria-label="Your record">
        <div className="club-wordmark">
          <h1 className="club-wordmark-name">River</h1>
          <div className="club-wordmark-rule" aria-hidden="true">
            <span className="club-wordmark-pips">&spades;&hearts;&diams;&clubs;</span>
          </div>
        </div>
        <div className="club-nav">
          <button type="button" className="club-nav-item" onClick={() => router.push('/')}>
            <span className="club-nav-mark" aria-hidden="true">
              &diams;
            </span>
            <span className="club-nav-label">Back</span>
          </button>
        </div>
        <div className="club-rail-footer">
          <div className="club-rail-footer-rule">
            <span>Private to you</span>
          </div>
        </div>
      </nav>

      <div className="club-stage">
        {/* Decorative, as on the menu: the room behind the page. */}
        <Image
          className="club-stage-image"
          src="/menu/rooftop.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
        />
        <section
          className="club-folio club-scene record-folio"
          aria-live="polite"
          aria-label="Your record"
        >
          <header className="club-folio-head">
            <h2 className="club-folio-title">Your record</h2>
            <p className="club-folio-sub">Only you can see this</p>
          </header>

          {loaded.kind === 'loading' ? (
            <p className="club-folio-note">Reading your hands.</p>
          ) : loaded.kind === 'failed' ? (
            <>
              <p className="club-folio-note">
                River could not reach your record just now. Try again in a moment.
              </p>
              <button
                type="button"
                className="club-primary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </>
          ) : hands.length === 0 ? (
            <p className="club-folio-note">
              Nothing here yet. Every hand you play from now on is kept for you, here and nowhere
              else.
            </p>
          ) : (
            <>
              <ScoreRows card={overall} />
              {overall.hands < SHORT_RECORD ? (
                <p className="club-folio-note">
                  A short record: over {overall.hands} hands these numbers still move a lot.
                </p>
              ) : null}

              <h3 className="record-heading">Against Nell</h3>
              {nell.hands === 0 ? (
                <p className="club-folio-note">You have not sat with the champion yet.</p>
              ) : (
                <ScoreRows card={nell} />
              )}

              <h3 className="record-heading">Recent sittings</h3>
              <ol className="record-sittings">
                {sittings.map((sitting) => (
                  <li key={sitting.startedAtMs}>
                    <span>{when(sitting.startedAtMs)}</span>
                    <span>
                      {sitting.hands} {sitting.hands === 1 ? 'hand' : 'hands'}
                    </span>
                    <strong className={sitting.netBigBlinds >= 0 ? 'up' : 'down'}>
                      {signed(sitting.netBigBlinds)}
                    </strong>
                  </li>
                ))}
              </ol>

              <button type="button" className="club-primary" onClick={() => setReplaying(true)}>
                Replay your last hands
              </button>
            </>
          )}
        </section>
      </div>

      {replaying && loaded.kind === 'ready' ? (
        <RiverHandHistory
          hands={replayable}
          selfId={loaded.playerId}
          bigBlind={null}
          onClose={() => setReplaying(false)}
        />
      ) : null}
    </div>
  )
}
