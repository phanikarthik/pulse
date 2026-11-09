"use client";
import { useEffect, useId, useState } from "react";
import { fetchDistricts, fetchStateOf, fetchStates, type Place } from "@/lib/places";

/** State, then district. Reports the chosen district's code, or null until one is picked. */
export function PlacePicker({
  value,
  onChange,
  invalid,
  describedBy,
}: {
  value: number | null;
  onChange: (districtCode: number | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const [states, setStates] = useState<Place[] | null>(null);
  const [state, setState] = useState<number | null>(null);
  const [districts, setDistricts] = useState<Place[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetchStates().then(setStates, () => setLoadError("Couldn't load the list of places. Refresh to try again."));
    if (value) fetchStateOf(value).then(setState);
    // Only the starting value pre-fills the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDistricts(null);
    if (state) fetchDistricts(state).then(setDistricts, () => setLoadError("Couldn't load districts. Refresh to try again."));
  }, [state]);

  const a11y = { "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-s`}>State or union territory</label>
        <select id={`${id}-s`} className="select" value={state ?? ""} disabled={!states} {...a11y}
          onChange={(e) => {
            setState(e.target.value ? Number(e.target.value) : null);
            onChange(null);
          }}>
          <option value="">{states ? "Choose…" : "Loading…"}</option>
          {states?.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-d`}>District</label>
        <select id={`${id}-d`} className="select" value={value ?? ""} disabled={!districts} {...a11y}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{!state ? "Choose a state first" : districts ? "Choose…" : "Loading…"}</option>
          {districts?.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </div>
      {loadError && <p className="error-text" role="alert">{loadError}</p>}
    </>
  );
}
