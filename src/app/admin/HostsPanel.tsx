"use client";
import { useId, useState, type FormEvent } from "react";
import {
  adminAddHost,
  adminSetSwitch,
  adminUpdateHost,
  useHostsData,
  type Host,
  type Switches,
} from "@/lib/data";
import { fmt, relative } from "@/lib/format";
import type { HostStatus } from "@/lib/types";

type Res = { ok: true } | { ok: false; error: string };

/** Owner controls for Pulse Live: who may host, their limits, and platform-wide switches. */
export function HostsPanel() {
  const { data, error, reload } = useHostsData();
  /** Runs an owner action, then reloads. Returns the error, or "". */
  const act = async (fn: () => Promise<Res>) => {
    const res = await fn();
    await reload();
    return res.ok ? "" : res.error;
  };

  if (error) return <div className="card empty" role="alert">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 260 }} />;

  return (
    <div className="admin-grid">
      <div style={{ display: "grid", gap: "1.25rem", alignContent: "start" }}>
        <AddHostForm act={act} />
        <SwitchesCard switches={data.switches} act={act} />
      </div>
      <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
        <div className="section-head"><h2>Hosts</h2></div>
        <p className="hint">
          Hosts run their own Pulse Live polls and see totals for their own polls only, never who voted or anyone&apos;s
          email. Politics or election polls wait for your approval under Questions → Needs approval.
        </p>
        {data.hosts.length === 0 ? (
          <div className="card empty">No hosts yet. Add one with their Pulse email.</div>
        ) : (
          data.hosts.map((h) => <HostCard key={h.userId} h={h} act={act} />)
        )}
      </div>
    </div>
  );
}

type Act = (fn: () => Promise<Res>) => Promise<string>;

function AddHostForm({ act }: { act: Act }) {
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email they use for Pulse.");
    setError("");
    setBusy(true);
    const err = await act(() => adminAddHost(email.trim(), org.trim()));
    setBusy(false);
    if (err) return setError(err);
    setDone(`${email.trim()} is now a host.`);
    setEmail("");
    setOrg("");
  };

  return (
    <form className="card admin-form" onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} style={{ fontSize: "1.3rem" }}>Add a host</h2>
      <p className="hint">They must have signed in to Pulse once. They start with 5 open polls and 200 voters per poll; you can change that below.</p>
      <div className="field">
        <label htmlFor={`${id}-e`}>Their Pulse email</label>
        <input id={`${id}-e`} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-o`}>Organisation <span className="hint">(optional)</span></label>
        <input id={`${id}-o`} className="input" maxLength={80} placeholder="e.g. RV College" value={org} onChange={(e) => setOrg(e.target.value)} />
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn btn-pulse" disabled={busy}>{busy ? "Adding…" : "Add host"}</button>
      <p aria-live="polite" className="hint">{done}</p>
    </form>
  );
}

function SwitchesCard({ switches, act }: { switches: Switches; act: Act }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const flip = async (name: "applications_paused" | "live_polls_paused", on: boolean, warn?: string) => {
    if (warn && !confirm(warn)) return;
    setBusy(true);
    setError(await act(() => adminSetSwitch(name, on)));
    setBusy(false);
  };
  return (
    <section className="card admin-form" aria-labelledby="sw-h">
      <h2 id="sw-h" style={{ fontSize: "1.3rem" }}>Switches</h2>
      <div className="switch-row">
        <div>
          <b>All Pulse Live polls</b>
          <p className="hint">{switches.livePollsPaused ? "Paused: no live poll takes votes." : "Running."}</p>
        </div>
        <button type="button" className={`btn btn-sm ${switches.livePollsPaused ? "btn-pulse" : "btn-danger"}`} disabled={busy}
          onClick={() => switches.livePollsPaused
            ? flip("live_polls_paused", false)
            : flip("live_polls_paused", true, "Pause every Pulse Live poll now? Audiences won't be able to vote until you resume.")}>
          {switches.livePollsPaused ? "Resume" : "Pause all"}
        </button>
      </div>
      <div className="switch-row">
        <div>
          <b>New host applications</b>
          <p className="hint">{switches.applicationsPaused ? "Closed." : "Open (the apply form arrives in a later phase)."}</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
          onClick={() => flip("applications_paused", !switches.applicationsPaused)}>
          {switches.applicationsPaused ? "Reopen" : "Close"}
        </button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

const STATUS_LABEL: Record<HostStatus, string> = {
  pending: "Applied",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Rejected",
};

function HostCard({ h, act }: { h: Host; act: Act }) {
  const [maxPolls, setMaxPolls] = useState(String(h.maxActivePolls));
  const [maxVoters, setMaxVoters] = useState(String(h.maxVotersPerPoll));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();

  const save = async (status: HostStatus, warn?: string) => {
    const polls = Number(maxPolls), voters = Number(maxVoters);
    if (!Number.isInteger(polls) || polls < 0 || polls > 1000) return setError("Open polls must be 0–1000.");
    if (!Number.isInteger(voters) || voters < 1 || voters > 100000) return setError("Voters per poll must be 1–100,000.");
    if (warn && !confirm(warn)) return;
    setBusy(true);
    setError(await act(() => adminUpdateHost({ userId: h.userId, status, maxActivePolls: polls, maxVotersPerPoll: voters })));
    setBusy(false);
  };
  const changed = maxPolls !== String(h.maxActivePolls) || maxVoters !== String(h.maxVotersPerPoll);

  return (
    <article className="card admin-q">
      <div className="q-meta">
        <span className={`tag ${h.status === "approved" ? "tag-voted" : h.status === "suspended" ? "tag-alert" : ""}`}>{STATUS_LABEL[h.status]}</span>
        {h.organisation && <span className="tag">{h.organisation}</span>}
        <span>{fmt(h.openPolls)} open {h.openPolls === 1 ? "poll" : "polls"} · since {relative(h.createdAt)}</span>
      </div>
      <p style={{ fontWeight: 620 }}>{h.displayName} <span className="hint">· {h.email}</span></p>
      <div className="host-limits">
        <div className="field">
          <label htmlFor={`${id}-p`}>Open polls at once</label>
          <input id={`${id}-p`} className="input" inputMode="numeric" value={maxPolls} onChange={(e) => setMaxPolls(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-v`}>Voters per poll</label>
          <input id={`${id}-v`} className="input" inputMode="numeric" value={maxVoters} onChange={(e) => setMaxVoters(e.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      <div className="admin-q-actions">
        {changed && <button className="btn btn-sm" disabled={busy} onClick={() => save(h.status)}>Save limits</button>}
        {h.status !== "approved" && <button className="btn btn-sm" disabled={busy} onClick={() => save("approved")}>{h.status === "suspended" ? "Restore" : "Approve"}</button>}
        {h.status === "approved" && (
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => save("suspended", `Suspend ${h.displayName}? All their polls stop taking votes and they can't edit them until you restore them.`)}>
            Suspend
          </button>
        )}
        {h.status === "pending" && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => save("rejected")}>Reject</button>}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </article>
  );
}
