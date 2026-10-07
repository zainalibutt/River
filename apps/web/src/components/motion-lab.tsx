'use client'

import { BOT_TABLE_PRESETS } from '@river/engine'
import type { RoomEvent, RoomView } from '@river/server'
import type { ServerMessage } from '@river/server/wire'
import { useEffect, useMemo, useState } from 'react'
import { RiverRoomTable, type TableLab } from '@/components/river-room-table'
import recorded from '@/lib/motion-scenes.json'
import type { SocketLike } from '@/lib/socket'
import './motion-lab.css'

// The motion lab: hands recorded from a real room (apps/server/src/motion-scenes.test.ts),
// replayed through the real table over a socket that only plays them back. It is for
// reviewing the deal, the run-out and the showdown on any screen without a server, an
// account or a database, and it plays each scene again once the hand's countdown is over.

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

const SCENES = recorded as unknown as MotionScene[]
/** The table's own sign-in and room request go first; the scene starts after them. */
const LEAD_MS = 400
/** An empty moment after the countdown, so one playing is not mistaken for the next. */
const GAP_MS = 1_200

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

function sceneSocket(scene: MotionScene): SocketLike {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const timers = new Set<number>()
  let readyState: number = WebSocket.CONNECTING
  const emit = (type: string, event: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  const deliver = (message: ServerMessage) => emit('message', { data: JSON.stringify(message) })
  const later = (ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      run()
    }, ms)
    timers.add(timer)
  }
  later(0, () => {
    readyState = WebSocket.OPEN
    emit('open', {})
  })
  return {
    get readyState() {
      return readyState
    },
    send(data: string) {
      const message = JSON.parse(data) as { kind: string }
      if (message.kind !== 'authenticate') return
      deliver({ kind: 'authenticated', playerId: scene.selfId, anonymous: true, admin: false })
      for (const step of scene.steps) {
        later(LEAD_MS + step.atMs, () =>
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
          }),
        )
      }
    },
    close() {
      for (const timer of timers) window.clearTimeout(timer)
      timers.clear()
      readyState = WebSocket.CLOSED
    },
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener as (event: unknown) => void)
      listeners.set(type, set)
    },
  }
}

export function MotionLab() {
  const [sceneId, setSceneId] = useState(SCENES[0]?.id ?? '')
  const [run, setRun] = useState(0)
  const scene = SCENES.find((entry) => entry.id === sceneId)

  // A link can name its scene: /dev/motion?scene=allin-preflop.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('scene')
    if (SCENES.some((entry) => entry.id === asked) && asked !== null) setSceneId(asked)
  }, [])

  // Each run is a fresh table: the replay is remounted rather than rewound.
  useEffect(() => {
    if (scene === undefined) return
    const timer = window.setTimeout(() => setRun(run + 1), LEAD_MS + sceneMs(scene) + GAP_MS)
    return () => window.clearTimeout(timer)
  }, [scene, run])

  // One socket per run, made when the table asks for it.
  const lab = useMemo<TableLab | null>(
    () => (scene === undefined ? null : { createSocket: () => sceneSocket(scene) }),
    [scene],
  )
  if (scene === undefined || lab === null) return null
  return (
    <>
      <RiverRoomTable key={`${scene.id}:${run}`} lab={lab} />
      <nav className="motion-lab" aria-label="Motion lab scenes">
        {SCENES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === scene.id}
            title={entry.title}
            onClick={() => {
              setSceneId(entry.id)
              setRun((count) => count + 1)
              window.history.replaceState(null, '', `?scene=${entry.id}`)
            }}
          >
            {entry.id}
          </button>
        ))}
      </nav>
    </>
  )
}
