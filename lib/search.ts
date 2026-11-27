/**
 * Search one or many brain folders from the command line, no server: the query is embedded once per
 * (embed server, model, query prompt), scored against each brain's vec.i8 (same math as brain-server.ts),
 * and the hits are merged across brains by cosine. Text is read only for the hits (one shard each).
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_URL } from "./run";

export interface Brain { name: string; dir: string; meta: any; vec: Int8Array; grp: Uint32Array }
export interface Hit { brain: Brain; i: number; score: number }

export function loadBrain(name: string, dir: string): Brain | null {
  if (!existsSync(join(dir, "meta.json")) || !existsSync(join(dir, "vec.i8"))) return null;
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const vec = new Int8Array(readFileSync(join(dir, "vec.i8")).buffer.slice(0));
  const g = readFileSync(join(dir, "grp.u32"));
  return { name, dir, meta, vec, grp: new Uint32Array(g.buffer, g.byteOffset, g.byteLength / 4) };
}

export async function embed(url: string, model: string, prompt: string, q: string, dim: number): Promise<Float32Array> {
  const r = await fetch(`${url.replace(/\/$/, "")}/api/embed`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: `${prompt}${q}` }), signal: AbortSignal.timeout(20_000) });
  const v: number[] | undefined = ((await r.json()) as any)?.embeddings?.[0];
  if (!Array.isArray(v)) throw new Error(`embed server ${url} (${model}) gave no vector — maw brain check`);
  const out = new Float32Array(dim);
  let s = 0;
  for (let d = 0; d < dim; d++) { out[d] = v[d]; s += v[d] * v[d]; }
  s = Math.sqrt(s) || 1;
  for (let d = 0; d < dim; d++) out[d] /= s;
  return out;
}

function topK(b: Brain, q: Float32Array, k: number): Hit[] {
  const { n, dim, scale } = b.meta;
  const hits: Hit[] = [];
  for (let i = 0, o = 0; i < n; i++, o += dim) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += b.vec[o + d] * q[d];
    s /= scale;
    if (hits.length < k || s > hits[hits.length - 1].score) {
      hits.push({ brain: b, i, score: s });
      hits.sort((x, y) => y.score - x.score);
      if (hits.length > k) hits.pop();
    }
  }
  return hits;
}

export async function searchAll(brains: Brain[], q: string, k: number, url?: string): Promise<Hit[]> {
  const qv = new Map<string, Float32Array>();
  let all: Hit[] = [];
  for (const b of brains) {
    const u = url || process.env.BRAIN_EMBED_URL || b.meta.embed_url || DEFAULT_URL;
    const key = `${u}\n${b.meta.model}\n${b.meta.query_prompt}\n${b.meta.dim}`;
    if (!qv.has(key)) qv.set(key, await embed(u, b.meta.model, b.meta.query_prompt, q, b.meta.dim));
    all = all.concat(topK(b, qv.get(key)!, k));
  }
  return all.sort((x, y) => y.score - x.score).slice(0, k);
}

const shards = new Map<string, any[]>();
export function point(b: Brain, i: number): [number, number, string | null, any[][]] {
  const s = Math.floor(i / b.meta.shard), key = `${b.dir}#${s}`;
  if (!shards.has(key)) shards.set(key, JSON.parse(readFileSync(join(b.dir, "p", `${s}.json`), "utf8")));
  return shards.get(key)![i % b.meta.shard];
}

const day = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
export const room = (b: Brain, i: number) => b.meta.groups?.[b.grp[i]]?.title ?? "";
export function hitText(h: Hit): string { return point(h.brain, h.i)[3].map(l => l[2]).join("\n"); }
export function hitHead(h: Hit): string {
  const [start, , thread] = point(h.brain, h.i);
  return `${h.brain.name} · ${room(h.brain, h.i)}${thread ? ` › ${thread}` : ""} · ${day(start)} · #${h.i}`;
}
