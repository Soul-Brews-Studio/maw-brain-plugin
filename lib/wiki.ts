/**
 * wiki — a built brain written out as a folder of markdown pages that Obsidian (or any wiki) opens as a vault.
 *
 *   index.md                 the brain at a glance: counts, every topic, every room, every month
 *   topics/T<id> <label>.md  one page per topic: keywords, stats, related topics (by meaning and by shared links),
 *                            rooms, months, then the chunks closest to the topic's centre first
 *   rooms/<room>.md          one page per room: its topics, its months, its chunks newest first
 *   timeline/<YYYY-MM>.md    one page per month: what was active (topics, rooms) and the chunks of that month
 *
 * Every page has YAML frontmatter (type, counts, first/last day, tags) and [[wikilinks]] between topics, rooms and
 * months, so Obsidian's graph and backlinks show the brain's structure. Nothing here calls a model; summaries are an
 * optional pass on top (commands/wiki.ts --summarize), cached by the chunk ids a page holds.
 *
 * The text is whatever the brain was built from (notes, posts, chat): the vault is as private as the brain.
 */
import { existsSync } from "fs";
import { join } from "path";

const TZ = "Asia/Bangkok";
const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
const month = (ms: number) => day(ms).slice(0, 7);
const hm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const NOISE = 65535;

export interface WikiBrain {
  meta: any;
  insight: any | null;
  points: any[];            // [start_ms, end_ms, thread|null, [[ms, who, text, bot], ...]]
  grp: Uint32Array;
  topic: Uint16Array | null;
  vec: Int8Array | null;    // n x dim, for topic centroids
  knn: Uint32Array | null;  // n x k nearest neighbours
}

export async function loadBrain(dir: string): Promise<WikiBrain> {
  const f = (n: string) => join(dir, n);
  if (!existsSync(f("meta.json"))) throw new Error(`${dir}: no meta.json — run 'maw brain build' first`);
  const meta = await Bun.file(f("meta.json")).json();
  const bin = async <T>(n: string, C: new (b: ArrayBuffer) => T) => (existsSync(f(n)) ? new C(await Bun.file(f(n)).arrayBuffer()) : null);
  const points: any[] = new Array(meta.n);
  for (let s = 0; s < Math.ceil(meta.n / meta.shard); s++) {
    const part: any[] = await Bun.file(join(dir, "p", `${s}.json`)).json();
    part.forEach((p, j) => (points[s * meta.shard + j] = p));
  }
  return {
    meta, points,
    insight: existsSync(f("insight.json")) ? await Bun.file(f("insight.json")).json() : null,
    grp: (await bin("grp.u32", Uint32Array))!,
    topic: await bin("topic.u16", Uint16Array),
    vec: await bin("vec.i8", Int8Array),
    knn: await bin("knn.u32", Uint32Array),
  };
}

/** a file name Obsidian accepts and links by: no path or link characters, short */
export function slug(s: string, max = 80): string {
  const t = s.replace(/^#+/, "").replace(/[\\/:*?"<>|#^\[\]{}`]+/g, "-").replace(/\s+/g, " ").replace(/-{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "");
  return (t || "untitled").slice(0, max).trim();
}

/** c-TF-IDF keywords as Obsidian tags (kw/<word>): letters, digits, - and _ only, never all digits */
export const kwTags = (kws: string[]) => kws.slice(0, 6).map(k => k.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, ""))
  .filter(k => k && !/^\d+$/.test(k)).map(k => `kw/${k}`);

const yaml = (o: Record<string, unknown>) => ["---", ...Object.entries(o).filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(x => JSON.stringify(String(x))).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : v}`), "---", ""].join("\n");

export interface WikiOptions {
  chunksPerPage?: number;              // chunk text shown on topic / room / month pages (default 40)
  summaries?: Record<string, string>;  // page path -> summary text (from the optional model pass)
}

export interface WikiPage { path: string; text: string; ids: number[]; title: string }

export function buildWiki(b: WikiBrain, opt: WikiOptions = {}): WikiPage[] {
  const N = opt.chunksPerPage ?? 40;
  const { meta, points, grp } = b;
  const n = meta.n as number;
  const servers = meta.servers || [];
  const roomName = (gi: number) => {
    const g = meta.groups[gi];
    return (servers.length > 1 ? `${servers[g.server]?.name} › ` : "") + g.title;
  };
  const roomPage = meta.groups.map((_: any, gi: number) => `rooms/${slug(roomName(gi))}`);
  // two rooms whose names slug the same get a number, so links stay unique
  const seen = new Map<string, number>();
  roomPage.forEach((p: string, gi: number) => { const k = p.toLowerCase(); const c = seen.get(k) ?? 0; seen.set(k, c + 1); if (c) roomPage[gi] = `${p} ${c + 1}`; });
  const topics: any[] = b.insight?.topics ?? [];
  const topicPage = new Map<number, string>(topics.map(t => [t.id, `topics/T${t.id} ${slug(t.label, 60)}`]));
  const link = (p: string, alias?: string) => `[[${p}${alias ? `|${alias}` : ""}]]`;
  const tlink = (p: string, alias: string) => `[[${p}\\|${alias.replace(/\|/g, "/")}]]`;   // inside a table the | must be escaped
  const tname = (id: number) => topics.find(t => t.id === id)?.label ?? `topic ${id}`;

  const tOf = (i: number) => (b.topic ? b.topic[i] : NOISE);
  const members = new Map<number, number[]>();
  const byRoom = new Map<number, number[]>();
  const byMonth = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const t = tOf(i);
    if (t !== NOISE && topicPage.has(t)) (members.get(t) ?? members.set(t, []).get(t)!).push(i);
    (byRoom.get(grp[i]) ?? byRoom.set(grp[i], []).get(grp[i])!).push(i);
    const m = month(points[i][0]);
    (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(i);
  }
  const count = <K>(ids: number[], key: (i: number) => K | null) => {
    const c = new Map<K, number>();
    for (const i of ids) { const k = key(i); if (k !== null) c.set(k, (c.get(k) ?? 0) + 1); }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  };
  const topicKey = (i: number) => { const t = tOf(i); return t !== NOISE && topicPage.has(t) ? t : null; };

  // related topics: cosine between topic centroids (mean of the chunk vectors) and links shared on the map (knn edges)
  const related = new Map<number, { id: number; cos: number; links: number }[]>();
  if (topics.length > 1) {
    const dim = meta.dim as number;
    const cent = new Map<number, Float32Array>();
    if (b.vec) for (const [t, ids] of members) {
      const c = new Float32Array(dim);
      for (const i of ids) for (let d = 0; d < dim; d++) c[d] += b.vec[i * dim + d];
      let s = 0; for (let d = 0; d < dim; d++) s += c[d] * c[d];
      s = Math.sqrt(s) || 1; for (let d = 0; d < dim; d++) c[d] /= s;
      cent.set(t, c);
    }
    const edges = new Map<string, number>();
    const k = meta.k as number;
    if (b.knn && k) for (let i = 0; i < n; i++) {
      const a = topicKey(i); if (a === null) continue;
      for (let j = 0; j < k; j++) {
        const o = b.knn[i * k + j]; if (o >= n) continue;
        const t2 = topicKey(o); if (t2 === null || t2 === a) continue;
        const key = a < t2 ? `${a}:${t2}` : `${t2}:${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const t of members.keys()) {
      const rows: { id: number; cos: number; links: number }[] = [];
      for (const u of members.keys()) {
        if (u === t) continue;
        const a = cent.get(t), c = cent.get(u);
        let cos = 0; if (a && c) for (let d = 0; d < a.length; d++) cos += a[d] * c[d];
        rows.push({ id: u, cos: Math.round(cos * 1000) / 1000, links: edges.get(t < u ? `${t}:${u}` : `${u}:${t}`) ?? 0 });
      }
      rows.sort((x, y) => y.links - x.links || y.cos - x.cos);
      related.set(t, rows.slice(0, 6));
    }
  }

  // documents (gap ~0: one point per section) show the file a section came from; chat shows time + who
  const doc = (meta.unit?.gap_hours ?? 3) < 0.01;
  const quote = (s: string) => s.split("\n").map(l => `> ${l}`).join("\n");
  const chunk = (i: number) => {
    const [start, end, thread, lines] = points[i];
    const t = topicKey(i);
    const head = `#### ${day(start)}${day(end) !== day(start) ? ` → ${day(end)}` : ""} · ${link(roomPage[grp[i]], roomName(grp[i]))}${thread ? ` › ${thread}` : ""}${t !== null ? ` · ${link(topicPage.get(t)!, `T${t}`)}` : ""} · #${i}`;
    const body = lines.map(([ms, who, text, bot]: any[]) => doc
      ? `*${who}*\n${String(text)}` : `**${hm(ms)} ${who}${bot ? " (bot)" : ""}:** ${String(text)}`).join("\n");
    return `${head}\n${quote(body)}`;
  };
  const chunks = (ids: number[], label: string) => {
    const shown = ids.slice(0, N);
    return [`## ${label}`, "", `${shown.length} of ${ids.length} shown.`, "", ...shown.map(i => chunk(i) + "\n")].join("\n");
  };
  const span = (ids: number[]) => {
    let a = Infinity, z = -Infinity;
    for (const i of ids) { a = Math.min(a, points[i][0]); z = Math.max(z, points[i][1]); }
    return ids.length ? [day(a), day(z)] : ["", ""];
  };
  const summary = (path: string) => opt.summaries?.[path] ? ["## Summary", "", opt.summaries[path].trim(), "", "_Summary written by a language model from the chunks on this page._", ""] : [];
  const pages: WikiPage[] = [];

  for (const t of topics) {
    const ids = members.get(t.id) ?? [];
    if (!ids.length) continue;
    const path = topicPage.get(t.id)!;
    const rep: number[] = (t.representative ?? []).filter((i: number) => tOf(i) === t.id);
    const order = [...rep, ...ids.filter(i => !rep.includes(i)).sort((a, c) => points[c][1] - points[a][1])];
    const [first, last] = span(ids);
    const rooms = count(ids, i => grp[i]);
    const months = count(ids, i => month(points[i][0])).sort((a, c) => a[0] < c[0] ? -1 : 1);
    pages.push({ path, title: `T${t.id} ${t.label}`, ids: order.slice(0, N), text: [
      yaml({ type: "topic", topic: t.id, label: t.label, keywords: t.keywords, chunks: ids.length, first, last, rising: t.rising, tags: ["brain/topic", ...kwTags(t.keywords)] }),
      `# T${t.id} · ${t.label}`, "",
      `**Keywords:** ${t.keywords.join(", ")}`, "",
      `${ids.length} chunks · ${first} → ${last}${t.rising !== undefined ? ` · rising ×${t.rising}` : ""} · back to ${link("index", "index")}`, "",
      ...summary(path),
      "## Related topics", "",
      ...(related.get(t.id)?.length ? ["| topic | links on the map | meaning (cosine) |", "|---|---:|---:|",
        ...related.get(t.id)!.map(r => `| ${tlink(topicPage.get(r.id)!, `T${r.id} ${tname(r.id)}`)} | ${r.links} | ${r.cos} |`)] : ["(none)"]), "",
      "## Rooms", "", ...rooms.map(([g, c]) => `- ${link(roomPage[g], roomName(g))} (${c})`), "",
      "## Months", "", months.map(([m, c]) => `${link(`timeline/${m}`, m)} (${c})`).join(" · "), "",
      chunks(order, "Chunks (closest to the topic's centre first)"),
    ].join("\n") });
  }

  meta.groups.forEach((g: any, gi: number) => {
    const ids = (byRoom.get(gi) ?? []).sort((a, c) => points[c][1] - points[a][1]);
    if (!ids.length) return;
    const path = roomPage[gi];
    const [first, last] = span(ids);
    const tp = count(ids, topicKey);
    const months = count(ids, i => month(points[i][0])).sort((a, c) => a[0] < c[0] ? -1 : 1);
    pages.push({ path, title: roomName(gi), ids: ids.slice(0, N), text: [
      yaml({ type: "room", room: roomName(gi), chunks: ids.length, first, last, tags: ["brain/room"] }),
      `# ${roomName(gi)}`, "", `${ids.length} chunks · ${first} → ${last} · back to ${link("index", "index")}`, "",
      ...summary(path),
      "## Topics", "", ...(tp.length ? tp.map(([t, c]) => `- ${link(topicPage.get(t)!, `T${t} ${tname(t)}`)} (${c})`) : ["(no topic)"]), "",
      "## Months", "", months.map(([m, c]) => `${link(`timeline/${m}`, m)} (${c})`).join(" · "), "",
      chunks(ids, "Chunks (newest first)"),
    ].join("\n") });
  });

  const monthKeys = [...byMonth.keys()].sort();
  monthKeys.forEach((m, mi) => {
    const ids = byMonth.get(m)!.sort((a, c) => points[a][0] - points[c][0]);
    const path = `timeline/${m}`;
    const tp = count(ids, topicKey), rooms = count(ids, i => grp[i]);
    const nav = [mi > 0 ? `← ${link(`timeline/${monthKeys[mi - 1]}`, monthKeys[mi - 1])}` : "", link("index", "index"),
      mi < monthKeys.length - 1 ? `${link(`timeline/${monthKeys[mi + 1]}`, monthKeys[mi + 1])} →` : ""].filter(Boolean).join(" · ");
    pages.push({ path, title: m, ids: ids.slice(0, N), text: [
      yaml({ type: "month", month: m, chunks: ids.length, tags: ["brain/month"] }),
      `# ${m}`, "", `${ids.length} chunks · ${nav}`, "",
      ...summary(path),
      "## Topics this month", "", ...(tp.length ? tp.slice(0, 15).map(([t, c]) => `- ${link(topicPage.get(t)!, `T${t} ${tname(t)}`)} (${c})`) : ["(no topic)"]), "",
      "## Rooms this month", "", ...rooms.slice(0, 15).map(([g, c]) => `- ${link(roomPage[g], roomName(g))} (${c})`), "",
      chunks(ids, "Chunks (oldest first)"),
    ].join("\n") });
  });

  const name = servers.map((s: any) => s.name).join(" + ") || "brain";
  const c = meta.counts ?? {};
  const noise = b.topic ? Array.from(b.topic).filter(t => t === NOISE).length : n;
  pages.push({ path: "index", title: name, ids: [], text: [
    yaml({ type: "index", brain: name, chunks: n, topics: topics.length, rooms: meta.groups.length, months: monthKeys.length, model: meta.model, built: meta.built, tags: ["brain/index"] }),
    `# ${name}`, "",
    `${n.toLocaleString("en-US")} chunks from ${(c.messages ?? n).toLocaleString("en-US")} ${doc ? "sections" : "messages"} · ${meta.groups.length} rooms · ${topics.length} topics · built ${meta.built} with ${meta.model}`, "",
    "Made by `maw brain wiki` from the brain's own files: topics are HDBSCAN clusters on the meaning map, keywords are c-TF-IDF, related topics count the map's nearest-neighbour links between them.", "",
    ...summary("index"),
    `## Topics (${topics.length}; ${noise} chunks fit none)`, "",
    "| topic | keywords | chunks | first → last | rising |", "|---|---|---:|---|---:|",
    ...topics.filter(t => members.has(t.id)).map(t => { const [a, z] = span(members.get(t.id)!); return `| ${tlink(topicPage.get(t.id)!, `T${t.id} ${t.label}`)} | ${t.keywords.slice(0, 6).join(", ")} | ${members.get(t.id)!.length} | ${a} → ${z} | ${t.rising ?? "-"} |`; }), "",
    "## Rooms", "", ...meta.groups.map((_: any, gi: number) => byRoom.get(gi)?.length ? `- ${link(roomPage[gi], roomName(gi))} (${byRoom.get(gi)!.length})` : null).filter(Boolean), "",
    "## Timeline", "", monthKeys.map(m => `${link(`timeline/${m}`, m)} (${byMonth.get(m)!.length})`).join(" · "), "",
  ].join("\n") });
  return pages;
}

/** Obsidian settings for a fresh vault: graph colours per page type. Written only when the vault has none. */
export const OBSIDIAN_GRAPH = {
  colorGroups: [
    { query: "path:topics", color: { a: 1, rgb: 0xf5a623 } },
    { query: "path:rooms", color: { a: 1, rgb: 0x4a90e2 } },
    { query: "path:timeline", color: { a: 1, rgb: 0x7ed321 } },
  ],
  showTags: false, showAttachments: false, hideUnresolved: true,
};
