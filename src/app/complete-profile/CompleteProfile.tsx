"use client";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { useProfile } from "@/components/SessionProvider";
import { completeProfile, signOut } from "@/lib/auth";
import { REGION_SUGGESTIONS } from "@/lib/regions";
import { AGE_BANDS, type AgeBand } from "@/lib/types";

/** For accounts created without the sign-up form (Google): collect what voting needs. */
export function CompleteProfile() {
  const profile = useProfile()!;
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [region, setRegion] = useState(profile.region ?? "");
  const [ageBand, setAgeBand] = useState<AgeBand | "">(profile.ageBand ?? "");
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (displayName.trim().length < 2) err.displayName = "Pick a display name (2–30 characters).";
    if (!region.trim()) err.region = "Tell us your city or state.";
    if (!ageBand) err.ageBand = "Choose your age band.";
    if (!adult) err.adult = "You must be 18 or over to use Pulse.";
    if (!consent) err.consent = "Please agree to the terms and privacy policy.";
    setErrors(err);
    if (Object.keys(err).length > 0) return;
    setBusy(true);
    const res = await completeProfile({ displayName: displayName.trim(), region: region.trim(), ageBand: ageBand as AgeBand });
    if (!res.ok) {
      setBusy(false);
      return setErrors({ form: res.error });
    }
    window.location.assign("/dashboard");
  };

  const fieldProps = (k: string) => ({
    "aria-invalid": !!errors[k],
    "aria-describedby": errors[k] ? `${id}-${k}-err` : undefined,
  });
  const Err = ({ k }: { k: string }) =>
    errors[k] ? <span id={`${id}-${k}-err`} className="error-text">{errors[k]}</span> : null;

  return (
    <div className="container-narrow page">
      <h1 style={{ fontSize: "clamp(2rem, 6vw, 2.8rem)" }}>One more step</h1>
      <p className="hint">Results are broken down by region and age, so we need these before you vote.</p>
      <form className="card admin-form" onSubmit={submit} noValidate>
        <p className="hint">Signed in as {profile.email}</p>
        <div className="field">
          <label htmlFor={`${id}-name`}>Display name</label>
          <input id={`${id}-name`} className="input" autoComplete="nickname" maxLength={30}
            value={displayName} onChange={(e) => setDisplayName(e.target.value)} {...fieldProps("displayName")} />
          <Err k="displayName" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-region`}>City or state</label>
          <input id={`${id}-region`} className="input" list={`${id}-regions`} autoComplete="address-level1" maxLength={60}
            value={region} onChange={(e) => setRegion(e.target.value)} {...fieldProps("region")} />
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
                <input type="radio" name="ageBand" value={b} checked={ageBand === b} onChange={() => setAgeBand(b)} />
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
              I agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>. Pulse stores
              my display name, region and age band, and uses them only in anonymous totals.
            </span>
          </label>
          <Err k="consent" />
        </div>
        {errors.form && <p className="error-text" role="alert">{errors.form}</p>}
        <div className="vote-row">
          <button className="btn btn-pulse" disabled={busy}>{busy ? "Saving…" : "Start voting"}</button>
          <button type="button" className="btn btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </form>
    </div>
  );
}
