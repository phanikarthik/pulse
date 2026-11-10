"use client";
import "leaflet/dist/leaflet.css";
import type { Circle, CircleMarker, Map as LeafletMap } from "leaflet";
import { useEffect, useId, useRef, useState } from "react";
import { fmtDistance, getPosition, RADIUS_CHOICES, type Geofence } from "@/lib/geo";

type Spot = { lat: number; lng: number };
type Found = { lat: number; lng: number; name: string; full: string };

const INDIA: Spot = { lat: 22.5, lng: 79 };

/**
 * Pick a circle on an OpenStreetMap map: click the map, search for a place, or use your own
 * location; then a radius and the place name voters will see. Reports the finished geofence,
 * or null with `incomplete` while something is missing.
 */
export function GeofencePicker({
  value,
  onChange,
}: {
  value: Geofence | null;
  onChange: (geo: Geofence | null, incomplete: boolean) => void;
}) {
  const id = useId();
  const [centre, setCentre] = useState<Spot | null>(value ? { lat: value.lat, lng: value.lng } : null);
  const [radius, setRadius] = useState(value?.radiusM ?? 500);
  const [label, setLabel] = useState(value?.label ?? "");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<{ map: LeafletMap; circle: Circle; dot: CircleMarker } | null>(null);

  // Report the result upwards whenever it changes.
  useEffect(() => {
    const done = centre && label.trim();
    onChange(done ? { lat: centre.lat, lng: centre.lng, radiusM: radius, label: label.trim() } : null, !done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre, radius, label]);

  // Leaflet touches `window`, so it loads in the browser only.
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !mapEl.current || map.current) return;
      const start = centre ?? INDIA;
      const m = L.map(mapEl.current, { scrollWheelZoom: false }).setView([start.lat, start.lng], centre ? 15 : 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(m);
      // Invisible until a centre is chosen.
      const shown = centre ? 1 : 0;
      const style = { color: "#e63e5c", weight: 2, opacity: shown };
      const circle = L.circle([start.lat, start.lng], { ...style, radius, fillOpacity: 0.12 * shown }).addTo(m);
      const dot = L.circleMarker([start.lat, start.lng], { ...style, radius: 6, fillOpacity: shown }).addTo(m);
      m.on("click", (e) => setCentre({ lat: e.latlng.lat, lng: e.latlng.lng }));
      map.current = { map: m, circle, dot };
    });
    return () => {
      cancelled = true;
      map.current?.map.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the circle in step with the centre and radius.
  useEffect(() => {
    const m = map.current;
    if (!m || !centre) return;
    m.circle.setLatLng([centre.lat, centre.lng]).setRadius(radius).setStyle({ opacity: 1, fillOpacity: 0.12 });
    m.dot.setLatLng([centre.lat, centre.lng]).setStyle({ opacity: 1, fillOpacity: 1 });
  }, [centre, radius]);

  const flyTo = (s: Spot) => {
    setCentre(s);
    map.current?.map.setView([s.lat, s.lng], radius > 5000 ? 11 : radius > 1000 ? 13 : 15);
  };

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&q=${encodeURIComponent(query.trim())}`;
      const rows = (await (await fetch(url, { headers: { Accept: "application/json" } })).json()) as {
        lat: string; lon: string; name: string; display_name: string;
      }[];
      setFound(rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), name: r.name || r.display_name.split(",")[0], full: r.display_name })));
    } catch {
      setError("Search isn't working right now. Click the map instead.");
    }
    setBusy(false);
  };

  const useMine = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await getPosition();
      flyTo({ lat: p.lat, lng: p.lng });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="geo-picker">
      <div className="geo-search">
        <label htmlFor={`${id}-q`} className="sr-only">Search for a place</label>
        <input id={`${id}-q`} className="input" placeholder="Search a place, e.g. Town Hall Mysuru" value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
        <button type="button" className="btn btn-sm" disabled={busy} onClick={search}>Find</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={useMine}>Use my location</button>
      </div>
      {found && (
        found.length === 0 ? <p className="hint">No places found. Try another name, or click the map.</p> : (
          <ul className="geo-results">
            {found.map((f, i) => (
              <li key={i}>
                <button type="button" className="link-btn" onClick={() => { flyTo(f); if (!label.trim()) setLabel(f.name.slice(0, 60)); setFound(null); }}>
                  {f.full}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <div ref={mapEl} className="geo-map" role="application" aria-label="Map: click to set the centre of the voting area" />
      <p className="hint">{centre ? `Centre set (${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}). Click the map to move it.` : "Click the map to set the centre."}</p>
      <div className="host-limits">
        <div className="field">
          <label htmlFor={`${id}-r`}>Radius</label>
          <select id={`${id}-r`} className="select" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {RADIUS_CHOICES.map((r) => <option key={r} value={r}>{fmtDistance(r)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-l`}>Place name voters see</label>
          <input id={`${id}-l`} className="input" maxLength={60} placeholder="e.g. Town Hall, Mysuru" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="hint">
        Voters share their location when they vote; Pulse checks the distance and keeps nothing. Locations are approximate
        indoors and can be faked by a determined person, so use at least 200 m and don&apos;t rely on it for anything binding.
      </p>
    </div>
  );
}

/** A tick box that opens the picker: for the "new question" and "new live poll" forms. */
export function PlaceLimitField({ onChange }: { onChange: (geo: Geofence | null, incomplete: boolean) => void }) {
  const [on, setOn] = useState(false);
  return (
    <div className="field">
      <label className="checkbox">
        <input type="checkbox" checked={on}
          onChange={(e) => { setOn(e.target.checked); if (!e.target.checked) onChange(null, false); }} />
        <span>Only people near a place can vote</span>
      </label>
      {on && <GeofencePicker value={null} onChange={onChange} />}
    </div>
  );
}

/** Shows a poll's place limit, and lets its owner add, change or remove it. */
export function PlaceLimitEditor({
  geo,
  save,
}: {
  geo: Geofence | null;
  save: (geo: Geofence | null) => Promise<string>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ geo: Geofence | null; incomplete: boolean }>({ geo, incomplete: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (next: Geofence | null) => {
    setBusy(true);
    const err = await save(next);
    setBusy(false);
    setError(err);
    if (!err) setEditing(false);
  };

  if (!editing) {
    return (
      <p className="hint">
        {geo ? `📍 Only within ${fmtDistance(geo.radiusM)} of ${geo.label}. ` : ""}
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>{geo ? "Change place limit" : "Limit to a place"}</button>
      </p>
    );
  }
  return (
    <div className="card admin-form">
      <GeofencePicker value={geo} onChange={(g, incomplete) => setDraft({ geo: g, incomplete })} />
      <div className="admin-q-actions">
        <button type="button" className="btn btn-sm" disabled={busy || draft.incomplete || !draft.geo} onClick={() => run(draft.geo)}>
          Save place limit
        </button>
        {geo && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(null)}>Remove limit</button>}
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
