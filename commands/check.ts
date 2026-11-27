import type { CommandMeta, Log } from "../lib/command-types";
import { DEFAULT_MODEL, DEFAULT_URL, flag } from "../lib/run";

export const meta: CommandMeta = {
  name: "check",
  help: "check [--url=URL] [--model=M]   uv, python3 and the embed server answer? (prints the vector size)",
};

export async function run(log: Log, _t: string, args: string[]) {
  let ok = true;
  for (const b of ["uv", "python3"]) {
    const w = Bun.which(b);
    log(`${w ? "ok " : "NO "} ${b}${w ? `  ${w}` : b === "uv" ? "  install: https://docs.astral.sh/uv/" : ""}`);
    ok &&= !!w;
  }
  const url = (flag(args, "url") || DEFAULT_URL).replace(/\/$/, "");
  const model = flag(args, "model") || DEFAULT_MODEL;
  try {
    const t = performance.now();
    const r = await fetch(`${url}/api/embed`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: ["title: none | text: hello brain"] }), signal: AbortSignal.timeout(30_000) });
    const j: any = await r.json();
    const dim = j?.embeddings?.[0]?.length;
    if (!r.ok || !dim) throw new Error(`HTTP ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
    log(`ok  embed ${url} ${model}: ${dim} dims in ${Math.round(performance.now() - t)} ms`);
  } catch (e) {
    ok = false;
    log(`NO  embed ${url} ${model}: ${e instanceof Error ? e.message : e}`);
    log("    Apple Silicon: Chippy (ANE) on :11445 · anywhere: ollama pull embeddinggemma, then --url=http://127.0.0.1:11434 --model=embeddinggemma");
  }
  if (!ok) throw new Error("not ready");
}
