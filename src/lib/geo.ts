"use client";
/** Location for questions limited to a place (geofence). The position is sent for the check only. */

export type Geofence = { lat: number; lng: number; radiusM: number; label: string };
export type Position = { lat: number; lng: number; accuracy: number };

export const RADIUS_CHOICES = [200, 500, 1000, 2000, 5000, 10000, 25000, 50000];

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/** The device's current position, with messages people can act on when it fails. */
export function getPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser can't share your location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "Location is blocked for this site. Allow location in your browser's site settings, then try again."
              : e.code === e.TIMEOUT
                ? "Finding your location took too long. Try again, ideally near a window or outdoors."
                : "Couldn't find your location. Check that location is turned on for your phone.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  });
}
