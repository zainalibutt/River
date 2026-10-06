import type { CSSProperties } from 'react'

/**
 * The dealer, drawn in the club's brass line at the head of the table.
 *
 * A figure in brass line over a dark silhouette rather than a painted person: the club's
 * own vocabulary, legible at a glance and honest about being a drawing. The face is left
 * plain on purpose - a drawn face that is slightly wrong is worse than none, and posture,
 * bow tie and hands carry who this is.
 *
 * `pitch` names where the last card went, and the dealer's hand follows it: a small move
 * of the forearm toward that side of the table, then back.
 */
export function Dealer({
  pitch,
  style,
}: {
  pitch: 'left' | 'right' | 'centre' | null
  style?: CSSProperties
}) {
  return (
    <div className={`t2d-dealer${pitch === null ? '' : ` pitch-${pitch}`}`} style={style}>
      <svg viewBox="0 0 240 184" aria-hidden="true">
        <g className="t2d-dealer-body">
          <path
            className="t2d-dealer-fill"
            d="M24 184c2-30 16-54 46-67 16-7 28-12 35-21h30c7 9 19 14 35 21 30 13 44 37 46 67Z"
          />
          <path className="t2d-dealer-shirt" d="M105 96 120 140 135 96Z" />
          <path
            className="t2d-dealer-line"
            d="M105 98c-8 14-12 30-9 52l16-18M135 98c8 14 12 30 9 52l-16-18"
          />
          <path className="t2d-dealer-line" d="M108 101c-2 26 1 54 5 83M132 101c2 26-1 54-5 83" />
          <circle className="t2d-dealer-button" cx="120" cy="152" r="2.2" />
          <circle className="t2d-dealer-button" cx="120" cy="167" r="2.2" />
          <path className="t2d-dealer-tie" d="M120 101 107 94v14ZM120 101l13-7v14Z" />
          <rect className="t2d-dealer-tie" x="116.5" y="97.5" width="7" height="7" rx="1.5" />
          <path className="t2d-dealer-line" d="M111 84v10M129 84v10" />
        </g>
        <g className="t2d-dealer-head">
          <path
            className="t2d-dealer-fill"
            d="M100 60c0-16 9-28 20-28s20 12 20 28-9 26-20 26-20-10-20-26Z"
          />
          <path
            className="t2d-dealer-hair"
            d="M99 58c-2-18 9-29 22-29 14 0 22 10 20 29-3-9-10-14-21-14-9 0-17 5-21 14Z"
          />
          <path className="t2d-dealer-line" d="M112 32c-3 6-5 11-6 17" />
          <path className="t2d-dealer-line" d="M100 60c-4-2-5 7 0 9M140 60c4-2 5 7 0 9" />
        </g>
        <g className="t2d-dealer-arm t2d-dealer-arm-left">
          <path
            className="t2d-dealer-fill"
            d="M70 118c-18 10-30 26-29 46 1 10 8 16 20 19l30-3c-10-9-16-22-12-38 3-11 0-19-9-24Z"
          />
          <path className="t2d-dealer-line" d="M46 139l20-5" />
          <ellipse className="t2d-dealer-hand" cx="88" cy="177" rx="12" ry="6.5" />
          <circle className="t2d-dealer-button" cx="75" cy="174" r="1.8" />
        </g>
        <g className="t2d-dealer-arm t2d-dealer-arm-right">
          <path
            className="t2d-dealer-fill"
            d="M170 118c18 10 30 26 29 46-1 10-8 16-20 19l-30-3c10-9 16-22 12-38-3-11 0-19 9-24Z"
          />
          <path className="t2d-dealer-line" d="M194 139l-20-5" />
          <ellipse className="t2d-dealer-hand" cx="152" cy="177" rx="12" ry="6.5" />
          <circle className="t2d-dealer-button" cx="165" cy="174" r="1.8" />
        </g>
      </svg>
    </div>
  )
}

/** The card shoe at the dealer's right hand, where every card on the table starts. */
export function Shoe({ style }: { style?: CSSProperties }) {
  return (
    <div className="t2d-shoe" style={style}>
      <svg viewBox="0 0 72 44" aria-hidden="true">
        <path className="t2d-shoe-body" d="M4 40 14 10h46l8 30Z" />
        <path className="t2d-shoe-lip" d="M14 10h46l-6-6H20Z" />
        <path className="t2d-shoe-card" d="M22 13h30l-4 9H26Z" />
        <path className="t2d-shoe-edge" d="M4 40 14 10h46l8 30ZM14 10l6-6h34l6 6" />
      </svg>
    </div>
  )
}
