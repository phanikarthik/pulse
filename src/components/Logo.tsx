import Link from "next/link";

const PULSE_PATH = "M0 10 H34 L40 3 L46 17 L53 1 L59 13 L63 10 H100";

export function PulseLine({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true">
      <path d={PULSE_PATH} pathLength={160} />
    </svg>
  );
}

export function Logo({ size = "sm", href }: { size?: "sm" | "lg"; href?: string }) {
  const cls = `logo ${size === "lg" ? "logo-lg" : ""}`;
  const inner = (
    <>
      <span className="logo-word">
        Pulse<i aria-hidden="true">.</i>
      </span>
      <PulseLine className="logo-line" />
    </>
  );
  if (!href) return <span className={cls}>{inner}</span>;
  return (
    <Link href={href} className={cls} aria-label="Pulse home">
      {inner}
    </Link>
  );
}
