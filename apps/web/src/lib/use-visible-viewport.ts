'use client'

import { useEffect, useState } from 'react'
import { phoneKeyboardInset } from './phone-layout'

export function useVisibleViewport() {
  const [visible, setVisible] = useState<{ height: number; bottomInset: number } | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    const measure = () => {
      const height = viewport?.height ?? window.innerHeight
      const bottomInset = phoneKeyboardInset(window.innerHeight, height, viewport?.offsetTop ?? 0)
      setVisible((previous) =>
        previous?.height === height && previous.bottomInset === bottomInset
          ? previous
          : { height, bottomInset },
      )
    }
    measure()
    window.addEventListener('resize', measure)
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    return () => {
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
    }
  }, [])
  return visible
}
