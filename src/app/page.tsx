import Link from "next/link";
import { AuthPanel } from "@/components/AuthPanel";
import { Logo } from "@/components/Logo";

export default function WelcomePage() {
  return (
    <>
      <div className="container welcome">
        <section className="welcome-pitch" aria-labelledby="pitch-title">
          <p className="kicker">
            <span className="live-dot" aria-hidden="true" /> Live questions, posted daily
          </p>
          <h1 id="pitch-title">
            <Logo size="lg" />
          </h1>
          <p className="pitch-lede">
            The questions everyone&apos;s arguing about. <em>Vote first</em> — then see how everyone else voted.
          </p>
          <ol className="steps">
            <li>
              <span><strong>Pick a side</strong> on today&apos;s current-affairs questions.</span>
            </li>
            <li>
              <span><strong>No peeking.</strong> Results stay locked until you&apos;ve voted.</span>
            </li>
            <li>
              <span><strong>See where you stand</strong> — and how many people agree with you.</span>
            </li>
          </ol>
          <div className="card peek" aria-hidden="true">
            <span className="tag">Work</span>
            <p className="peek-q">Should employers be required to offer a four-day week option?</p>
            <div className="peek-bars">
              <div className="peek-bar" style={{ ["--w" as string]: "28%" }} />
              <div className="peek-bar" style={{ ["--w" as string]: "50%" }} />
              <div className="peek-bar" style={{ ["--w" as string]: "22%" }} />
            </div>
            <p className="peek-lock">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Vote to unlock results
            </p>
          </div>
        </section>
        <AuthPanel />
      </div>
      <Link href="/admin" className="admin-corner">
        admin
      </Link>
    </>
  );
}
