export const dynamic = 'force-dynamic'

export function GET(): Response {
  const supabaseUrl = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY
  if (supabaseUrl === undefined || publishableKey === undefined) {
    return Response.json({ error: 'Client authentication is not configured' }, { status: 503 })
  }
  return Response.json(
    { supabaseUrl, publishableKey },
    { headers: { 'cache-control': 'no-store' } },
  )
}
