import type { CommandMeta, Log } from "../lib/command-types";
import { flag } from "../lib/run";

export const meta: CommandMeta = {
  name: "reload",
  help: "reload [--port=7720] [--host=127.0.0.1]   a running page re-reads its folder after a rebuild (no restart)",
};

export async function run(log: Log, _t: string, args: string[]) {
  const url = `http://${flag(args, "host") || "127.0.0.1"}:${flag(args, "port") || "7720"}/brain/reload`;
  const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(60_000) });
  log(`${url}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  if (!r.ok) throw new Error("reload failed");
}
