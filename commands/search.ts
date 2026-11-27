import { existsSync } from "fs";
import { join } from "path";
import type { CommandMeta, Log } from "../lib/command-types";
import { cfgPath, findProject, readConfig, registry } from "../lib/project";
import { flag, words } from "../lib/run";
import { type Brain, hitHead, hitText, loadBrain, searchAll } from "../lib/search";

export const meta: CommandMeta = {
  name: "search",
  help: "search <question> [--all] [--project=a,b] [--k=8] [--md|--json]   by meaning, from anywhere: this project's .brain, or every .brain",
  treeLines: [
    "search <question>   inside a project: its .brain; outside one (or --all): every project in maw brain ls, hits merged by cosine",
    "--project=a,b  only these (names from ls) · --k=8 · --md  LLM-ready context (full chunk text, --chars=6000 budget) · --json",
    "no server needed: reads vec.i8 + text shards directly; the question is embedded once per embed server + model",
  ],
};

export async function run(log: Log, _t: string, args: string[]) {
  const q = words(args).join(" ").trim();
  if (!q) { log("usage: maw brain search <question> [--all] [--project=name] [--k=8] [--md|--json]"); return; }
  const k = Math.max(1, Number(flag(args, "k") || 8));
  const only = (flag(args, "project") || "").split(",").map(s => s.trim()).filter(Boolean);
  const here = findProject();
  let dirs = only.length || args.includes("--all") || !here ? registry().filter(p => existsSync(cfgPath(p))) : [here];
  const brains: Brain[] = [];
  for (const d of dirs) {
    const c = readConfig(d);
    if (only.length && !only.includes(c.name)) continue;
    const b = loadBrain(c.name, join(d, ".brain"));
    if (b) brains.push(b); else if (only.length || dirs.length === 1) log(`(${c.name}: not built yet — cd ${d} && maw brain build)`);
  }
  if (!brains.length) throw new Error(only.length ? `no built project named ${only.join(", ")} — maw brain ls` : "no built brain to search — maw brain init + build");
  const t0 = performance.now();
  const hits = await searchAll(brains, q, k, flag(args, "url"));
  const ms = Math.round(performance.now() - t0);
  if (args.includes("--json")) {
    log(JSON.stringify({ query: q, brains: brains.map(b => b.name), ms, hits: hits.map(h => ({ brain: h.brain.name, dir: h.brain.dir, i: h.i,
      score: +h.score.toFixed(3), where: hitHead(h), text: hitText(h) })) }, null, 2));
    return;
  }
  if (args.includes("--md")) {
    const budget = Number(flag(args, "chars") || 6000);
    const out = [`# Context for: ${q}`, "", `> From ${brains.length} brain(s): ${brains.map(b => b.name).join(", ")}. Ranked by meaning (cosine). Use only what is here; quote numbers exactly.`, ""];
    let used = 0;
    for (const h of hits) {
      const t = `## ${hitHead(h)} (score ${h.score.toFixed(3)})\n\n${hitText(h)}\n`;
      if (used && used + t.length > budget) break;
      out.push(t); used += t.length;
    }
    log(out.join("\n"));
    return;
  }
  log(`"${q}" in ${brains.length} brain(s) (${brains.map(b => b.name).join(", ")}), ${ms} ms`);
  for (const h of hits) log(`${h.score.toFixed(3)}  ${hitHead(h)}\n       ${hitText(h).replace(/\s+/g, " ").slice(0, 110)}`);
}
