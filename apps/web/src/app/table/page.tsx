import { RiverRoomTable } from '@/components/river-room-table'

/**
 * The game.
 *
 * It used to be the entire application, at `/`. Moving it here is what lets the
 * menu exist at all, and it costs nothing: the table already reads its room,
 * code and venue from the query string, and remembers the last table it was at,
 * so `/table` on its own rejoins rather than opening a new one.
 */
export default function TablePage() {
  return <RiverRoomTable />
}
