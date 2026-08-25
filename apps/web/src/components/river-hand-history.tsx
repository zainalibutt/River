'use client'

import type { Card, HandRecord } from '@river/engine'
import { buildReplay, frameAt, streetBoundaries } from '@river/engine'
import { useMemo, useState } from 'react'
import {
  formatChips,
  handsPlayed,
  historyRows,
  netChips,
  outcomeLabel,
  showdownPercent,
  streetLabel,
} from '@/lib/history'

interface RiverHandHistoryProps {
  hands: readonly HandRecord[]
  selfId: string
  onClose: () => void
}

const SUIT_SYMBOLS: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' }

export function RiverHandHistory({ hands, selfId, onClose }: RiverHandHistoryProps) {
  const [openHand, setOpenHand] = useState<number | null>(null)
  const rows = useMemo(() => historyRows(hands, selfId), [hands, selfId])
  const played = handsPlayed(rows)
  const net = netChips(rows)
  const showdowns = showdownPercent(rows)

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <button className="modal-close" type="button" onClick={onClose}>
          CLOSE
        </button>
        <p className="eyebrow">THIS SESSION</p>
        <h2 id="history-title">Hand history</h2>

        <dl className="history-summary">
          <div>
            <dt className="history-stat-key">HANDS PLAYED</dt>
            <dd className="history-stat-value">{played}</dd>
          </div>
          <div>
            <dt className="history-stat-key">NET</dt>
            <dd className={`history-stat-value ${net > 0 ? 'up' : net < 0 ? 'down' : ''}`}>
              {net > 0 ? '+' : ''}
              {formatChips(net)}
            </dd>
          </div>
          <div>
            <dt className="history-stat-key">WENT TO SHOWDOWN</dt>
            <dd className="history-stat-value">{showdowns === null ? '--' : `${showdowns}%`}</dd>
          </div>
        </dl>

        {rows.length === 0 ? (
          <p className="history-empty">
            No hands yet. Every hand this table plays is recorded here, with the seed that dealt it.
          </p>
        ) : (
          <ol className="history-list">
            {rows.map((row, index) => {
              const record = hands[index]
              if (record === undefined) return null
              const open = openHand === row.handNumber
              return (
                <li key={row.handNumber} className={`history-row outcome-${row.outcome}`}>
                  <button
                    type="button"
                    className="history-head"
                    aria-expanded={open}
                    onClick={() => setOpenHand(open ? null : row.handNumber)}
                  >
                    <span className="history-number">#{row.handNumber}</span>
                    <span className="history-street">{streetLabel(row.street)}</span>
                    <span className="history-pot">{formatChips(row.potChips)}</span>
                    <span className="history-outcome">{outcomeLabel(row)}</span>
                    <span className="history-toggle" aria-hidden="true">
                      {open ? '−' : '+'}
                    </span>
                  </button>
                  {open ? <HandReplay record={record} /> : null}
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

/**
 * A scrubber over one hand.
 *
 * The slider is the whole control on purpose. A play button implies a hand
 * has a duration, and a replay does not - it has steps, and a player looking
 * for the moment a pot got big wants to land on that step directly.
 */
function HandReplay({ record }: { record: HandRecord }) {
  const frames = useMemo(() => buildReplay(record), [record])
  const [index, setIndex] = useState(frames.length - 1)
  const frame = frameAt(frames, index)
  const boundaries = useMemo(() => streetBoundaries(frames), [frames])

  if (frame === null) return null

  return (
    <div className="history-replay">
      <div className="replay-board">
        {frame.boardAfter.length === 0 ? (
          <span className="replay-noboard">No board yet</span>
        ) : (
          frame.boardAfter.map((card) => (
            <span
              className={`replay-card suit-${card.suit}`}
              key={`${card.rank}${card.suit}`}
              role="img"
              aria-label={`${card.rank} ${card.suit}`}
            >
              {card.rank}
              {SUIT_SYMBOLS[card.suit]}
            </span>
          ))
        )}
      </div>

      <p className="replay-label">
        <span>{frame.label}</span>
        <em className="replay-total">{formatChips(frame.potAfter)}</em>
      </p>

      <label className="replay-scrub">
        <span className="visually-hidden">
          Step through hand {record.handNumber}, {frames.length} steps
        </span>
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          step={1}
          value={index}
          onChange={(event) => setIndex(Number(event.target.value))}
        />
      </label>

      <ol className="replay-ticks" aria-label="Jump to a street">
        {boundaries.map((boundary) => {
          const at = frameAt(frames, boundary)
          return at === null ? null : (
            <li key={boundary}>
              <button type="button" onClick={() => setIndex(boundary)}>
                {streetLabel(at.street)}
              </button>
            </li>
          )
        })}
        <li>
          <button type="button" onClick={() => setIndex(frames.length - 1)}>
            Result
          </button>
        </li>
      </ol>

      <dl className="replay-proof">
        <dt className="replay-proof-key">COMMIT</dt>
        <dd className="replay-proof-value">
          <code>{record.commit}</code>
        </dd>
        <dt className="replay-proof-key">SERVER SEED</dt>
        <dd className="replay-proof-value">
          <code>{record.revealedSeed ?? 'not revealed'}</code>
        </dd>
      </dl>
    </div>
  )
}
