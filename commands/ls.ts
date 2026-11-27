import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { CommandMeta, Log } from "../lib/command-types";
import { cfgPath, readConfig, registry } from "../lib/project";

export const meta: CommandMeta = {
  name: "ls",
  help: "ls [--json]   every folder made a brain project with init: name, kind, points, last build, port",
};

export async function run(log: Log, _t: string, args: string[]) {
  const rows = registry().filter(p => existsSync(cfgPath(p))).map(dir => {
    const c = readConfig(dir);
    const m = existsSync(join(dir, ".brain", "meta.json")) ? JSON.parse(readFileSync(join(dir, ".brain", "meta.json"), "utf8")) : null;
    return { dir, name: c.name, kind: c.kind ?? "", points: m?.n ?? 0, built: m?.built ?? "", port: c.serve?.port ?? 0 };
  });
  if (args.includes("--json")) { log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { log("no brain projects yet — maw brain init <dir>"); return; }
  for (const r of rows)
    log(`${r.name.padEnd(22)} ${r.kind.padEnd(8)} ${String(r.points).padStart(7)} pts  ${(r.built || "not built").slice(0, 16).padEnd(16)}  :${r.port}  ${r.dir}`);
}
