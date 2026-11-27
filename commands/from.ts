import { resolve } from "path";
import type { CommandMeta, Log } from "../lib/command-types";
import { convert, flag, words } from "../lib/run";

export const meta: CommandMeta = {
  name: "from",
  help: "from <jsonl|md|dyi> <input> [--out=DIR]   make a source folder (server.json + server.sqlite) without building",
  treeLines: [
    "from <jsonl|md|dyi> <input> [--out=DIR]   input -> source folder (build does this for you; use it to inspect or merge)",
    "jsonl: {\"text\", \"ts\"?, \"group\"?, \"title\"?, \"author\"?} per line · md: --group=dir|file --chars=1200 · dyi: --since=YYYY-MM-DD --min-messages=5",
  ],
};

export async function run(log: Log, _t: string, args: string[]) {
  const [kind, input] = words(args);
  if (!["jsonl", "md", "dyi"].includes(kind) || !input) {
    log("usage: maw brain from <jsonl|md|dyi> <input> [--out=DIR] [--name=N]");
    if (kind) throw new Error(`unknown kind: ${kind}`);
    return;
  }
  const out = flag(args, "out") || `${resolve(input).replace(/\.(jsonl|ndjson)$/i, "")}.source`;
  await convert(kind as "jsonl" | "md" | "dyi", input, out, args, log);
  log(`build it: maw brain build ${out}`);
}
