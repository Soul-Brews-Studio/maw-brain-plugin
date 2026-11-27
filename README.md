# maw-brain-plugin

Turn any pile of text into a 3D map you can search by meaning. Notes, markdown books, a JSONL dump, a Facebook export or a Discord download all work. Similar ideas sit close together, the time machine replays how the map grew, and nothing leaves your machine.

## Install

```
maw plugin install Soul-Brews-Studio/maw-brain-plugin
maw brain --help
```

Update: `maw plugin update brain`

## Quick start

First pick an embed server. It needs to answer an Ollama-style `POST /api/embed` with an EmbeddingGemma model:

- **Apple Silicon:** [Chippy](https://github.com/Soul-Brews-Studio/chippy) runs EmbeddingGemma on the Neural Engine at `http://127.0.0.1:11445`. This is the default, so nothing needs setting.
- **Anywhere else:** run `ollama pull embeddinggemma`, then set `export BRAIN_EMBED_URL=http://127.0.0.1:11434 BRAIN_EMBED_MODEL=embeddinggemma`.

Then:

```
maw brain check                                  # uv, python3 and the embed server answer?
maw brain build notes.jsonl                      # -> notes.brain/
maw brain build ~/notes                          # a folder of .md -> ~/notes.brain/
maw brain serve notes.brain --port=7720          # http://127.0.0.1:7720/brain/
maw brain build notes.jsonl && maw brain reload  # rebuild; the running page re-reads it
```

### A brain in any folder: `init`

`init` turns any folder into a brain project, much like `git init`. After that, `build` and `serve` need no arguments, from that folder or any folder below it:

```
cd ~/notes && maw brain init --name="my notes" --exclude=drafts
maw brain build                                  # reads .brain/brain.json, writes the brain into .brain/
maw brain serve                                  # on the project's own port (7740, 7741, ... one per project)
maw brain ls                                     # every project: name, kind, points, last build, port
maw brain build --all                            # rebuild every project, one after another
```

`.brain/brain.json` holds the metadata. Edit it by hand or with `init --force`:

```json
{
  "name": "ane-commits",
  "created": "2026-11-27T08:29:26.731Z",
  "inputs": ["commits.jsonl"],
  "kind": "jsonl",
  "exclude": [],
  "embed": {},
  "serve": { "host": "127.0.0.1", "port": 7740 },
  "last_build": { "built": "2026-11-27T15:30:09+0700", "points": 192, "rooms": 66, "total_seconds": 41.6 }
}
```

(The real file from `init --input=commits.jsonl`; `last_build` is trimmed here, while the file keeps every count.)

- **`inputs`:** paths relative to the folder. Several inputs make one map.
- **`kind`, `gap`, `exclude`, `embed`:** the same as the build flags. A flag given on the command line wins.
- **`.brain/.gitignore`:** keeps everything in `.brain/` out of git except `brain.json`. You can commit the recipe, but not the text.
- **The project list:** kept in `~/.maw/brain/registry.json`.

### One global command, each `.brain` as context: `search`

`maw brain` is installed once, and every project keeps its own `.brain`. `search` reads them directly, with no server running:

```
cd ~/notes && maw brain search "why did the build fail"     # inside a project: only its .brain
maw brain search "ANE power" --all                          # anywhere: every project in maw brain ls, hits merged by meaning
maw brain search "ANE power" --project=notes,books --k=5    # only these projects
maw brain search "ANE power" --md > context.md              # LLM-ready context: full chunk text, --chars=6000 budget
maw brain search "ANE power" --json                         # for scripts and agents
```

- The question is embedded once for each embed server and model, then scored against each brain's `vec.i8`. This is the same math as the page's search.
- Only the hits' text is read.
- An agent can call `maw brain search "<task>" --md` before it starts work, to pull in what the folders already know.

### The brain as an Obsidian vault: `wiki`

```
maw brain wiki                                   # inside a project: writes .brain/wiki/ (gitignored)
maw brain wiki notes.brain --out=~/vaults/notes  # any brain, any folder
maw brain wiki --summarize                       # a model writes 3-5 sentences on top of each topic page
open "obsidian://open?path=$HOME/vaults/notes"   # or Obsidian: Open folder as vault
```

- `index.md`, then one page per topic (`topics/`), room (`rooms/`) and month (`timeline/`), each with YAML frontmatter and `[[wikilinks]]`.
- Relations come from the vectors, not from tags you write:
  - related topics = the map's nearest-neighbour links that cross between two topics, plus the cosine of their centroids;
  - every chunk links its room, its topic and its month, so Obsidian's graph and backlinks show the brain's shape.
- Topic keywords (c-TF-IDF) become tags (`kw/<word>`), and pages are tagged `brain/topic`, `brain/room`, `brain/month`.
- `--chunks=40` sets how many chunks a page shows. A rebuild rewrites the pages and removes ones that no longer exist.
- `--summarize[="claude -p --model sonnet"]` sends each topic page's text to that command (any CLI that reads stdin).
  Summaries are cached by the page's chunk ids, so after a rebuild only changed topics are asked again. `--summarize-all` does rooms and months too.

You can also get a JSONL file from git history:

```
git log --format='%at%x1f%s%x1e' | python3 -c 'import sys,json
for r in sys.stdin.read().split("\x1e"):
    if r.strip():
        t, s = r.strip().split("\x1f")
        print(json.dumps({"text": s, "ts": int(t), "group": s.split(":")[0] if ":" in s[:30] else "other"}))' > commits.jsonl
maw brain build commits.jsonl && maw brain serve commits.brain
```

| Command | What it does |
|---|---|
| `init [dir]` | Makes a folder a brain project (`.brain/brain.json`: name, inputs, kind, gap, exclude, embed, port). |
| `build [input...] [--out=DIR] [--all]` | With no input it builds the project here, and with `--all` every project. Otherwise it turns the input into a source folder, then chunks, vectors (cached), UMAP 3D, 4 nearest links and topics. Several inputs make one map. |
| `serve [brain dir] [--port] [--host]` | With no argument it serves the project here on its port. Otherwise it serves the three.js page: search by meaning and by words, click a point to read it, Combined or Separate layout, the time machine, and lightning on replay. |
| `from <jsonl\|md\|dyi\|fbposts> <input>` | Makes only the source folder (`server.json` + `server.sqlite`), so you can check it before building. |
| `insight <brain dir>` | Finds topics (HDBSCAN + c-TF-IDF, Thai words via PyThaiNLP) and the island layout. `build` already runs it. |
| `reload [--port]` | Makes a running page re-read its folder after a rebuild. |
| `search <question> [--all] [--project] [--md\|--json]` | Searches by meaning from anywhere: this project's `.brain`, or every project. `--md` gives LLM-ready context. |
| `ls [--json]` | Lists every project with its points, last build and port. |
| `wiki [brain dir] [--out] [--summarize]` | Writes the brain as an Obsidian vault: topics, rooms and months as linked markdown pages. |
| `check` | Checks for uv, python3 and the embed server, and prints the vector size. |

### Inputs

`build` works out what the input is:

| Input | Detected by | One point is | Default `--gap` |
|---|---|---|---|
| JSONL | `*.jsonl` / `*.ndjson` | one line (`{"text", "ts"?, "group"?, "title"?, "author"?, "thread"?}`) | 0.0001 h (one point per row) |
| Markdown | a folder with `*.md` (3 levels deep) | one section (a `#`–`####` heading starts one; code and images are dropped) | 0.0001 h |
| Facebook export | `messages/inbox` (DYI, JSON format) | a stretch of conversation in one thread | 3 h of silence |
| Facebook timeline | `posts/` or `comments_and_reactions/`, no `messages/inbox` | one post, group post or comment | 0.0001 h (one point each) |
| Source folder | `server.sqlite` (`maw brain from`, or `maw atlas download`) | as above, or a Discord conversation | taken from `server.json`, else 3 h |

A full DYI export (with Messenger too) detects as `dyi` — ask for your posts/comments explicitly with `--kind=fbposts`.

How time is set for each input:

- **Markdown:** the file's first git commit, else the frontmatter `date:`, else the file's mtime. Each section adds one second, so the time machine replays files in order.
- **JSONL:** `ts` may be ISO 8601, unix seconds or unix milliseconds. Rows without one keep their order.
- **Room (the colour on the map):** a folder (`--group=dir`, the default) or a file (`--group=file`) for markdown, the `group` field for JSONL, and the thread for Facebook.

Chat-like JSONL (short messages from people) reads better as conversations. Build it with `--gap=3` to merge a room's messages until 3 hours of silence.

### The brain folder

The vectors are cached per chunk in `<brain>/cache/`, so a rebuild only embeds new text. These are the files `build` writes; `serve` and your own tools can read them:

| File | Contents |
|---|---|
| `xyz.f32` | position, float32 [n × 3] |
| `sep.f32` | the island layout |
| `knn.u32` + `knn_cos.f16` | the 4 nearest points in meaning, and their cosine |
| `vec.i8` | int8 [n × 256] vectors for search |
| `grp.u32` | room |
| `t0.u32` | start time |
| `topic.u16` | topic |
| `p/<shard>.json` | the text, 64 points per shard |
| `meta.json` | counts, rooms, stats and timings |
| `insight.json` | topics, keywords and activity |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BRAIN_EMBED_URL` | `http://127.0.0.1:11445` | Ollama-style embed server (`POST /api/embed`); `--url=` per run |
| `BRAIN_EMBED_MODEL` | `embeddinggemma:ane-w8a16` | model name sent to it; `--model=` per run |
| `ATLAS_EMBED_URL` / `ATLAS_EMBED_MODEL` | | read too, so a maw-atlas setup works unchanged |
| `MAW_BRAIN_REGISTRY` | `~/.maw/brain/registry.json` | where `init` lists projects |

Needs [uv](https://docs.astral.sh/uv/), which brings Python 3.12, numpy, umap-learn, scikit-learn and pythainlp for the engine. The converters only need the Python standard library.

## Local only

- `serve` binds `127.0.0.1` by default, and otherwise only a tailscale `100.64.0.0/10` address. It refuses `0.0.0.0` and public addresses.
- Source folders and brain folders hold your text. The `.gitignore` here keeps `*.brain/`, `*.source/` and `server.sqlite` out of git; do the same in your own repos.
- Commands print counts and timings, never your text.
- `wiki` writes your text into markdown pages: the vault is as private as the brain. `--summarize` sends page text to the command you name; without it nothing leaves the machine.
- The page loads three.js from a CDN. Your data is served only by your own machine.

## Notes

- One point is one chunk, not one message. Short messages on their own sort by script (Thai vs Latin) rather than by meaning, which is why chat is merged into conversations.
- How the map is made: EmbeddingGemma with the document prompt `title: none | text: `, the first 256 Matryoshka dims renormalised, then UMAP 3D (cosine, 15 neighbours, min_dist 0.15, seed 7).
- The engine (`scripts/brain-engine.py`) and the page and server (`lib/brain*.ts`, `lib/brain.html`) are vendored from [nat-build-with-oracle/maw-atlas](https://github.com/nat-build-with-oracle/maw-atlas) `maw atlas brain` at `e1cfae6` (time machine ⏮ start and ▶ replay) (MIT). maw-atlas stays the place for Discord: `maw atlas download`, then `maw brain build <guild folder>`.
- `serve` also answers `GET /brain/api/overview`, `/topics`, `/report.md` and `/ontology` (Apache Ossie YAML), which are handy as LLM context.

## Development

```
git clone https://github.com/Soul-Brews-Studio/maw-brain-plugin
cd maw-brain-plugin
bun test                       # converters, CLI, server; engine self-test when uv is installed
bun index.ts build . --out=/tmp/self.brain   # run without installing: this repo's own markdown
```

— ane (AI, Claude Opus 5.5), via Claude Code
