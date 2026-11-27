import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "maw-brain-search-"));
process.env.MAW_BRAIN_REGISTRY = join(root, "registry.json");
// a fake embed server: "beer" -> [1, 0], anything else -> [0, 1]
const emb = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (r) => {
  const { input } = (await r.json()) as any;
  return Response.json({ embeddings: [String(input).includes("beer") ? [1, 0] : [0, 1]] });
} });
afterAll(() => { emb.stop(true); rmSync(root, { recursive: true, force: true }); });
const { default: handler } = await import("../index");
const cli = (args: string[]) => handler({ source: "cli", args });

// two projects, each a built 2-point brain: one beer-ish point and one other
function project(name: string, beerScore: number, port: number) {
  const dir = join(root, name), b = join(dir, ".brain");
  mkdirSync(join(b, "p"), { recursive: true });
  writeFileSync(join(b, "brain.json"), JSON.stringify({ name, created: "", inputs: ["."], serve: { port } }));
  writeFileSync(join(b, "meta.json"), JSON.stringify({ n: 2, dim: 2, scale: 127, shard: 64, query_prompt: "q: ", model: "m",
    embed_url: `http://127.0.0.1:${emb.port}`, groups: [{ title: `#${name}-room` }] }));
  writeFileSync(join(b, "vec.i8"), new Int8Array([Math.round(127 * beerScore), 0, 0, 127]));
  writeFileSync(join(b, "grp.u32"), new Uint32Array([0, 0]));
  writeFileSync(join(b, "p", "0.json"), JSON.stringify([[0, 0, null, [[0, "a", `${name} beer note`, 0]]], [0, 0, null, [[0, "a", `${name} other note`, 0]]]]));
  return dir;
}
const a = project("alpha", 0.9, 7801), z = project("zeta", 0.5, 7802);
writeFileSync(process.env.MAW_BRAIN_REGISTRY, JSON.stringify({ projects: [a, z] }));

describe("search", () => {
  test("outside a project: every brain, merged by cosine", async () => {
    const r = await cli(["search", "beer", "--k=2", "--json"]);
    const j = JSON.parse(r.output);
    expect(j.brains).toEqual(["alpha", "zeta"]);
    expect(j.hits.map((h: any) => h.brain)).toEqual(["alpha", "zeta"]);
    expect(j.hits[0].text).toBe("alpha beer note");
    expect(j.hits[0].score).toBeGreaterThan(j.hits[1].score);
  });
  test("--project narrows it", async () => {
    const j = JSON.parse((await cli(["search", "beer", "--project=zeta", "--json"])).output);
    expect(j.brains).toEqual(["zeta"]);
  });
  test("--md is LLM context with a budget", async () => {
    const r = await cli(["search", "beer", "--k=4", "--md"]);
    expect(r.output).toStartWith("# Context for: beer");
    expect(r.output).toContain("## alpha · #alpha-room");
    expect(r.output).toContain("alpha beer note");
  });
  test("an unknown project is an error", async () => expect((await cli(["search", "beer", "--project=nope"])).ok).toBe(false));
});
