/** Fail closed while loading, on older servers, and on malformed/unavailable responses. */
export async function midasAvailable(request: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await request('/api/bot-capabilities', { cache: 'no-store' })
    if (!response.ok) return false
    const body: unknown = await response.json()
    return (
      typeof body === 'object' &&
      body !== null &&
      'midasAvailable' in body &&
      body.midasAvailable === true
    )
  } catch {
    return false
  }
}
