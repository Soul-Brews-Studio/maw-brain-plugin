import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "maw-brain-proj-"));
process.env.MAW_BRAIN_REGISTRY = join(root, "registry.json");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const { default: handler } = await import("../index");
const { findProject, readConfig, registry } = await import("../lib/project");
const cli = (args: string[]) => handler({ source: "cli", args });

const notes = join(root, "notes");
mkdirSync(join(notes, "sub", "deeper"), { recursive: true });
mkdirSync(join(notes, "drafts"), { recursive: true });
writeFileSync(join(notes, "a.md"), "# A\nA section that is long enough to be kept as one point on the map.\n");
writeFileSync(join(notes, "drafts", "x.md"), "# Draft\nA draft section, long enough, that --exclude=drafts must leave out.\n");

describe("init", () => {
  test("writes metadata, a gitignore that keeps only brain.json, and registers", async () => {
    const r = await cli(["init", notes, "--name=my notes", "--exclude=drafts"]);
    expect(r.ok).toBe(true);
    const c = readConfig(notes);
    expect(c).toMatchObject({ name: "my notes", inputs: ["."], kind: "md", exclude: ["drafts"], serve: { host: "127.0.0.1", port: 7740 } });
    expect(readFileSync(join(notes, ".brain", ".gitignore"), "utf8")).toContain("!brain.json");
    expect(registry()).toEqual([notes]);
  });
  test("refuses to overwrite without --force", async () => {
    expect((await cli(["init", notes])).ok).toBe(false);
    expect((await cli(["init", notes, "--force", "--name=again"])).ok).toBe(true);
    expect(readConfig(notes).name).toBe("again");
  });
  test("a second project gets the next port", async () => {
    const j = join(root, "log");
    mkdirSync(j);
    writeFileSync(join(j, "rows.jsonl"), JSON.stringify({ text: "hello" }) + "\n");
    expect((await cli(["init", j, "--input=rows.jsonl"])).ok).toBe(true);
    expect(readConfig(j)).toMatchObject({ kind: "jsonl", inputs: ["rows.jsonl"], serve: { port: 7741 } });
  });
  test("nothing to read is an error", async () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    expect((await cli(["init", empty])).ok).toBe(false);
    expect(existsSync(join(empty, ".brain"))).toBe(false);
  });
});

describe("project lookup + ls", () => {
  test("found from a folder below the project", () => {
    expect(findProject(join(notes, "sub", "deeper"))).toBe(notes);
    expect(findProject(root)).toBeNull();
  });
  test("ls lists both, not built yet", async () => {
    const r = await cli(["ls"]);
    expect(r.output).toContain("again");
    expect(r.output).toContain("not built");
    const j = JSON.parse((await cli(["ls", "--json"])).output);
    expect(j.map((x: any) => x.port).sort()).toEqual([7740, 7741]);
  });
});

describe("md exclude", () => {
  test("the converter skips .brain and the excluded folders", () => {
    const out = join(root, "ex.source");
    const p = Bun.spawnSync(["python3", "-I", join(import.meta.dir, "..", "scripts", "brain-source.py"), "md", notes, out, "--exclude", "drafts"]);
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString()).toContain("1 markdown files");
  });
});
