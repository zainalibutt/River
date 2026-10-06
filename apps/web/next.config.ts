import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@river/engine'],
  /**
   * Hold the door open for links shared before there was a menu.
   *
   * The table was the entire site, so every invite sent so far points at
   * `/?room=...&code=...`. Those must still seat somebody rather than landing
   * them on a front door the sender never saw.
   *
   * Done here rather than with `redirect()` in the page, because a redirect
   * thrown from a server component is resolved through the RSC payload and the
   * address bar was observed keeping the old URL. A config rule is an HTTP 308
   * before any React runs, which is what a permanent move should be.
   */
  async redirects() {
    return [
      {
        source: '/',
        has: [{ type: 'query', key: 'room' }],
        destination: '/table',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
