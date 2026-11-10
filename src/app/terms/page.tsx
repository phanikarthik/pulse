import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <article className="container-narrow prose">
      <h1>Terms of use</h1>
      <p>Last updated: October 2026. By creating an account you agree to these terms.</p>
      <h2>Who can use Pulse</h2>
      <p>You must be 18 or over and may hold only one account.</p>
      <h2>Voting</h2>
      <ul>
        <li>You get one vote per question. Votes are final and cannot be changed.</li>
        <li>Automated voting, multiple accounts or attempts to manipulate results are not allowed and may lead to removal.</li>
      </ul>
      <h2>Results</h2>
      <p>
        Pulse results reflect the views of people who chose to vote. They are not a scientific or representative survey
        and should not be presented as one.
      </p>
      <h2>Pulse Live polls</h2>
      <p>
        Anyone can vote in a Pulse Live poll with its join code, without an account. Pulse Live polls are run by their hosts,
        not by Pulse. If a poll breaks these terms, use its Report link; the Pulse team reviews every report.
      </p>
      <h2 id="host-rules">Rules for hosts</h2>
      <p>Hosting is by approval and can be suspended at any time. As a host you agree that your polls will not:</p>
      <ul>
        <li>contain hateful, harassing, sexual, violent or illegal content, or target a private individual;</li>
        <li>spread false or misleading claims, or impersonate a person or organisation;</li>
        <li>advertise, or ask the audience for personal details such as phone numbers or addresses;</li>
        <li>
          campaign for a party or candidate. Polls about politics or elections must be marked as such and go live only after
          the Pulse team approves them; during election periods they may be refused;
        </li>
        <li>be presented as a scientific or representative survey.</li>
      </ul>
      <p>
        Hosts see vote totals for their own polls only, never who voted or any voter&apos;s details. The Pulse team can remove
        any poll and change any host&apos;s limits.
      </p>
      <h2>Your account</h2>
      <p>You can delete your account and all associated data at any time from your account page.</p>
      <h2>Changes</h2>
      <p>We may update these terms. If changes are significant, we&apos;ll let you know when you next sign in.</p>
    </article>
  );
}
