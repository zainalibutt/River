import { notFound } from 'next/navigation'
import { VisualReviewClient } from '@/components/visual-review-client'

export const dynamic = 'force-dynamic'

export default function VisualReviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <VisualReviewClient />
}
