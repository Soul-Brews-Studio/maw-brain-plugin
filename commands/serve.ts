import { startBrain } from "../lib/brain-server";
import type { CommandMeta, Log } from "../lib/command-types";
import { findProject, readConfig } from "../lib/project";
import { brainDir, flag, words } from "../lib/run";
import { join } from "path";

export const meta: CommandMeta = {
  name: "serve",
  help: "serve [brain dir] [--port=7720] [--host=127.0.0.1]   the 3D page: search by meaning, time machine, topics",
  treeLines: [
    "serve <brain dir> [--port=7720] [--host=127.0.0.1|100.x tailscale] [--url=embed URL]",
    "page /brain/ (?q= search, ?t=YYYY-MM-DD time machine) · POST /brain/search, /brain/reload · GET /brain/api/overview|topics|report.md",
  ],
};

export async function run(log: Log, _t: string, args: string[]) {
  let t = words(args).join(" ");
  let conf: { host?: string; port?: number } = {};
  if (!t) {
    const proj = findProject();
    if (!proj) { log("usage: maw brain serve <brain dir> [--port=7720] [--host=127.0.0.1]   (or run it inside a maw brain init folder)"); return; }
    t = join(proj, ".brain"); conf = readConfig(proj).serve ?? {};
  }
  const p = flag(args, "port");
  const port = p === undefined ? (conf.port ?? 7720) : Number(p);
  if (!(Number.isInteger(port) && port >= 0 && port < 65536)) throw new Error(`bad --port=${p}`);
  const b = await startBrain(brainDir(t), { host: flag(args, "host") || conf.host, port, embedUrl: flag(args, "url") });
  log(`brain: ${b.meta.n.toLocaleString()} points, ${b.meta.dim}-d search, model ${b.meta.model}`);
  log(`page: ${b.url}   (ctrl-c to stop)`);
  await new Promise(() => {});
}
