/**
 * maw brain — any text as a 3D meaning map. Thin dispatcher: autoloads commands/*.ts, each exporting
 * `meta` (lib/command-types.ts) and `run(log, token, args)`. Adding a command is adding a file.
 */
import { Glob } from "bun";
import type { CommandMeta, CommandRun, Log } from "./lib/command-types";

export const command = { name: "brain", description: "Any text as a 3D meaning map (local only)." };

interface CommandModule { meta: CommandMeta; run: CommandRun }
let cache: CommandModule[] | null = null;

export async function loadCommands(): Promise<CommandModule[]> {
  if (cache) return cache;
  const files: string[] = [];
  for await (const f of new Glob("*.ts").scan({ cwd: `${import.meta.dir}/commands` })) files.push(f);
  const mods: CommandModule[] = [];
  for (const f of files.sort()) {
    const m = await import(`./commands/${f}`);
    if (!m.meta?.name || typeof m.run !== "function") throw new Error(`commands/${f}: must export meta and run`);
    mods.push({ meta: m.meta, run: m.run });
  }
  return (cache = mods);
}

type Ctx = { source?: string; args?: unknown; writer?: (s: string) => void };
type Result = { ok: boolean; output: string; error?: string; exitCode: number };

export default async function handler(ctx: Ctx): Promise<Result> {
  const out: string[] = [];
  const log: Log = s => (ctx.writer ? ctx.writer(s) : out.push(s));
  const done = (ok: boolean): Result => ({ ok, output: ctx.writer ? "" : out.join("\n"), error: ok ? undefined : "", exitCode: ok ? 0 : 1 });
  const args = ctx.source === "cli" ? ((ctx.args as string[]) ?? []) : [];
  const sub = args[0]?.toLowerCase();
  const commands = await loadCommands();
  if (!sub || ["help", "-h", "--help", "--tree", "tree"].includes(sub)) {
    log("maw brain — any text as a 3D meaning map (local only)");
    log("");
    for (const m of commands) for (const line of (sub?.includes("tree") ? m.meta.treeLines ?? [m.meta.help] : m.meta.help.split("\n"))) log(`  ${line}`);
    log("");
    log("  quick: maw brain build notes.jsonl && maw brain serve notes.brain");
    return done(true);
  }
  const mod = commands.find(m => m.meta.name === sub);
  if (!mod) { log(`unknown: ${sub} — run 'maw brain --help'`); return done(false); }
  try { await mod.run(log, "", args); return done(true); }
  catch (e) { log(`error: ${e instanceof Error ? e.message : String(e)}`); return done(false); }
}

if (import.meta.main) {
  const r = await handler({ source: "cli", args: process.argv.slice(2), writer: s => console.log(s) });
  if (!r.ok) process.exit(r.exitCode);
}
