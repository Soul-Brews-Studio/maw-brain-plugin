import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import handler from "../index";
import { buildWiki, loadBrain, slug } from "../lib/wiki";

// 4 chunks, 2 rooms (one with a slash in its name), 2 topics + 1 chunk in no topic, 2 months
const dir = mkdtempSync(join(tmpdir(), "maw-brain-wiki-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const oct = Date.UTC(2026, 9, 5), nov = Date.UTC(2026, 10, 20);
writeFileSync(join(dir, "meta.json"), JSON.stringify({ n: 4, k: 1, dim: 2, scale: 127, shard: 64, model: "m", built: "2026-11-27",
  unit: { gap_hours: 3 }, counts: { points: 4, messages: 5, rooms: 2 },
  groups: [{ title: "#general", server: 0 }, { title: "#notes/2026-11", server: 0 }], servers: [{ name: "test" }] }));
writeFileSync(join(dir, "vec.i8"), new Int8Array([127, 0, 120, 10, 0, 127, 5, 120]));
writeFileSync(join(dir, "grp.u32"), new Uint32Array([0, 0, 1, 1]));
writeFileSync(join(dir, "topic.u16"), new Uint16Array([0, 0, 1, 65535]));
writeFileSync(join(dir, "knn.u32"), new Uint32Array([1, 2, 3, 2]));
writeFileSync(join(dir, "insight.json"), JSON.stringify({ overview: {}, topics: [
  { id: 0, label: "beer · hops", keywords: ["beer", "hops"], representative: [1], rising: 0.5 },
  { id: 1, label: "cider | apples", keywords: ["cider"], representative: [2], rising: 2 }] }));
mkdirSync(join(dir, "p"));
writeFileSync(join(dir, "p", "0.json"), JSON.stringify([
  [oct, oct, null, [[oct, "a", "hello beer", 0], [oct, "b", "more hops", 1]]],
  [oct, oct, null, [[oct, "a", "ipa night", 0]]],
  [nov, nov, "t1", [[nov, "c", "cider tasting", 0]]],
  [nov, nov, null, [[nov, "d", "random line", 0]]]]));

describe("wiki", async () => {
  const b = await loadBrain(dir);
  const pages = buildWiki(b);
  const get = (p: string) => pages.find(x => x.path === p)!.text;

  test("one page per topic, room and month, plus the index", () => {
    expect(pages.map(p => p.path).sort()).toEqual(["index", "rooms/general", "rooms/notes-2026-11", "timeline/2026-10", "timeline/2026-11",
      "topics/T0 beer · hops", "topics/T1 cider - apples"]);
  });
  test("topic page: frontmatter, representative chunk first, links to rooms, months and related topics", () => {
    const t = get("topics/T0 beer · hops");
    expect(t).toStartWith("---\ntype: \"topic\"\ntopic: 0\n");
    expect(t).toContain("chunks: 2");
    expect(t.indexOf("ipa night")).toBeLessThan(t.indexOf("hello beer"));
    expect(t).toContain("[[rooms/general|#general]] (2)");
    expect(t).toContain("[[timeline/2026-10|2026-10]] (2)");
    expect(t).toContain("[[topics/T1 cider - apples\\|T1 cider / apples]] | 1 |");   // one knn link 1 -> 2 crosses topics
    expect(t).toContain("**07:00 b (bot):** more hops");
  });
  test("a chunk in no topic is on its room and month pages, not on a topic page", () => {
    expect(get("rooms/notes-2026-11")).toContain("random line");
    expect(get("timeline/2026-11")).toContain("random line");
    expect(pages.filter(p => p.path.startsWith("topics/")).some(p => p.text.includes("random line"))).toBe(false);
    expect(get("index")).toContain("1 chunks fit none");
  });
  test("months link to each other, index links everything", () => {
    expect(get("timeline/2026-10")).toContain("[[timeline/2026-11|2026-11]] →");
    const ix = get("index");
    expect(ix).toContain("[[rooms/notes-2026-11|#notes/2026-11]] (2)");
    expect(ix).toContain("[[timeline/2026-10|2026-10]] (2)");
  });
  test("summaries go on top of the page they belong to", () => {
    const t = buildWiki(b, { summaries: { "topics/T0 beer · hops": "All about beer." } }).find(p => p.path === "topics/T0 beer · hops")!.text;
    expect(t).toContain("## Summary\n\nAll about beer.");
    expect(t.indexOf("## Summary")).toBeLessThan(t.indexOf("## Related topics"));
  });
  test("slug drops link and path characters", () => {
    expect(slug("#a/b:c|d[e]")).toBe("a-b-c-d-e");
    expect(slug("###")).toBe("untitled");
  });
  test("command writes the vault, Obsidian graph colours, removes stale pages", async () => {
    const out = join(dir, "vault");
    mkdirSync(join(out, "topics"), { recursive: true });
    writeFileSync(join(out, "topics", "T9 old.md"), "stale");
    const r = await handler({ source: "cli", args: ["wiki", dir, `--out=${out}`] });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("7 pages (2 topics, 2 rooms, 2 months + index), 1 old pages removed");
    expect(existsSync(join(out, "topics", "T9 old.md"))).toBe(false);
    expect(readFileSync(join(out, "index.md"), "utf8")).toContain("# test");
    expect(JSON.parse(readFileSync(join(out, ".obsidian", "graph.json"), "utf8")).colorGroups).toHaveLength(3);
  });
});
