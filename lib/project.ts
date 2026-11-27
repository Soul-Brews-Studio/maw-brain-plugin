/**
 * A brain project: any folder with .brain/brain.json (made by `maw brain init`). The metadata says what to read
 * and how; the built brain lives next to it in .brain/ (gitignored, except brain.json). Every init is listed in
 * ~/.maw/brain/registry.json so `maw brain ls` and `maw brain build --all` can find them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";

export interface BrainConfig {
  name: string;
  created: string;
  inputs: string[];          // relative to the project folder
  kind?: string;             // jsonl | md | dyi | fbposts | source; detected when absent
  gap?: number;              // hours; absent = the source's own default
  chars?: number;
  exclude?: string[];        // folder names the markdown reader skips (on top of .git, node_modules, .brain, wt ...)
  embed?: { url?: string; model?: string };
  serve?: { host?: string; port?: number };
  last_build?: Record<string, unknown>;
}

export const registryPath = () => process.env.MAW_BRAIN_REGISTRY || join(homedir(), ".maw", "brain", "registry.json");
export const cfgPath = (dir: string) => join(dir, ".brain", "brain.json");

/** nearest folder (this one or a parent) with .brain/brain.json */
export function findProject(from = process.cwd()): string | null {
  let d = resolve(from);
  for (;;) {
    if (existsSync(cfgPath(d))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export const readConfig = (dir: string): BrainConfig => JSON.parse(readFileSync(cfgPath(dir), "utf8"));
export const writeConfig = (dir: string, c: BrainConfig) => writeFileSync(cfgPath(dir), JSON.stringify(c, null, 2) + "\n");

export function registry(): string[] {
  try { return JSON.parse(readFileSync(registryPath(), "utf8")).projects ?? []; } catch { return []; }
}
export function register(dir: string) {
  const all = [...new Set([...registry().filter(p => existsSync(cfgPath(p))), resolve(dir)])].sort();
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ projects: all }, null, 2) + "\n");
}

/** a free-looking default port per project: 7740 + the number of projects already registered */
export function nextPort(): number {
  const used = new Set(registry().map(p => { try { return readConfig(p).serve?.port; } catch { return undefined; } }));
  let p = 7740;
  while (used.has(p)) p++;
  return p;
}

export function newConfig(dir: string, o: Partial<BrainConfig>): BrainConfig {
  return { name: o.name || basename(resolve(dir)), created: new Date().toISOString(), inputs: o.inputs?.length ? o.inputs : ["."],
    ...(o.kind ? { kind: o.kind } : {}), ...(o.gap !== undefined ? { gap: o.gap } : {}),
    exclude: o.exclude ?? [], embed: o.embed ?? {}, serve: { host: "127.0.0.1", port: o.serve?.port ?? nextPort() } };
}

export const GITIGNORE = "# maw brain: the built brain holds your text; only the metadata is meant for git\n*\n!.gitignore\n!brain.json\n";
