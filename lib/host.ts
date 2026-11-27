/** 127.0.0.1 / localhost / ::1, or a tailscale address (100.64.0.0/10) — never a public bind. From maw-atlas lib/viewer.ts. */
export function allowedHost(host: string): boolean {
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return true;
  const m = host.match(/^100\.(\d+)\.\d+\.\d+$/);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}
