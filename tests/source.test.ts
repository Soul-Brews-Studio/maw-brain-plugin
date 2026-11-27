import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import handler from "../index";
import { defaultOut, detectKind } from "../lib/run";

const root = mkdtempSync(join(tmpdir(), "maw-brain-src-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const py = (args: string[]) => Bun.spawnSync(["python3", "-I", join(import.meta.dir, "..", "scripts", "brain-source.py"), ...args]);
const rows = (dir: string) => {
  const db = new Database(join(dir, "server.sqlite"), { readonly: true });
  const r = { rooms: db.query("select id, name from channels order by id").all() as any[],
    msgs: db.query("select channel_id, ts, author_name, content from discord_messages order by id").all() as any[] };
  db.close();
  return r;
};

describe("jsonl", () => {
  const f = join(root, "notes.jsonl");
  writeFileSync(f, [
    JSON.stringify({ text: "first note about beer", ts: "2026-11-01T10:00:00Z", group: "beer", title: "Beer" }),
    JSON.stringify({ text: "second, unix seconds", ts: 1762000000, group: "beer" }),
    JSON.stringify({ text: "third, unix ms, no group", ts: 1762000000000 }),
    "not json",
    JSON.stringify({ text: "" }),
    JSON.stringify({ text: "no ts keeps its order" }),
  ].join("\n"));
  const out = join(root, "notes.source");
  test("rows, rooms, times, the gap for documents", () => {
    const p = py(["jsonl", f, out]);
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString()).toContain("skipped 2 lines");
    const r = rows(out);
    expect(r.rooms.map(x => x.id)).toEqual(["all", "beer"]);
    expect(r.msgs).toHaveLength(4);
    expect(r.msgs[0].content).toBe("Beer\nfirst note about beer");
    expect(r.msgs[0].ts).toStartWith("2026-11-01T10:00:00");
    expect(r.msgs[1].ts).toBe(r.msgs[2].ts); // seconds and ms read the same
    expect(JSON.parse(readFileSync(join(out, "server.json"), "utf8"))).toMatchObject({ guild: { name: "notes" }, brain: { kind: "jsonl", gap: 0.0001 } });
  });
  test("printed counts carry no text", () => expect(py(["jsonl", f, out]).stdout.toString()).not.toContain("beer"));
});

describe("markdown folder", () => {
  const md = join(root, "lib");
  mkdirSync(join(md, "book-a"), { recursive: true });
  mkdirSync(join(md, "node_modules", "x"), { recursive: true });
  writeFileSync(join(md, "book-a", "01-intro.md"), "---\ndate: 2025-05-05\n---\n# Intro\nThis section is long enough to keep, forty characters at least.\n```\ncode is dropped\n```\n![img](x.png)\n## Two\nshort\n## Three\nAnother section that is long enough to be one point on the map.\n");
  writeFileSync(join(md, "top.md"), "Root file without heading but long enough to count as a section here.\n");
  writeFileSync(join(md, "node_modules", "x", "README.md"), "# skipped\nnode_modules is never read, even when it is long enough.\n");
  test("sections by heading, rooms by folder, code and images dropped", () => {
    const out = join(root, "lib.source");
    expect(py(["md", md, out]).exitCode).toBe(0);
    const r = rows(out);
    expect(r.rooms.map(x => x.id).sort()).toEqual(["book-a", "lib"]);
    expect(r.msgs).toHaveLength(3);
    const text = r.msgs.map(m => m.content).join("\n");
    expect(text).not.toContain("code is dropped");
    expect(text).not.toContain("img");
    expect(text).not.toContain("node_modules");
    const intro = r.msgs.find(m => m.content.startsWith("Intro"));
    expect(intro.ts).toStartWith("2025-05-05");
  });
  test("files with the same time keep their sections in file order (no interleaving)", () => {
    const same = join(root, "same");
    mkdirSync(same, { recursive: true });
    const body = (n: string) => `# ${n}\n${n} section text that is long enough to be kept as a point.\n`;
    writeFileSync(join(same, "01-a.md"), "---\ndate: 2025-01-01\n---\n" + body("a1") + body("a2"));
    writeFileSync(join(same, "02-b.md"), "---\ndate: 2025-01-01\n---\n" + body("b1"));
    const out = join(root, "same.source");
    expect(py(["md", same, out]).exitCode).toBe(0);
    const r = rows(out);
    const byTime = [...r.msgs].sort((x, y) => x.ts.localeCompare(y.ts)).map(m => m.content.split("\n")[0]);
    expect(byTime).toEqual(["a1", "a2", "b1"]);
    expect(new Set(r.msgs.map(m => m.ts)).size).toBe(3);
  });
  test("--group file: one room per file", () => {
    const out = join(root, "lib-file.source");
    expect(py(["md", md, out, "--group", "file"]).exitCode).toBe(0);
    expect(rows(out).rooms.map(x => x.id).sort()).toEqual(["book-a/01-intro.md", "top.md"]);
  });
});

describe("Facebook export", () => {
  const fb = join(root, "fb");
  const t = join(fb, "your_facebook_activity", "messages", "inbox", "friend_123");
  mkdirSync(t, { recursive: true });
  const latin1 = (s: string) => Buffer.from(s, "utf8").toString("latin1"); // how Facebook writes UTF-8
  writeFileSync(join(t, "message_1.json"), JSON.stringify({ title: latin1("เพื่อน"), messages: [
    { sender_name: "A", timestamp_ms: 1700000000000, content: latin1("สวัสดีครับ") },
    { sender_name: "B", timestamp_ms: 1700000060000, content: "hi" },
    { sender_name: "B", timestamp_ms: 1700000120000, photos: [{}] },
  ] }));
  test("Thai repaired, only text kept, chat gap", () => {
    const out = join(root, "fb.source");
    expect(py(["dyi", fb, out, "--min-messages", "2"]).exitCode).toBe(0);
    const r = rows(out);
    expect(r.rooms[0].name).toBe("เพื่อน");
    expect(r.msgs.map(m => m.content)).toEqual(["สวัสดีครับ", "hi"]);
    expect(JSON.parse(readFileSync(join(out, "server.json"), "utf8")).brain.gap).toBe(3);
  });
  test("threads under --min-messages are left out", () => {
    const out = join(root, "fb5.source");
    py(["dyi", fb, out]);
    expect(rows(out).msgs).toHaveLength(0);
  });
});

describe("Facebook timeline (fbposts)", () => {
  const fb = join(root, "fbtl");
  const act = join(fb, "your_facebook_activity");
  mkdirSync(join(act, "posts"), { recursive: true });
  mkdirSync(join(act, "comments_and_reactions"), { recursive: true });
  mkdirSync(join(act, "groups"), { recursive: true });
  const latin1 = (s: string) => Buffer.from(s, "utf8").toString("latin1");
  writeFileSync(join(act, "posts", "your_posts__check_ins__photos_and_videos_1.json"), JSON.stringify([
    { timestamp: 1700000000, data: [{ post: latin1("โพสต์หนึ่ง") }] },
    { timestamp: 1699999999, data: [{ update_timestamp: 1699999999 }] }, // no post text: skipped
  ]));
  writeFileSync(join(act, "comments_and_reactions", "comments.json"), JSON.stringify({ comments_v2: [
    { data: [{ comment: { timestamp: 1700000100, comment: latin1("คอมเมนต์หนึ่ง") } }] },
  ] }));
  writeFileSync(join(act, "groups", "group_posts_and_comments.json"), JSON.stringify({ group_posts_v2: [
    { timestamp: 1700000200, data: [{ post: latin1("โพสต์ในกลุ่ม") }] },
  ] }));
  writeFileSync(join(act, "groups", "your_comments_in_groups.json"), JSON.stringify({ comments_v2: [
    { data: [{ comment: { timestamp: 1700000300, comment: latin1("คอมเมนต์ในกลุ่ม") } }] },
  ] }));
  test("one point per post/comment, Thai Latin-1 repair, gap for documents", () => {
    const out = join(root, "fbtl.source");
    const p = py(["fbposts", fb, out]);
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString()).toContain("1 posts, 1 group posts, 1 comments, 1 group comments");
    const r = rows(out);
    expect(r.rooms.map(x => x.id).sort()).toEqual(["comments", "group_comments", "group_posts", "posts"]);
    expect(r.msgs).toHaveLength(4);
    expect(r.msgs.map(m => m.content).sort()).toEqual(["คอมเมนต์หนึ่ง", "คอมเมนต์ในกลุ่ม", "โพสต์หนึ่ง", "โพสต์ในกลุ่ม"]);
    expect(JSON.parse(readFileSync(join(out, "server.json"), "utf8")).brain.gap).toBe(0.0001);
  });
  test("--since drops earlier posts", () => {
    const out = join(root, "fbtl-since.source");
    py(["fbposts", fb, out, "--since", "2024-01-01"]);
    expect(rows(out).msgs.length).toBeLessThan(4);
  });
  test("printed counts carry no text", () => expect(py(["fbposts", fb, join(root, "fbtl.source")]).stdout.toString()).not.toContain("โพสต์"));
});

describe("detect + defaults", () => {
  test("kinds", () => {
    expect(detectKind(join(root, "notes.jsonl"))).toBe("jsonl");
    expect(detectKind(join(root, "notes.source"))).toBe("source");
    expect(detectKind(join(root, "fb"))).toBe("dyi");
    expect(detectKind(join(root, "fbtl"))).toBe("fbposts");
    expect(detectKind(join(root, "lib"))).toBe("md");
    expect(detectKind(join(root, "nope"))).toBeNull();
  });
  test("out next to the input, never inside a markdown folder", () => {
    expect(defaultOut(join(root, "notes.jsonl"), "jsonl")).toBe(join(root, "notes.brain"));
    expect(defaultOut(join(root, "lib"), "md")).toBe(join(root, "lib.brain"));
    expect(defaultOut(join(root, "notes.source"), "source")).toBe(join(root, "notes.source", "brain"));
  });
});

describe("cli", () => {
  test("help lists every command", async () => {
    const r = await handler({ source: "cli", args: ["--help"] });
    expect(r.ok).toBe(true);
    for (const c of ["build", "serve", "from", "insight", "reload", "check"]) expect(r.output).toContain(`  ${c} `);
  });
  test("unknown command fails", async () => expect((await handler({ source: "cli", args: ["nope"] })).ok).toBe(false));
  test("from writes a source folder", async () => {
    const out = join(root, "cli.source");
    const r = await handler({ source: "cli", args: ["from", "jsonl", join(root, "notes.jsonl"), `--out=${out}`] });
    expect(r.ok).toBe(true);
    expect(rows(out).msgs).toHaveLength(4);
  });
});
