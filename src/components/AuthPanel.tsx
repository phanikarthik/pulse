"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createAccount, signIn, useStore } from "@/lib/demo-store";
import { REGION_SUGGESTIONS } from "@/lib/fixtures";
import { AGE_BANDS, type AgeBand } from "@/lib/types";

type Tab = "signin" | "signup";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;

export function AuthPanel() {
  const [tab, setTab] = useState<Tab>("signin");
  const s = useStore();
  const router = useRouter();
  const tabsRef = useRef<HTMLDivElement>(null);
  const base = useId();

  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tab === "signin" ? "signup" : "signin";
    setTab(next);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };

  if (s?.user) {
    return (
      <div className="card auth-card">
        <p className="kicker">Welcome back</p>
        <p style={{ fontSize: "1.3rem", fontWeight: 650 }}>Signed in as {s.user.displayName}.</p>
        <button className="btn btn-pulse btn-block" onClick={() => router.push("/dashboard")}>
          Go to your questions →
        </button>
      </div>
    );
  }

  return (
    <div className="card auth-card">
      <div className="tabs" role="tablist" aria-label="Account" ref={tabsRef} onKeyDown={onTabKey}>
        <span className="tab-indicator" data-pos={tab === "signin" ? 0 : 1} aria-hidden="true" />
        {(["signin", "signup"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${base}-${t}-tab`}
            data-tab={t}
            aria-selected={tab === t}
            aria-controls={`${base}-${t}-panel`}
            tabIndex={tab === t ? 0 : -1}
            className="tab"
            onClick={() => setTab(t)}
          >
            {t === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-${tab}-panel`} aria-labelledby={`${base}-${tab}-tab`}>
        {tab === "signin" ? (
          <SignIn onDone={() => router.push("/dashboard")} />
        ) : (
          <SignUp onDone={() => router.push("/dashboard")} />
        )}
      </div>
    </div>
  );
}

function GoogleButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-block" onClick={onClick}>
      <svg className="google-g" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Continue with Google
    </button>
  );
}

/** Second step shared by sign-in and sign-up: enter the emailed one-time code. */
function CodeStep({ email, onVerify, onBack }: { email: string; onVerify: () => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from your email.");
    onVerify();
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <p>
        We sent a 6-digit code to <strong>{email}</strong>.
      </p>
      <div className="field">
        <label htmlFor={id}>One-time code</label>
        <input
          id={id}
          className="input otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : `${id}-hint`}
          autoFocus
        />
        {error ? (
          <span id={`${id}-err`} className="error-text">{error}</span>
        ) : (
          <span id={`${id}-hint`} className="hint">Preview: any 6 digits will work.</span>
        )}
      </div>
      <button className="btn btn-pulse btn-block">Verify and continue</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
        ← Use a different email
      </button>
    </form>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  if (sent)
    return (
      <CodeStep
        email={email}
        onBack={() => setSent(false)}
        onVerify={() => {
          signIn(email);
          onDone();
        }}
      />
    );

  return (
    <form
      className="auth-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!EMAIL_RE.test(email)) return setError("Enter a valid email address.");
        setError("");
        setSent(true);
      }}
    >
      <GoogleButton
        onClick={() => {
          signIn("you@gmail.com");
          onDone();
        }}
      />
      <div className="divider">or use email</div>
      <div className="field">
        <label htmlFor={id}>Email</label>
        <input
          id={id}
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          placeholder="you@example.com"
        />
        {error && <span id={`${id}-err`} className="error-text">{error}</span>}
      </div>
      <button className="btn btn-block">Email me a code</button>
      <p className="hint">No passwords. We email you a one-time code each time you sign in.</p>
    </form>
  );
}

function SignUp({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ email: "", displayName: "", region: "", ageBand: "" as AgeBand | "" });
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [human, setHuman] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState(0);
  const [sent, setSent] = useState(false);
  const id = useId();

  const update = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (sent)
    return (
      <CodeStep
        email={form.email}
        onBack={() => setSent(false)}
        onVerify={() => {
          createAccount({ ...form, ageBand: form.ageBand as AgeBand, displayName: form.displayName.trim(), region: form.region.trim() });
          onDone();
        }}
      />
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (attempts >= MAX_ATTEMPTS) return;
    setAttempts((n) => n + 1);
    const err: Record<string, string> = {};
    if (!EMAIL_RE.test(form.email)) err.email = "Enter a valid email address.";
    if (form.displayName.trim().length < 2) err.displayName = "Pick a display name (2–30 characters).";
    if (!form.region.trim()) err.region = "Tell us your city or state.";
    if (!form.ageBand) err.ageBand = "Choose your age band.";
    if (!adult) err.adult = "You must be 18 or over to use Pulse.";
    if (!consent) err.consent = "Please agree to the terms and privacy policy.";
    if (!human) err.human = "Please complete the verification.";
    setErrors(err);
    if (Object.keys(err).length === 0) setSent(true);
  };

  const fieldProps = (k: string) => ({
    "aria-invalid": !!errors[k],
    "aria-describedby": errors[k] ? `${id}-${k}-err` : undefined,
  });
  const Err = ({ k }: { k: string }) =>
    errors[k] ? <span id={`${id}-${k}-err`} className="error-text">{errors[k]}</span> : null;

  const limited = attempts >= MAX_ATTEMPTS;

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-email`}>Email</label>
        <input id={`${id}-email`} className="input" type="email" autoComplete="email" placeholder="you@example.com"
          value={form.email} onChange={(e) => update("email")(e.target.value)} {...fieldProps("email")} />
        <Err k="email" />
      </div>
      <div className="field">
        <label htmlFor={`${id}-name`}>Display name</label>
        <input id={`${id}-name`} className="input" autoComplete="nickname" maxLength={30} placeholder="How we greet you"
          value={form.displayName} onChange={(e) => update("displayName")(e.target.value)} {...fieldProps("displayName")} />
        <Err k="displayName" />
      </div>
      <div className="field">
        <label htmlFor={`${id}-region`}>City or state</label>
        <input id={`${id}-region`} className="input" list={`${id}-regions`} autoComplete="address-level1"
          value={form.region} onChange={(e) => update("region")(e.target.value)} {...fieldProps("region")} />
        <datalist id={`${id}-regions`}>
          {REGION_SUGGESTIONS.map((r) => <option key={r} value={r} />)}
        </datalist>
        <Err k="region" />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} {...fieldProps("ageBand")}>
        <legend>Age band</legend>
        <div className="chips" style={{ marginTop: "0.4rem" }}>
          {AGE_BANDS.map((b) => (
            <label key={b} className="chip">
              <input type="radio" name="ageBand" value={b} checked={form.ageBand === b} onChange={() => update("ageBand")(b)} />
              <span>{b}</span>
            </label>
          ))}
        </div>
        <Err k="ageBand" />
      </fieldset>
      <div className="field">
        <label className="checkbox">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} {...fieldProps("adult")} />
          <span>I confirm I am 18 or over.</span>
        </label>
        <Err k="adult" />
      </div>
      <div className="field">
        <label className="checkbox">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} {...fieldProps("consent")} />
          <span className="consent">
            I agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>. Pulse stores my
            display name, region and age band, and uses them only in anonymous totals.
          </span>
        </label>
        <Err k="consent" />
      </div>
      <div className="field">
        <div className="turnstile">
          <button type="button" role="checkbox" aria-checked={human} aria-label="Verify you are human" onClick={() => setHuman(!human)}>
            {human && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
          </button>
          <span>Verify you are human</span>
          <small>Turnstile</small>
        </div>
        <Err k="human" />
      </div>
      <button className="btn btn-pulse btn-block" disabled={limited}>Create account</button>
      {limited && <p className="error-text" role="alert">Too many attempts. Please wait a few minutes and try again.</p>}
      <div className="divider">or</div>
      <GoogleButton
        onClick={() => {
          signIn("you@gmail.com");
          onDone();
        }}
      />
    </form>
  );
}
