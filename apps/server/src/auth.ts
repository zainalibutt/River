import type { JWTPayload, JWTVerifyGetKey } from 'jose'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AuthenticatedPlayer {
  playerId: string
  anonymous: boolean
}

export type TokenVerifier = (token: string) => Promise<AuthenticatedPlayer>

export interface SupabaseTokenVerifierOptions {
  supabaseUrl: string
  getKey?: JWTVerifyGetKey
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function playerFromClaims(payload: JWTPayload): AuthenticatedPlayer {
  if (payload.role !== 'authenticated') {
    throw new Error('token is not an authenticated Supabase session')
  }
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
    throw new Error('token has no valid player id')
  }
  return {
    playerId: payload.sub,
    anonymous: payload.is_anonymous === true,
  }
}

export function createSupabaseTokenVerifier(options: SupabaseTokenVerifierOptions): TokenVerifier {
  const baseUrl = options.supabaseUrl.replace(/\/$/, '')
  const issuer = `${baseUrl}/auth/v1`
  const getKey = options.getKey ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
  return async (token) => {
    if (token.length === 0) {
      throw new Error('missing access token')
    }
    const { payload } = await jwtVerify(token, getKey, {
      issuer,
      audience: 'authenticated',
    })
    return playerFromClaims(payload)
  }
}
