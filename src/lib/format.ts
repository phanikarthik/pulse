export function relative(iso: string, now = Date.now()) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  const v = m < 60 ? `${Math.max(1, m)}m` : h < 48 ? `${h}h` : `${d}d`;
  return diff < 0 ? `${v} ago` : `in ${v}`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export const fmt = (n: number) => n.toLocaleString("en");
