import { notFound } from 'next/navigation'
import { MotionLab } from '@/components/motion-lab'

export const dynamic = 'force-dynamic'

export default function MotionLabPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <MotionLab />
}
