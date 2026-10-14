import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>© {new Date().getFullYear()} Pulse</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <span>Results are from signed-up voters, not a representative sample.</span>
      </div>
    </footer>
  );
}
