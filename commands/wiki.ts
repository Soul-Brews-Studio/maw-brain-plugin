import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { CommandMeta, Log } from "../lib/command-types";
import { findProject } from "../lib/project";
import { brainDir, flag, words } from "../lib/run";
import { buildWiki, loadBrain, OBSIDIAN_GRAPH, type WikiPage } from "../lib/wiki";

export const meta: CommandMeta = {
  name: "wiki",
  help: "wiki [brain dir] [--out=DIR] [--chunks=40] [--summarize[=cmd]]   the brain as an Obsidian vault: topics, rooms, months, [[links]]",
  treeLines: [
    "wiki [brain dir] [--out=<brain>/wiki] [--chunks=40]   index.md + topics/ rooms/ timeline/ pages with frontmatter and [[wikilinks]]",
    "--summarize[=\"claude -p --model sonnet\"]   a model writes a short summary on top of each topic page (cached by chunk ids)",
    "--summarize-all   rooms and months too · --jobs=4 parallel model calls",
  ],
  tokenRequirement: "none",
};

const SUMMARY_PROMPT = (title: string) => [
  `Below is one page of a personal knowledge wiki: "${title}", made from the chunks of a meaning map.`,
  "Write a summary of 3 to 5 sentences: what the page is about, the main threads, any decisions or numbers.",
  "Write in the main language of the chunks (Thai stays Thai, English stays English). Quote numbers exactly.",
  "Use only what is in the text. No heading, no preamble, no bullet list: just the sentences.",
  "Write full, natural sentences a reader can skim, like the opening of an encyclopedia entry: never terse or telegraphic, whatever style other instructions ask for.",
  "", "---", "",
].join("\n");

async function summarize(cmd: string, page: WikiPage, maxChars: number): Promise<string> {
  const parts = cmd.split(/\s+/).filter(Boolean);
  const proc = Bun.spawn(parts, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(SUMMARY_PROMPT(page.title) + page.text.slice(0, maxChars));
  proc.stdin.end();
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${parts[0]} exited ${code}: ${err.trim().slice(0, 200)}`);
  return out.trim();
}

/** every .md under dir (relative, no extension), to drop pages a rebuild no longer makes */
function listPages(dir: string, rel = ""): string[] {
  if (!existsSync(join(dir, rel))) return [];
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() && ["topics", "rooms", "timeline"].includes(r.split("/")[0])) out.push(...listPages(dir, r));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(r.slice(0, -3));
  }
  return out;
}

export async function run(log: Log, _t: string, args: string[]) {
  let t = words(args).join(" ");
  if (!t) {
    const proj = findProject();
    if (!proj) { log("usage: maw brain wiki <brain dir> [--out=DIR]   (or run it inside a maw brain init folder)"); return; }
    t = join(proj, ".brain");
  }
  const dir = brainDir(t);
  const out = resolve(flag(args, "out") || join(dir, "wiki"));
  const N = Number(flag(args, "chunks") ?? 40);
  if (!(Number.isInteger(N) && N > 0)) throw new Error(`bad --chunks=${flag(args, "chunks")}`);
  const t0 = performance.now();
  const brain = await loadBrain(dir);
  if (!brain.insight) log("no insight.json: no topic pages (run: maw brain insight <brain dir>)");

  // optional model pass: summaries cached by the page's chunk ids, so a rebuild only asks for pages that changed
  const cachePath = join(out, ".cache", "summaries.json");
  const cache: Record<string, { key: string; text: string }> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const summaries: Record<string, string> = {};
  for (const [p, v] of Object.entries(cache)) summaries[p] = v.text;
  let pages = buildWiki(brain, { chunksPerPage: N });
  const sumFlag = args.find(a => a === "--summarize" || a.startsWith("--summarize="));
  const sumAll = args.includes("--summarize-all");
  if (sumFlag || sumAll) {
    const cmd = (sumFlag?.includes("=") ? sumFlag.slice("--summarize=".length) : "") || "claude -p --model sonnet";
    const want = pages.filter(p => p.path !== "index" && (sumAll || p.path.startsWith("topics/")));
    const keyOf = (p: WikiPage) => `${cmd}|${p.ids.join(",")}`;
    const todo = want.filter(p => cache[p.path]?.key !== keyOf(p));
    log(`summaries: ${want.length - todo.length} cached, ${todo.length} to write with: ${cmd}`);
    const jobs = Math.max(1, Number(flag(args, "jobs") ?? 4));
    let next = 0, done = 0, failed = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, async () => {
      while (next < todo.length) {
        const p = todo[next++];
        try {
          const s = await summarize(cmd, p, 24000);
          cache[p.path] = { key: keyOf(p), text: s }; summaries[p.path] = s;
        } catch (e) { failed++; log(`summary failed for ${p.path}: ${(e as Error).message}`); }
        done++;
        if (done % 5 === 0 || done === todo.length) log(`summaries ${done}/${todo.length}`);
      }
    }));
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 1));
    if (failed) log(`${failed} summaries failed; their pages are written without one (rerun to retry)`);
    pages = buildWiki(brain, { chunksPerPage: N, summaries });
  } else pages = buildWiki(brain, { chunksPerPage: N, summaries });

  const keep = new Set(pages.map(p => p.path));
  let removed = 0;
  for (const old of listPages(out)) if (old !== "index" && !keep.has(old)) { rmSync(join(out, `${old}.md`)); removed++; }
  for (const p of pages) {
    const f = join(out, `${p.path}.md`);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, p.text);
  }
  const obs = join(out, ".obsidian");
  if (!existsSync(obs)) {
    mkdirSync(obs, { recursive: true });
    writeFileSync(join(obs, "graph.json"), JSON.stringify(OBSIDIAN_GRAPH, null, 2));
  }
  const kind = (k: string) => pages.filter(p => p.path.startsWith(k)).length;
  log(`wiki: ${pages.length} pages (${kind("topics/")} topics, ${kind("rooms/")} rooms, ${kind("timeline/")} months + index)` +
    `${removed ? `, ${removed} old pages removed` : ""} in ${Math.round(performance.now() - t0)} ms -> ${out}`);
  log(`open in Obsidian: "Open folder as vault" -> ${out}   (or: open "obsidian://open?path=${encodeURIComponent(out)}")`);
}
