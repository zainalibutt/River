import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import type { ReactNode } from 'react'
import { homeDisplay } from '@/lib/home-font'
import './globals.css'
import './club.css'
import './control-language.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' })

export const metadata: Metadata = {
  title: 'River — Premium poker',
  description: 'A server-authoritative Texas Hold’em table built for friends and the couch.',
}

/**
 * Every screen is laid out to fit the device as it is, so none is ever zoomed:
 * on a phone or a tablet a pinch only took the controls out of reach, and a
 * double tap on a button zoomed rather than pressed. Browsers that ignore this
 * for the sake of accessibility are held by touch-action on the menu and the
 * table instead.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${homeDisplay.variable}`}>
      <body>{children}</body>
    </html>
  )
}
