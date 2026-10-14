"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { RequireUser } from "@/components/RequireUser";
import { useProfile } from "@/components/SessionProvider";
import { deleteAccount, signOut, updateProfile } from "@/lib/auth";
import { useStore } from "@/lib/demo-store";
import { AGE_BANDS, type AgeBand } from "@/lib/types";

export function AccountView() {
  return (
    <RequireUser fallback={<div className="container-narrow page"><div className="skeleton" style={{ height: 360 }} /></div>}>
      <Inner />
    </RequireUser>
  );
}

function Inner() {
  const s = useStore()!;
  const user = useProfile()!;
  const router = useRouter();
  const [name, setName] = useState(user.displayName);
  const [region, setRegion] = useState(user.region ?? "");
  const [age, setAge] = useState<AgeBand>(user.ageBand ?? AGE_BANDS[0]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const voteCount = Object.keys(s.votes).length;

  return (
    <div className="container-narrow page">
      <Link href="/dashboard" className="back">← All questions</Link>
      <h1 style={{ fontSize: "clamp(2rem, 6vw, 2.8rem)" }}>Your account</h1>

      <form
        className="card admin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim().length < 2) return setError("Pick a display name (2–30 characters).");
          if (!region.trim()) return setError("Tell us your city or state.");
          setError("");
          setBusy(true);
          const res = await updateProfile(user.id, { displayName: name.trim(), region: region.trim(), ageBand: age });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          router.refresh(); // re-render the header and greeting with the saved name
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        }}
      >
        <p className="hint">Signed in as {user.email}</p>
        <div className="field">
          <label htmlFor={`${id}-n`}>Display name</label>
          <input id={`${id}-n`} className="input" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-r`}>City or state</label>
          <input id={`${id}-r`} className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-a`}>Age band</label>
          <select id={`${id}-a`} className="select" value={age} onChange={(e) => setAge(e.target.value as AgeBand)}>
            {AGE_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="vote-row">
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn btn-ghost" onClick={signOut}>Sign out</button>
          <span aria-live="polite" className="hint">{saved ? "Saved ✓" : ""}</span>
        </div>
      </form>

      <section className="card danger-zone" aria-labelledby={`${id}-dz`}>
        <h2 id={`${id}-dz`} style={{ fontSize: "1.15rem" }}>Delete my account and data</h2>
        <p className="hint">
          This permanently removes your profile and all {voteCount} of your votes. Your votes are also removed from
          every result. This can&apos;t be undone.
        </p>
        <div>
          <button type="button" className="btn btn-danger" onClick={() => dialog.current?.showModal()}>
            Delete my account and data
          </button>
        </div>
        {deleteError && <p className="error-text" role="alert">{deleteError}</p>}
      </section>

      <dialog ref={dialog} aria-labelledby={`${id}-dt`}>
        <form method="dialog" style={{ display: "grid", gap: "1rem" }}>
          <h2 id={`${id}-dt`} style={{ fontSize: "1.3rem" }}>Delete everything?</h2>
          <p className="hint">Your profile and votes will be erased immediately.</p>
          <div className="vote-row">
            <button className="btn btn-ghost" value="cancel" autoFocus>Keep my account</button>
            <button
              type="button"
              className="btn btn-pulse"
              onClick={async () => {
                dialog.current?.close();
                setDeleteError("");
                const res = await deleteAccount(); // navigates away on success
                if (!res.ok) setDeleteError(res.error);
              }}
            >
              Yes, delete
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
