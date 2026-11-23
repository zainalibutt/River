/** The headers a service-role request to Supabase REST carries. */
export function serviceHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  }
}

/**
 * Sends a service-role request that gives up after `timeoutMs`, and says so in
 * words: an abort reads like a dropped connection, which it was not.
 */
export async function sendBounded(
  request: typeof fetch,
  target: URL | string,
  init: RequestInit,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await request(target, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`Supabase did not answer within ${timeoutMs}ms`)
    }
    throw error
  }
}

/** A response's JSON body, or the message Supabase gave for refusing it. */
export async function readBody(response: Response): Promise<unknown> {
  // A write asked for nothing back answers with an empty body.
  const text = await response.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown
    } catch (error) {
      if (response.ok) throw error
    }
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String(body.message)
        : `Supabase request failed with ${response.status}`
    throw new Error(message)
  }
  return body
}
