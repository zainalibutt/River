'use client'

import { BOT_TABLE_PRESETS } from '@river/engine'
import type { RoomEvent, RoomView } from '@river/server'
import type { ServerMessage } from '@river/server/wire'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RiverRoomTable, type TableLab } from '@/components/river-room-table'
import recorded from '@/lib/motion-scenes.json'
import type { SocketLike } from '@/lib/socket'
import { resetTableClock, setTableRate, tableNow, tableRate } from '@/lib/table-clock'
import './motion-lab.css'

// The motion lab: hands recorded from a real room (apps/server/src/motion-scenes.test.ts),
// replayed through the real table over a socket that only plays them back. It is for
// reviewing the deal, the run-out and the showdown on any screen without a server, an
// account or a database. The replay runs on the table's clock, so it can be slowed,
// stopped and moved to any moment, and it plays each scene again once its countdown ends.

interface MotionStep {
  atMs: number
  view: RoomView
  events: RoomEvent[]
}

interface MotionScene {
  id: string
  title: string
  selfId: string
  steps: MotionStep[]
}

/** Where the current run of a scene stands: when, on the table's clock, it began. */
interface Timeline {
  startedAt: number | null
}

const SCENES = recorded as unknown as MotionScene[]
/** The table's own sign-in and room request go first; the scene starts after them. */
const LEAD_MS = 400
/** An empty moment after the countdown, so one playing is not mistaken for the next. */
const GAP_MS = 1_200
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4] as const
/** How fast a jump to a moment plays the scene up to it, so every animation is on its way. */
const SEEK_RATE = 12

/** When the hand that ends the scene would have been followed by the next one. */
function sceneMs(scene: MotionScene): number {
  const last = scene.steps.at(-1)
  const between = last?.events.find((event) => event.kind === 'between')
  return (last?.atMs ?? 0) + (between?.kind === 'between' ? between.countdownMs : 0)
}

/** The room was recorded with its clock stopped at zero; a turn's deadline is moved to now. */
function live(view: RoomView): RoomView {
  return view.turnDeadlineMs === null
    ? view
    : { ...view, turnDeadlineMs: Date.now() + view.turnDeadlineMs }
}

function elapsed(timeline: Timeline): number {
  return timeline.startedAt === null ? 0 : tableNow() - timeline.startedAt
}

/**
 * A socket that answers the sign-in and then plays a scene's messages on the table's clock:
 * each one arrives when the scene has run for as long as the room took to send it.
 */
function sceneSocket(scene: MotionScene, timeline: Timeline): SocketLike {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  let readyState: number = WebSocket.CONNECTING
  let sent = 0
  let poll = 0
  const emit = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  const deliver = (message: ServerMessage) => emit('message', { data: JSON.stringify(message) })
  const opening = window.setTimeout(() => {
    readyState = WebSocket.OPEN
    emit('open', {})
  }, 0)
  return {
    get readyState() {
      return readyState
    },
    send(data: string) {
      const message = JSON.parse(data) as { kind: string }
      if (message.kind !== 'authenticate') return
      deliver({ kind: 'authenticated', playerId: scene.selfId, anonymous: true, admin: false })
      timeline.startedAt = tableNow()
      poll = window.setInterval(() => {
        for (const step of scene.steps.slice(sent)) {
          if (elapsed(timeline) < LEAD_MS + step.atMs) break
          sent += 1
          deliver({
            kind: 'snapshot',
            roomId: 'motion-lab',
            requestId: null,
            view: live(step.view),
            balance: 1_000_000,
            ownedItems: [],
            ownedCosmetics: [],
            events: step.events,
            botSeats: 0,
            botPreset: BOT_TABLE_PRESETS[0],
          })
        }
      }, 16)
    },
    close() {
      window.clearTimeout(opening)
      window.clearInterval(poll)
      readyState = WebSocket.CLOSED
    },
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener as (event: unknown) => void)
      listeners.set(type, set)
    },
  }
}

/** CSS animations and transitions keep to the table's clock: slowed, stopped or fast. */
function syncAnimations(rate: number): void {
  for (const animation of document.getAnimations()) {
    if (animation.playbackRate !== rate) animation.playbackRate = rate
  }
}

export function MotionLab() {
  const [sceneId, setSceneId] = useState(SCENES[0]?.id ?? '')
  const [run, setRun] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [seekTo, setSeekTo] = useState<number | null>(null)
  const [at, setAt] = useState(0)
  const timeline = useRef<Timeline>({ startedAt: null })
  const scene = SCENES.find((entry) => entry.id === sceneId)
  const totalMs = scene === undefined ? 0 : LEAD_MS + sceneMs(scene) + GAP_MS

  // A link can name its scene and speed: /dev/motion?scene=allin-preflop&speed=0.25.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const asked = params.get('scene')
    if (asked !== null && SCENES.some((entry) => entry.id === asked)) setSceneId(asked)
    const rate = Number(params.get('speed'))
    if (SPEEDS.some((entry) => entry === rate)) setSpeed(rate)
    return () => resetTableClock()
  }, [])

  const rate = seekTo !== null ? SEEK_RATE : paused ? 0 : speed
  useEffect(() => {
    setTableRate(rate)
    syncAnimations(rate)
  }, [rate])

  // The clock's watch: the readout, the jump to a moment, and the next run of the scene.
  useEffect(() => {
    const watch = window.setInterval(() => {
      const now = elapsed(timeline.current)
      setAt(now)
      syncAnimations(tableRate())
      if (seekTo !== null && now >= seekTo) {
        setSeekTo(null)
        setPaused(true)
      } else if (seekTo === null && now >= totalMs) {
        setRun((count) => count + 1)
      }
    }, 50)
    return () => window.clearInterval(watch)
  }, [seekTo, totalMs])

  // Each run is a fresh table: the replay is remounted rather than rewound, with a socket of
  // its own made when the table asks for it.
  const lab = useMemo<TableLab | null>(() => {
    if (scene === undefined) return null
    const fresh: Timeline = { startedAt: null }
    timeline.current = fresh
    void run
    return { createSocket: () => sceneSocket(scene, fresh) }
  }, [scene, run])

  if (scene === undefined || lab === null) return null
  const restart = (next: { scene?: string; seek?: number | null } = {}) => {
    if (next.scene !== undefined) {
      setSceneId(next.scene)
      window.history.replaceState(null, '', `?scene=${next.scene}`)
    }
    setSeekTo(next.seek ?? null)
    if (next.seek === undefined || next.seek === null) setPaused(false)
    setRun((count) => count + 1)
  }
  return (
    <>
      <RiverRoomTable key={`${scene.id}:${run}`} lab={lab} />
      <nav className="motion-lab" aria-label="Motion lab">
        <div className="motion-lab-row">
          {SCENES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === scene.id}
              title={entry.title}
              onClick={() => restart({ scene: entry.id })}
            >
              {entry.id}
            </button>
          ))}
        </div>
        <div className="motion-lab-row">
          <button type="button" onClick={() => setPaused((stopped) => !stopped)}>
            {paused ? 'PLAY' : 'PAUSE'}
          </button>
          <button type="button" onClick={() => restart()}>
            RESTART
          </button>
          {SPEEDS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={entry === speed}
              onClick={() => setSpeed(entry)}
            >
              {entry}x
            </button>
          ))}
          <input
            type="range"
            min={0}
            max={totalMs}
            step={100}
            value={Math.min(at, totalMs)}
            aria-label="Move to a moment in the scene"
            onChange={(event) => restart({ seek: Number(event.currentTarget.value) })}
          />
          <output>{(at / 1000).toFixed(1)}s</output>
        </div>
      </nav>
    </>
  )
}
