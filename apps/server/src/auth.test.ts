import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { createSupabaseTokenVerifier } from './auth.js'

const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const SUPABASE_URL = 'https://river.supabase.co'

async function signer() {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const publicJwk = await exportJWK(publicKey)
  const imported = await importJWK(publicJwk, 'ES256')
  const verify = createSupabaseTokenVerifier({
    supabaseUrl: SUPABASE_URL,
    getKey: async () => imported,
  })
  const sign = (claims: Record<string, unknown> = {}) =>
    new SignJWT({ role: 'authenticated', is_anonymous: true, ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(PLAYER_ID)
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  return { sign, verify }
}

describe('Supabase token verifier', () => {
  it('accepts an anonymous authenticated user without changing identity', async () => {
    const { sign, verify } = await signer()
    await expect(verify(await sign())).resolves.toEqual({
      playerId: PLAYER_ID,
      anonymous: true,
      admin: false,
    })
  })

  it('accepts the same player after account upgrade', async () => {
    const { sign, verify } = await signer()
    await expect(verify(await sign({ is_anonymous: false }))).resolves.toEqual({
      playerId: PLAYER_ID,
      anonymous: false,
      admin: false,
    })
  })

  it('grants the developer role from app_metadata on a real account', async () => {
    const { sign, verify } = await signer()
    const token = await sign({ is_anonymous: false, app_metadata: { river_role: 'developer' } })
    await expect(verify(token)).resolves.toEqual({
      playerId: PLAYER_ID,
      anonymous: false,
      admin: true,
    })
  })

  it('never grants the developer role from anything the player can write', async () => {
    const { sign, verify } = await signer()

    // user_metadata is writable by the account holder through auth.updateUser.
    // If the role were read from there, granting yourself every developer power
    // in the game would be one call from the browser console.
    const forged = await sign({
      is_anonymous: false,
      user_metadata: { river_role: 'developer' },
    })
    await expect(verify(forged)).resolves.toMatchObject({ admin: false })

    // A top-level claim is not the metadata object either, and neither is a
    // role by a different name.
    await expect(
      verify(await sign({ is_anonymous: false, river_role: 'developer' })),
    ).resolves.toMatchObject({ admin: false })
    await expect(
      verify(await sign({ is_anonymous: false, app_metadata: { river_role: 'admin' } })),
    ).resolves.toMatchObject({ admin: false })

    // Anonymous sessions are handed to anyone who loads the page. One holding
    // the claim means something upstream is wrong, and the answer is still no.
    await expect(
      verify(await sign({ is_anonymous: true, app_metadata: { river_role: 'developer' } })),
    ).resolves.toMatchObject({ admin: false })
  })

  it('rejects the wrong issuer, audience, role, or an expired token', async () => {
    const { sign, verify } = await signer()
    await expect(verify(await sign({ role: 'anon' }))).rejects.toThrow('not an authenticated')

    const { privateKey, publicKey } = await generateKeyPair('ES256')
    const imported = await importJWK(await exportJWK(publicKey), 'ES256')
    const isolated = createSupabaseTokenVerifier({
      supabaseUrl: SUPABASE_URL,
      getKey: async () => imported,
    })
    const invalid = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(PLAYER_ID)
      .setIssuer('https://wrong.example/auth/v1')
      .setAudience('wrong')
      .setExpirationTime(0)
      .sign(privateKey)
    await expect(isolated(invalid)).rejects.toThrow()
  })
})
