"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { useStore } from "@/lib/demo-store";

export function AppHeader() {
  const s = useStore();
  const user = s?.user;
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
