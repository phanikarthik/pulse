"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { useProfile } from "./SessionProvider";

export function AppHeader() {
  const user = useProfile();
  const onWelcome = usePathname() === "/";
  return (
    <header className="app-header">
      <div className="container">
        {onWelcome ? <span /> : <Logo href={user ? "/dashboard" : "/"} />}
        <div className="header-actions">
          <ThemeToggle />
          {user && (
            <Link href="/account" className="icon-btn avatar" aria-label={`Your account (${user.displayName})`}>
              {user.displayName.slice(0, 1)}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
