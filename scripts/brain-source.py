#!/usr/bin/env python3
"""brain-source.py: turn any text into a brain "source folder" (server.json + server.sqlite), the layout
scripts/brain-engine.py builds a 3D meaning map from. Standard library only; nothing is uploaded.

  brain-source.py jsonl <file.jsonl> <out dir> [--name N]
  brain-source.py md    <folder> <out dir> [--name N] [--group dir|file] [--chars 1200]
  brain-source.py dyi   <Facebook export root> <out dir> [--name N] [--since YYYY-MM-DD] [--min-messages 5]
                        [--sources inbox,archived_threads,e2ee_cutover]
  brain-source.py fbposts <Facebook export root> <out dir> [--name N] [--since YYYY-MM-DD]

What a source folder holds (the same tables `maw atlas download` writes, so Discord downloads build as they are):
  server.json    {"guild": {"name", "id"}, "brain": {"kind", "gap"}}   brain.gap = the --gap hours build should use
  server.sqlite  channels(id, name)              one "room" per group (a book, a folder, a chat thread, a JSONL group)
                 discord_messages(channel_id, thread_id, ts, author_name, author_is_bot, content, raw_json)
                                                 one row per document, section or message

jsonl: one JSON object per line. Only "text" is required.
  {"text": "...", "ts": "2026-11-27T10:00:00Z" | 1764237600 | 1764237600000, "group": "notes", "title": "...",
   "author": "...", "thread": "...", "bot": false}
  rows without ts get the file's mtime plus one second per row (order kept). gap 0.0001: one point per row,
  unless rows are chat messages: then pass `--gap=3` to build to merge a room's messages into conversations.
md: every *.md under the folder; a heading (#..####) starts a section; code blocks and image lines are dropped;
  longer sections are split at --chars. Room = the file's folder (--group dir) or the file (--group file).
  Time = the file's first git commit, else frontmatter date:, else mtime; plus one second per section.
dyi: Facebook "Download Your Information" JSON, Messenger threads. Strings are repaired from Facebook's Latin-1
  escaping (s.encode("latin-1").decode("utf-8")); only text messages are kept. gap 3: messages merge into
  conversations.
fbposts: your own posts, comments and group posts from the same DYI export (posts/, comments_and_reactions/,
  groups/) — timeline, not Messenger. One point per post/comment (gap 0.0001); same Latin-1 repair.

Prints counts only, never the text.
"""
import argparse
import json
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
create table channels(id text primary key, name text);
create table discord_messages(id integer primary key, channel_id text, thread_id text, ts text, author_name text,
                              author_is_bot integer, content text, raw_json text);
create index m_ch on discord_messages(channel_id, ts);
"""
INSERT = ("insert into discord_messages(channel_id, thread_id, ts, author_name, author_is_bot, content, raw_json) "
          "values (?,?,?,?,?,?,?)")


class Source:
    def __init__(self, out, name, kind, gap):
        self.out = Path(out).expanduser()
        self.out.mkdir(parents=True, exist_ok=True)
        db = self.out / "server.sqlite"
        if db.exists():
            db.unlink()
        self.db = sqlite3.connect(db)
        self.db.executescript(SCHEMA)
        self.name, self.kind, self.gap = name, kind, gap
        self.rooms, self.rows = {}, 0

    def room(self, key, title):
        if key not in self.rooms:
            self.rooms[key] = title
            self.db.execute("insert into channels values (?, ?)", (key, title))
        return key

    def add(self, room, ts, text, author="", bot=False, thread=""):
        self.db.execute(INSERT, (room, thread or "", iso(ts), author or "", 1 if bot else 0, text, "{}"))
        self.rows += 1

    def close(self):
        self.db.commit()
        self.db.close()
        (self.out / "server.json").write_text(json.dumps(
            {"guild": {"name": self.name, "id": self.kind}, "brain": {"kind": self.kind, "gap": self.gap}},
            ensure_ascii=False))
        print(f"{self.kind}: {len(self.rooms):,} rooms, {self.rows:,} rows -> {self.out}  (build gap {self.gap} h)")


def iso(t):
    """unix seconds -> ISO 8601 UTC (the engine reads ISO)."""
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def to_unix(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v / 1000 if v > 1e11 else float(v)
    s = str(v).strip()
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return to_unix(float(s))
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


# ── jsonl ───────────────────────────────────────────────────────────────────

def from_jsonl(a):
    f = Path(a.input).expanduser()
    src = Source(a.out, a.name or f.stem, "jsonl", 0.0001)
    base, bad = f.stat().st_mtime, 0
    for i, line in enumerate(f.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            d = json.loads(line)
            text = str(d.get("text") or "").strip()
        except (ValueError, AttributeError):
            bad += 1
            continue
        if not text:
            bad += 1
            continue
        if d.get("title"):
            text = f"{d['title']}\n{text}"
        g = str(d.get("group") or "all")
        t = to_unix(d.get("ts"))
        src.add(src.room(g, g), t if t is not None else base + i, text, d.get("author") or "", bool(d.get("bot")),
                str(d.get("thread") or ""))
    src.close()
    if bad:
        print(f"skipped {bad:,} lines (not JSON, or no text)")


# ── markdown folder ─────────────────────────────────────────────────────────

def first_commit(path):
    try:
        out = subprocess.run(["git", "-C", str(path.parent), "log", "--diff-filter=A", "--format=%at", "--", path.name],
                             capture_output=True, text=True, timeout=30).stdout.split()
        return int(out[-1]) if out else None
    except Exception:
        return None


def front_date(text):
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    if m:
        d = re.search(r"^date:\s*['\"]?([0-9T:\-+ Z]+)", m.group(1), re.M)
        if d:
            try:
                return to_unix(d.group(1).strip())
            except ValueError:
                return None
    return None


def sections(text, cap):
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("!["))
    parts, head, cur = [], "", []
    for line in text.splitlines():
        if re.match(r"#{1,4} ", line):
            if "".join(cur).strip():
                parts.append((head, "\n".join(cur).strip()))
            head, cur = line.lstrip("#").strip(), []
        else:
            cur.append(line)
    if "".join(cur).strip():
        parts.append((head, "\n".join(cur).strip()))
    for h, body in parts:
        for i in range(0, max(1, len(body)), cap):
            chunk = body[i:i + cap].strip()
            if len(chunk) >= 40:
                yield h, chunk


def from_md(a):
    root = Path(a.input).expanduser().resolve()
    src = Source(a.out, a.name or root.name, "md", 0.0001)
    skip = {".git", "node_modules", ".venv", "dist", "build"}
    files = sorted(p for p in root.rglob("*.md") if not skip & set(p.relative_to(root).parts))
    n = 0
    for f in files:
        rel = f.relative_to(root)
        key = str(rel) if a.group == "file" else (str(rel.parent) if rel.parent != Path(".") else root.name)
        text = f.read_text(errors="ignore")
        t0 = first_commit(f) or front_date(text) or f.stat().st_mtime
        room = src.room(key, key)
        for i, (h, body) in enumerate(sections(text, a.chars)):
            src.add(room, t0 + i, f"{h}\n{body}" if h else body, f.stem, True)
            n += 1
    src.close()
    print(f"{len(files):,} markdown files")


# ── Facebook DYI (Messenger) ────────────────────────────────────────────────

def fix(s):
    if not isinstance(s, str):
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def find_messages(root):
    for p in (root, root / "messages", root / "your_facebook_activity" / "messages"):
        if (p / "inbox").is_dir():
            return p
    hits = [p.parent for p in root.rglob("inbox") if p.is_dir() and p.parent.name == "messages"]
    if hits:
        return hits[0]
    sys.exit(f"no messages/inbox under {root}")


def from_dyi(a):
    msgs = find_messages(Path(a.input).expanduser())
    since = to_unix(a.since) if a.since else 0
    src = Source(a.out, a.name or "Messenger", "dyi", 3.0)
    threads = kept = skipped = 0
    for s in [x.strip() for x in a.sources.split(",") if x.strip()]:
        d = msgs / s
        if not d.is_dir():
            continue
        for tdir in sorted(p for p in d.iterdir() if p.is_dir()):
            rows, title = [], tdir.name
            for f in sorted(tdir.glob("message_*.json")):
                j = json.loads(f.read_text(encoding="utf-8"))
                title = fix(j.get("title")) or title
                for m in j.get("messages", []):
                    text, t = fix(m.get("content")), m.get("timestamp_ms", 0) / 1000
                    if not text or t < since:
                        skipped += 1
                        continue
                    rows.append((t, fix(m.get("sender_name")) or "", text))
            threads += 1
            if len(rows) < a.min_messages:
                continue
            kept += 1
            room = src.room(tdir.name, title)
            for t, who, text in rows:
                src.add(room, t, text, who)
    src.close()
    print(f"{threads:,} threads read, {kept:,} kept (>= {a.min_messages} text messages), {skipped:,} skipped")


# ── Facebook DYI (timeline: posts, comments, group posts) ──────────────────

def find_activity(root):
    for p in (root, root / "your_facebook_activity"):
        if (p / "posts").is_dir() or (p / "comments_and_reactions").is_dir() or (p / "groups").is_dir():
            return p
    sys.exit(f"no posts/comments_and_reactions/groups under {root}")


def glob_json(d, pattern):
    return sorted(d.glob(pattern)) if d.is_dir() else []


def post_texts(item):
    """one Facebook "post" dict -> text items: data[].post, plus any attachment media description."""
    out = []
    for d in item.get("data", []):
        if isinstance(d, dict) and d.get("post"):
            out.append(fix(d["post"]))
    for att in item.get("attachments", []):
        for d in att.get("data", []):
            media = d.get("media") if isinstance(d, dict) else None
            if media and media.get("description"):
                out.append(fix(media["description"]))
    return out


def from_fbposts(a):
    root = find_activity(Path(a.input).expanduser())
    since = to_unix(a.since) if a.since else 0
    src = Source(a.out, a.name or "Timeline", "fbposts", 0.0001)
    counts = {"posts": 0, "group_posts": 0, "comments": 0, "group_comments": 0, "skipped": 0}

    for f in glob_json(root / "posts", "your_posts__*.json") or glob_json(root / "posts", "your_posts_*.json"):
        for item in json.loads(f.read_text(encoding="utf-8")):
            t = item.get("timestamp", 0)
            if t < since:
                counts["skipped"] += 1
                continue
            for text in post_texts(item):
                if text:
                    src.add(src.room("posts", "Your posts"), t, text)
                    counts["posts"] += 1

    gf = root / "groups" / "group_posts_and_comments.json"
    if gf.is_file():
        for item in json.loads(gf.read_text(encoding="utf-8")).get("group_posts_v2", []):
            t = item.get("timestamp", 0)
            if t < since:
                counts["skipped"] += 1
                continue
            for text in post_texts(item):
                if text:
                    src.add(src.room("group_posts", "Group posts"), t, text)
                    counts["group_posts"] += 1

    cf = root / "comments_and_reactions" / "comments.json"
    if cf.is_file():
        for item in json.loads(cf.read_text(encoding="utf-8")).get("comments_v2", []):
            for d in item.get("data", []):
                c = d.get("comment") if isinstance(d, dict) else None
                if not c:
                    continue
                t, text = c.get("timestamp", 0), fix(c.get("comment"))
                if t < since or not text:
                    counts["skipped"] += 1
                    continue
                src.add(src.room("comments", "Your comments"), t, text)
                counts["comments"] += 1

    cgf = root / "groups" / "your_comments_in_groups.json"
    if cgf.is_file():
        for item in json.loads(cgf.read_text(encoding="utf-8")).get("comments_v2", []):
            for d in item.get("data", []):
                c = d.get("comment") if isinstance(d, dict) else None
                if not c:
                    continue
                t, text = c.get("timestamp", 0), fix(c.get("comment"))
                if t < since or not text:
                    counts["skipped"] += 1
                    continue
                src.add(src.room("group_comments", "Group comments"), t, text)
                counts["group_comments"] += 1

    src.close()
    print(f"{counts['posts']:,} posts, {counts['group_posts']:,} group posts, {counts['comments']:,} comments, "
          f"{counts['group_comments']:,} group comments, {counts['skipped']:,} skipped (before --since, or no text)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="kind", required=True)
    for k in ("jsonl", "md", "dyi", "fbposts"):
        p = sub.add_parser(k)
        p.add_argument("input")
        p.add_argument("out")
        p.add_argument("--name", default="")
        if k == "md":
            p.add_argument("--group", choices=["dir", "file"], default="dir")
            p.add_argument("--chars", type=int, default=1200)
        if k == "dyi":
            p.add_argument("--since", default="")
            p.add_argument("--min-messages", type=int, default=5)
            p.add_argument("--sources", default="inbox,archived_threads,e2ee_cutover")
        if k == "fbposts":
            p.add_argument("--since", default="")
    a = ap.parse_args(argv)
    {"jsonl": from_jsonl, "md": from_md, "dyi": from_dyi, "fbposts": from_fbposts}[a.kind](a)


if __name__ == "__main__":
    main()
