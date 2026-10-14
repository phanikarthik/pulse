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
      <h2>Your account</h2>
      <p>You can delete your account and all associated data at any time from your account page.</p>
      <h2>Changes</h2>
      <p>We may update these terms. If changes are significant, we&apos;ll let you know when you next sign in.</p>
    </article>
  );
}
