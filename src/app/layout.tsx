import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import { SessionProvider } from "@/components/SessionProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { getProfile } from "@/lib/session";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Pulse — vote first, then see what everyone thinks", template: "%s · Pulse" },
  description:
    "Pulse is a public poll on today's current-affairs questions. Cast your vote, then see how everyone else voted.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1426" },
  ],
};

const themeScript = `(function(){try{var t=localStorage.getItem('pulse-theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  return (
    <html lang="en" className={bricolage.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SessionProvider profile={profile}>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <AppHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </SessionProvider>
      </body>
    </html>
  );
}
