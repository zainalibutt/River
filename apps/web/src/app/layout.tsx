import type { Metadata } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'
import './club.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' })

export const metadata: Metadata = {
  title: 'River — Poker after dark',
  description: 'A server-authoritative Texas Hold’em table built for friends and the couch.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  )
}
