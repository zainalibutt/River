'use client'

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="route-error">
      <p>THE TABLE WENT QUIET</p>
      <h1>River could not restore this hand.</h1>
      <button type="button" onClick={reset}>
        RETURN TO THE TABLE
      </button>
    </main>
  )
}
