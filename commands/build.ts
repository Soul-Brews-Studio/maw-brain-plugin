import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import type { CommandMeta, Log } from "../lib/command-types";
import { findProject, readConfig, registry, writeConfig, cfgPath } from "../lib/project";
import { convert, DEFAULT_MODEL, DEFAULT_URL, defaultOut, detectKind, engineCmd, flag, runLive, words } from "../lib/run";

export const meta: CommandMeta = {
  name: "build",
  help: "build [input...] [--out=DIR] [--all]   no input = the brain project here (maw brain init); --all = every project",
  treeLines: [
    "build [input...] [--out=DIR]   chunks -> vectors (cached) -> UMAP 3D -> 4 nearest links -> topics; several inputs = one map (--out required)",
    "no input: the nearest .brain/brain.json (this folder or a parent) says what to read; the brain goes to <project>/.brain/",
    "--all: build every project in maw brain ls, one after another",
    "input kind is detected: *.jsonl, a folder with server.sqlite, a Facebook export (messages/inbox, or posts/comments_and_reactions for fbposts), a folder of *.md; force with --kind=",
    "--gap=H (from the source: 0.0001 for documents = one point each, 3 for chat) --chars=1200 --min-chars=40",
    `--url=URL --model=M   embed server, Ollama-style /api/embed (default ${DEFAULT_URL} ${DEFAULT_MODEL})`,
  ],
};

/** flags win over the project's brain.json, which wins over the defaults */
async function buildInputs(log: Log, inputs: string[], args: string[], o: { out?: string; kind?: string; gap?: number; exclude?: string[]; url?: string; model?: string; name?: string }) {
  const forced = (flag(args, "kind") || o.kind) as any;
  const kinds = inputs.map(i => {
    const k = forced || detectKind(i);
    if (!k) throw new Error(`${i}: not a .jsonl file, a source folder, a Facebook export or a folder of .md files`);
    return k;
  });
  const out = resolve(flag(args, "out") || o.out || (inputs.length === 1 ? defaultOut(inputs[0], kinds[0]) : ""));
  if (out === resolve("")) throw new Error("several inputs make one map — say where it goes: --out=DIR");
  const convArgs = [...args];
  if (o.exclude?.length && !flag(args, "exclude")) convArgs.push(`--exclude=${o.exclude.join(",")}`);
  if (o.name && !flag(args, "name")) convArgs.push(`--name=${o.name}`);
  const sources: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    if (kinds[i] === "source") { sources.push(resolve(inputs[i])); continue; }
    const src = join(out, inputs.length === 1 ? "source" : `source-${i + 1}`);
    log(`${kinds[i]}: ${inputs[i]} -> ${src}`);
    await convert(kinds[i], inputs[i], src, convArgs, log);
    sources.push(src);
  }
  let gap = flag(args, "gap") ?? (o.gap !== undefined ? String(o.gap) : undefined);
  if (gap === undefined) {
    const sj = join(sources[0], "server.json");
    const g = existsSync(sj) ? JSON.parse(readFileSync(sj, "utf8"))?.brain?.gap : undefined;
    gap = String(g ?? 3);
  }
  const pass = ["--out", out, "--gap", gap, "--url", flag(args, "url") || o.url || DEFAULT_URL, "--model", flag(args, "model") || o.model || DEFAULT_MODEL];
  for (const k of ["chars", "min-chars"]) { const v = flag(args, k); if (v !== undefined) pass.push(`--${k}`, v); }
  log(`brain -> ${out} (gap ${gap} h)`);
  await runLive(engineCmd(["build", ...sources, ...pass]), log, "brain-engine.py build");
  return out;
}

async function buildProject(log: Log, dir: string, args: string[]) {
  const c = readConfig(dir);
  log(`== ${c.name}  (${dir})`);
  const out = await buildInputs(log, c.inputs.map(i => resolve(dir, i)), args,
    { out: join(dir, ".brain"), kind: c.kind, gap: c.gap, exclude: c.exclude, url: c.embed?.url, model: c.embed?.model, name: c.name });
  const m = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
  c.last_build = { built: m.built, ...m.counts };
  writeConfig(dir, c);
  log(`serve it: cd ${dir} && maw brain serve   (port ${c.serve?.port ?? 7720})`);
}

export async function run(log: Log, _t: string, args: string[]) {
  if (args.includes("--all")) {
    const all = registry().filter(p => existsSync(cfgPath(p)));
    if (!all.length) { log("no brain projects — maw brain init <dir>"); return; }
    const failed: string[] = [];
    for (const d of all) { try { await buildProject(log, d, args); } catch (e) { failed.push(d); log(`failed ${d}: ${e instanceof Error ? e.message : e}`); } }
    log(`built ${all.length - failed.length} of ${all.length}`);
    if (failed.length) throw new Error(`${failed.length} failed`);
    return;
  }
  const inputs = words(args);
  if (!inputs.length) {
    const dir = findProject();
    if (!dir) { log("usage: maw brain build <input>... [--out=DIR]   (or maw brain init here first, then maw brain build)"); return; }
    return buildProject(log, dir, args);
  }
  const out = await buildInputs(log, inputs, args, {});
  log(`serve it: maw brain serve ${out}`);
}
