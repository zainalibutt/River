import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { RiverWordmark } from '@/components/river-wordmark'
import '../record/record.css'
import './privacy.css'

export const metadata: Metadata = {
  title: 'Privacy — River',
  description: 'What River keeps about the people who play it, why, and for how long.',
}

const CONTACT = 'play@playriver.uk'

/**
 * The privacy notice, `/privacy`.
 *
 * Every line describes what the code does today: the tables named here are the
 * ones in supabase/migrations, and the browser keys are the ones the client
 * reads. When River starts keeping something new, this page changes with it.
 */
export default function PrivacyPage() {
  return (
    <div className="club">
      <nav className="club-rail" aria-label="Privacy">
        <RiverWordmark />
        <div className="club-nav">
          <Link href="/" className="club-nav-item privacy-nav-link">
            <span className="club-nav-mark" aria-hidden="true">
              &diams;
            </span>
            <span className="club-nav-label">Back</span>
          </Link>
        </div>
        <div className="club-rail-footer">
          <div className="club-rail-footer-rule">
            <span>Privacy</span>
          </div>
        </div>
      </nav>

      <div className="club-stage">
        {/* Decorative, as on the menu: the room behind the page. */}
        <Image
          className="club-stage-image"
          src="/menu/rooftop.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
        />
        <article className="club-folio club-scene record-folio privacy-folio">
          <header className="club-folio-head">
            <h1 className="club-folio-title">Privacy</h1>
            <p className="club-folio-sub">Last updated 10 November 2026</p>
            {/* On a phone the folio covers the rail, and its Back with it. */}
            <Link href="/" className="club-link privacy-back">
              Back to River
            </Link>
          </header>

          <p>
            River is a free poker game played with play chips. There is no real money in it: chips
            cannot be bought, sold or cashed out. This notice says what River keeps about you, why,
            how long for, and who else handles it.
          </p>
          <p>
            River is run by Zain Butt in the United Kingdom, who is the data controller under UK
            data protection law (the UK GDPR and the Data Protection Act 2018). For anything on this
            page, write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>

          <h2 className="record-heading">Playing as a guest</h2>
          <p>
            The first time you open River it creates an anonymous guest account for you, so your
            chips and seat survive a reload. A guest account has no email address or name you gave
            us. It holds a random player id, a generated display name (such as QuietHeron42) and the
            date it was made.
          </p>

          <h2 className="record-heading">Signing in with email</h2>
          <p>
            If you choose to sign in, you give us an email address and we send it a one-time sign-in
            link. The address is attached to your account so you can get back into it from another
            browser. We use it to sign you in and for nothing else: no newsletters and no marketing.
          </p>

          <h2 className="record-heading">Your name and public profile</h2>
          <p>
            Every player gets a generated display name, and a signed-in member can choose their own
            in its place. Your display name is shown to the other players at your table. A signed-in
            member also has a public profile at <code>/p/your-name</code>, which anyone can open: it
            shows the name and the day the account was made, and nothing else.
          </p>

          <h2 className="record-heading">What the game records</h2>
          <ul className="privacy-list">
            <li>
              <strong>Chip ledger.</strong> Every change to your bankroll: buy-ins, cash-outs, daily
              chips and other grants, each with its reason and time. This is how River keeps the
              game fair and pays back a seat if a server stops mid-hand.
            </li>
            <li>
              <strong>Seatings.</strong> When you sit down at a table and when you leave, with your
              buy-in, so a seat lost to a server crash can be refunded. A crash refund pays back
              what you bought in with, since your stack at that moment is lost with the server.
            </li>
            <li>
              <strong>Your hand record.</strong> One row per hand you played: the actions at the
              table, your own two cards, the result and the display names of the other players. Only
              you can read it, under Your record. Your newest 2,000 hands are kept and older ones
              are deleted as new ones arrive.
            </li>
            <li>
              <strong>What the bots remember.</strong> River&rsquo;s bots keep a summary of how
              signed-in players tend to play, built only from what everyone at the table could see
              (never your hidden cards), so they can adapt to you over time. Recent hands are folded
              into that summary each day.
            </li>
            <li>
              <strong>Friends.</strong> Friend requests, friendships, blocks and table invitations
              between signed-in players.
            </li>
            <li>
              <strong>Items.</strong> The cosmetics and table items you have earned or bought with
              play chips.
            </li>
          </ul>
          <p>
            Table chat and emotes are passed to the players at your table as they are sent and are
            not stored.
          </p>

          <h2 className="record-heading">Your browser</h2>
          <p>
            River sets no cookies and uses no advertising or analytics trackers. It keeps a few
            things in your browser&rsquo;s local storage: the sign-in session that keeps you logged
            in, the last table you sat at, whether you have seen the intro, and your settings (sound
            and music, profanity filter, amounts in big blinds, showing losing hands, and when you
            last dismissed the prompt to save your progress). These stay on your device, and
            clearing your site data removes them.
          </p>

          <h2 className="record-heading">Why we use it</h2>
          <p>
            We use this information to run the game you asked to play, which is the lawful basis of
            providing that service to you, and for our legitimate interests in keeping the game fair
            and secure, fixing faults and letting the bots play well against you.
          </p>

          <h2 className="record-heading">Who else handles it</h2>
          <ul className="privacy-list">
            <li>
              <strong>Supabase</strong> hosts River&rsquo;s database and its sign-in service, and
              sends the sign-in emails.
            </li>
            <li>
              <strong>Railway</strong> hosts the game server. Like any web host it keeps request
              logs, including IP addresses, for a limited period, to run and protect the service.
            </li>
          </ul>
          <p>
            Both act on our behalf under their data processing terms, and their servers may be
            outside the UK; those terms cover such transfers. We do not sell your information or
            share it with anyone else.
          </p>

          <h2 className="record-heading">How long we keep it</h2>
          <p>
            Your account and what it records are kept for as long as the account exists, apart from
            the hand record, which keeps your newest 2,000 hands. Ask us to delete your account and
            we will remove it and the information linked to it: your sign-in, your display name,
            your hand records, friends, invites, items and what the bots learned about your play.
            The chip ledger keeps its entries, so the bank still balances, under a number that
            nothing links to you any more. Your old display name can still appear in the hand
            records of players you sat with.
          </p>

          <h2 className="record-heading">Your rights</h2>
          <p>
            You can ask for a copy of the information we hold about you, and ask us to correct it,
            delete it, restrict how we use it or object to our using it. Write to{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on your account, or include
            your display name if you play as a guest, and we will reply within one month. If you are
            unhappy with how we have handled your information, you can complain to the Information
            Commissioner&rsquo;s Office at <a href="https://ico.org.uk">ico.org.uk</a>.
          </p>

          <h2 className="record-heading">Changes</h2>
          <p>
            If River starts keeping something new, this page will be updated to say so, and the date
            at the top will change.
          </p>
        </article>
      </div>
    </div>
  )
}
