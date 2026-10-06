'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { tableSound } from '@/lib/table-sound'

const subscribe = (listener: () => void) => tableSound.subscribe(listener)
const snapshot = () => tableSound.isMuted()
const serverSnapshot = () => false

export function useSoundMuted(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

export function useInterfaceSound(): void {
  useEffect(() => {
    const controlFor = (target: EventTarget | null): Element | null =>
      target instanceof Element
        ? target.closest(
            'button:not([disabled]), a[href], [role="button"]:not([aria-disabled="true"])',
          )
        : null
    const unlock = () => tableSound.unlock()
    const hover = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const control = controlFor(event.target)
      if (control !== null && control !== controlFor(event.relatedTarget))
        tableSound.play('ui_hover')
    }
    const click = (event: MouseEvent) => {
      if (controlFor(event.target) !== null) tableSound.play('ui_click')
    }
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
    window.addEventListener('pointerover', hover)
    window.addEventListener('click', click)
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true })
      window.removeEventListener('keydown', unlock, { capture: true })
      window.removeEventListener('pointerover', hover)
      window.removeEventListener('click', click)
    }
  }, [])
}
