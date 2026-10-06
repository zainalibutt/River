'use client'

import { tableSound } from '@/lib/table-sound'
import { useSoundMuted } from '@/lib/use-interface-sound'

export function RiverSoundControl({
  variant = 'label',
}: {
  variant?: 'label' | 'icon' | 'setting'
}) {
  const muted = useSoundMuted()
  return (
    <button
      type="button"
      className={
        variant === 'icon'
          ? `sound-toggle${muted ? ' muted' : ''}`
          : variant === 'setting'
            ? 'club-setting-toggle'
            : 'club-home-tool'
      }
      aria-label="Sound"
      aria-pressed={!muted}
      onClick={() => tableSound.setMuted(!muted)}
      title={muted ? 'Turn sound on' : 'Mute sound'}
    >
      {variant === 'icon' ? (
        <svg className="sound-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path className="sound-body" d="M4 9.4h3.3L12 5.2v13.6L7.3 14.6H4z" />
          <path className="sound-wave" d="M15.4 9.2a4 4 0 0 1 0 5.6" />
          <path className="sound-wave" d="M18 6.6a7.6 7.6 0 0 1 0 10.8" />
          <path className="sound-slash" d="M4.6 4 20 19.4" />
        </svg>
      ) : (
        <>
          <span>Sound</span>
          <strong>{muted ? 'Off' : 'On'}</strong>
        </>
      )}
    </button>
  )
}
