import { ShortLink } from './short-link'

/**
 * A short invite link, `/t/:code`.
 *
 * Only the code travels. The table it belongs to is looked up when somebody
 * arrives, so a link keeps working for as long as anyone is at that table, and
 * says so plainly once nobody is.
 */
export default async function ShortLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <ShortLink code={code} />
}
