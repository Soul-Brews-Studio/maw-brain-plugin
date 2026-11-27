/** Shared helpers: flags, uv + python runs with live output, what kind of input a path is. */
import { existsSync, readdirSync, statSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import type { Log } from "./command-types";

export const flag = (args: string[], name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
export const words = (args: string[]) => args.slice(1).filter(a => !a.startsWith("--"));

export const SCRIPTS = join(import.meta.dir, "..", "scripts");
export const DEFAULT_URL = process.env.BRAIN_EMBED_URL || process.env.ATLAS_EMBED_URL || "http://127.0.0.1:11445";
export const DEFAULT_MODEL = process.env.BRAIN_EMBED_MODEL || process.env.ATLAS_EMBED_MODEL || "embeddinggemma:ane-w8a16";

export type Kind = "source" | "jsonl" | "md" | "dyi" | "fbposts";

/** source = already a source folder (server.sqlite: from `maw brain from` or `maw atlas download`). */
export function detectKind(p: string): Kind | null {
  if (!existsSync(p)) return null;
  if (statSync(p).isFile()) return [".jsonl", ".ndjson"].includes(extname(p).toLowerCase()) ? "jsonl" : null;
  if (existsSync(join(p, "server.sqlite"))) return "source";
  for (const m of ["inbox", "messages/inbox", "your_facebook_activity/messages/inbox"])
    if (existsSync(join(p, m))) return "dyi";
  for (const m of ["posts", "your_facebook_activity/posts", "comments_and_reactions", "your_facebook_activity/comments_and_reactions"])
    if (existsSync(join(p, m))) return "fbposts";
  const hasMd = (d: string, depth: number): boolean => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isFile() && e.name.toLowerCase().endsWith(".md")) return true;
      if (e.isDirectory() && depth > 0 && !e.name.startsWith(".") && e.name !== "node_modules" && hasMd(join(d, e.name), depth - 1)) return true;
    }
    return false;
  };
  return hasMd(p, 3) ? "md" : null;
}

/** where a brain built from one input goes when --out is not given */
export function defaultOut(input: string, kind: Kind): string {
  const p = resolve(input);
  if (kind === "source") return join(p, "brain");
  const stem = kind === "jsonl" ? basename(p, extname(p)) : basename(p);
  return join(dirname(p), `${stem}.brain`);
}

/** a brain folder: the dir itself (meta.json) or <dir>/brain */
export function brainDir(t: string): string {
  if (existsSync(join(t, "meta.json"))) return resolve(t);
  if (existsSync(join(t, "brain", "meta.json"))) return resolve(t, "brain");
  throw new Error(`${t}: no meta.json here or in ${t}/brain — run 'maw brain build' first`);
}

async function pump(stream: ReadableStream<Uint8Array>, log: Log) {
  const dec = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    rest += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, i);
      rest = rest.slice(i + 1);
      if (!/Warning|warn\(|self\.fit\(|ensure_all_finite/.test(line)) log(line);
    }
  }
  if (rest) log(rest);
}

export async function runLive(cmd: string[], log: Log, what: string) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, PYTHONUNBUFFERED: "1" } });
  await Promise.all([pump(proc.stdout, log), pump(proc.stderr, log)]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${what} exited ${code}`);
}

/** the engine needs numpy, umap-learn, scikit-learn (topics) and pythainlp (Thai words) — uv brings them */
export function engineCmd(rest: string[]): string[] {
  const uv = Bun.which("uv");
  if (!uv) throw new Error("maw brain needs uv (it runs the Python engine with numpy + umap-learn) — https://docs.astral.sh/uv/");
  return [uv, "run", "--quiet", "--no-project", "--python", "3.12", "--with", "numpy", "--with", "umap-learn", "--with", "scikit-learn",
    "--with", "pythainlp", "python", "-I", "-W", "ignore", join(SCRIPTS, "brain-engine.py"), ...rest];
}

/** the converters are standard library only: any python3 runs them */
export function sourceCmd(rest: string[]): string[] {
  const py = Bun.which("python3");
  if (!py) throw new Error("maw brain needs python3");
  return [py, "-I", join(SCRIPTS, "brain-source.py"), ...rest];
}

export async function convert(kind: Exclude<Kind, "source">, input: string, out: string, args: string[], log: Log) {
  const allow: Record<string, string[]> = { jsonl: ["name"], md: ["name", "group", "chars"], dyi: ["name", "since", "min-messages", "sources"], fbposts: ["name", "since"] };
  const pass: string[] = [];
  for (const k of allow[kind]) { const v = flag(args, k); if (v !== undefined) pass.push(`--${k}`, v); }
  await runLive(sourceCmd([kind, resolve(input), resolve(out), ...pass]), log, "brain-source.py");
}
