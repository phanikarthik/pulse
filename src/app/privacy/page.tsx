import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <article className="container-narrow prose">
      <h1>Privacy policy</h1>
      <p>Last updated: October 2026. Pulse is a public poll on current-affairs questions. This policy explains what we collect and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Your email address, used only to sign you in with a one-time code (or your Google account, if you choose it).</li>
        <li>Your display name, city or state, and age band, which you give us at signup.</li>
        <li>Your votes, stored with your region and age band so we can show anonymous breakdowns.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To show you results after you vote, and to show everyone combined totals.</li>
        <li>Breakdowns by region or age never show any group with fewer than 20 voters.</li>
        <li>We never show who voted for what, and we never sell your data.</li>
        <li>We use a bot check (Cloudflare Turnstile) and rate limits to keep polls fair.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li>You can edit your profile at any time from your account page.</li>
        <li>
          &ldquo;Delete my account and data&rdquo; permanently removes your profile and every vote you&apos;ve cast. Totals are
          recalculated without your votes.
        </li>
      </ul>
      <h2>Age</h2>
      <p>Pulse is for people aged 18 and over. We do not knowingly collect data from anyone younger.</p>
      <h2>Contact</h2>
      <p>Questions about your data? Contact the Pulse team at the address listed on this site.</p>
    </article>
  );
}
