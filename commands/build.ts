import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import type { CommandMeta, Log } from "../lib/command-types";
import { convert, DEFAULT_MODEL, DEFAULT_URL, defaultOut, detectKind, engineCmd, flag, runLive, words } from "../lib/run";

export const meta: CommandMeta = {
  name: "build",
  help: "build <input>... [--out=DIR]   JSONL file, markdown folder, Facebook export or source folder -> brain folder",
  treeLines: [
    "build <input>... [--out=DIR]   chunks -> vectors (cached) -> UMAP 3D -> 4 nearest links -> topics; several inputs = one map (--out required)",
    "input kind is detected: *.jsonl, a folder with server.sqlite, a Facebook export (messages/inbox, or posts/comments_and_reactions for fbposts), a folder of *.md; force with --kind=",
    "--gap=H (from the source: 0.0001 for documents = one point each, 3 for chat) --chars=1200 --min-chars=40",
    `--url=URL --model=M   embed server, Ollama-style /api/embed (default ${DEFAULT_URL} ${DEFAULT_MODEL})`,
  ],
};

export async function run(log: Log, _t: string, args: string[]) {
  const inputs = words(args);
  if (!inputs.length) {
    log("usage: maw brain build <input>... [--out=DIR] [--gap=H] [--url=URL] [--model=M]");
    return;
  }
  const forced = flag(args, "kind") as any;
  const kinds = inputs.map(i => {
    const k = forced || detectKind(i);
    if (!k) throw new Error(`${i}: not a .jsonl file, a source folder, a Facebook export or a folder of .md files`);
    return k;
  });
  const out = resolve(flag(args, "out") || (inputs.length === 1 ? defaultOut(inputs[0], kinds[0]) : ""));
  if (out === resolve("")) throw new Error("several inputs make one map — say where it goes: --out=DIR");
  const sources: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    if (kinds[i] === "source") { sources.push(resolve(inputs[i])); continue; }
    const src = join(out, inputs.length === 1 ? "source" : `source-${i + 1}`);
    log(`${kinds[i]}: ${inputs[i]} -> ${src}`);
    await convert(kinds[i], inputs[i], src, args, log);
    sources.push(src);
  }
  let gap = flag(args, "gap");
  if (gap === undefined) {
    const sj = join(sources[0], "server.json");
    const g = existsSync(sj) ? JSON.parse(readFileSync(sj, "utf8"))?.brain?.gap : undefined;
    gap = String(g ?? 3);
  }
  const pass = ["--out", out, "--gap", gap, "--url", flag(args, "url") || DEFAULT_URL, "--model", flag(args, "model") || DEFAULT_MODEL];
  for (const k of ["chars", "min-chars"]) { const v = flag(args, k); if (v !== undefined) pass.push(`--${k}`, v); }
  log(`brain -> ${out} (gap ${gap} h)`);
  await runLive(engineCmd(["build", ...sources, ...pass]), log, "brain-engine.py build");
  log(`serve it: maw brain serve ${out}`);
}
