'use client'

import { useSyncExternalStore } from 'react'
import { riverMusic } from '@/lib/river-music'

const subscribe = (listener: () => void) => riverMusic.subscribe(listener)
const snapshot = () => riverMusic.isMuted()
const serverSnapshot = () => false

/** The menu's music, on and off, apart from the sound effects. */
export function RiverMusicControl({ variant = 'label' }: { variant?: 'label' | 'setting' }) {
  const muted = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  return (
    <button
      type="button"
      className={variant === 'setting' ? 'club-setting-toggle' : 'club-home-tool'}
      aria-label="Music"
      aria-pressed={!muted}
      onClick={() => riverMusic.setMuted(!muted)}
      title={muted ? 'Turn music on' : 'Mute music'}
    >
      <span>Music</span>
      <strong>{muted ? 'Off' : 'On'}</strong>
    </button>
  )
}
