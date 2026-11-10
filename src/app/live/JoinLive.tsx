"use client";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { isCode, normaliseCode } from "@/lib/live";

/** Type the 6-character code the host shows on screen. */
export function JoinLive() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const id = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCode(code)) return setError("Codes are 6 letters and numbers, like K7Q2MX.");
    router.push(`/live/${code}`);
  };

  return (
    <div className="container-narrow page">
      <form className="card gate" onSubmit={submit} noValidate>
        <span className="tag">Pulse Live</span>
        <h1>Join a live poll</h1>
        <p>Enter the code on the presenter&apos;s screen. No account needed.</p>
        <div className="field" style={{ width: "min(100%, 280px)" }}>
          <label htmlFor={id} className="sr-only">Join code</label>
          <input id={id} className="input otp" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            maxLength={6} placeholder="K7Q2MX" value={code} autoFocus
            onChange={(e) => { setCode(normaliseCode(e.target.value)); setError(""); }}
            aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
          {error && <span id={`${id}-err`} className="error-text" role="alert">{error}</span>}
        </div>
        <button className="btn btn-pulse">Join</button>
      </form>
    </div>
  );
}
