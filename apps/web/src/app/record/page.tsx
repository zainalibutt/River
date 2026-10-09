import type { Metadata } from 'next'
import './record.css'
import { PlayerRecordPage } from './player-record-page'

/** Your record: the hands you played, kept for you and shown to nobody else. */
export const metadata: Metadata = {
  title: 'Your record — River',
}

export default function RecordPage() {
  return <PlayerRecordPage />
}
