export const MIDAS_BUSY_MESSAGE = 'Midas is busy, try again shortly'

export interface BotCapabilities {
  midasAvailable: boolean
  midasSeats: number
  midasSeatsFree: number
}

/** Fail closed while loading, on older servers, and on malformed/unavailable responses. */
export async function botCapabilities(request: typeof fetch = fetch): Promise<BotCapabilities> {
  const unavailable = { midasAvailable: false, midasSeats: 0, midasSeatsFree: 0 }
  try {
    const response = await request('/api/bot-capabilities', { cache: 'no-store' })
    if (!response.ok) return unavailable
    const body: unknown = await response.json()
    if (
      typeof body !== 'object' ||
      body === null ||
      !('midasAvailable' in body) ||
      body.midasAvailable !== true
    ) {
      return unavailable
    }
    const midasSeats = 'midasSeats' in body ? body.midasSeats : undefined
    const midasSeatsFree = 'midasSeatsFree' in body ? body.midasSeatsFree : undefined
    const valid =
      typeof midasSeats === 'number' &&
      Number.isSafeInteger(midasSeats) &&
      midasSeats > 0 &&
      typeof midasSeatsFree === 'number' &&
      Number.isSafeInteger(midasSeatsFree) &&
      midasSeatsFree >= 0 &&
      midasSeatsFree <= midasSeats
    return {
      midasAvailable: true,
      midasSeats: valid ? midasSeats : 0,
      midasSeatsFree: valid ? midasSeatsFree : 0,
    }
  } catch {
    return unavailable
  }
}

export async function midasAvailable(request: typeof fetch = fetch): Promise<boolean> {
  return (await botCapabilities(request)).midasAvailable
}

/** Return a refused challenge to the menu, where live capacity can be refreshed. */
export function botAdmissionDestination(code: string): string | null {
  return code === 'midas_busy' ? '/?midas=busy' : null
}
