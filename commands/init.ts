import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { CommandMeta, Log } from "../lib/command-types";
import { cfgPath, GITIGNORE, newConfig, readConfig, register, writeConfig } from "../lib/project";
import { detectKind, flag, words } from "../lib/run";

export const meta: CommandMeta = {
  name: "init",
  help: "init [dir] [--name=N] [--input=a,b] [--kind=K] [--gap=H] [--exclude=x,y] [--port=P]   make any folder a brain project (.brain/brain.json)",
  treeLines: [
    "init [dir]   writes <dir>/.brain/brain.json (name, inputs, kind, gap, exclude, embed, serve port) + .brain/.gitignore",
    "then in that folder (or below it): maw brain build · maw brain serve — no arguments; maw brain ls lists every init",
  ],
};

export async function run(log: Log, _t: string, args: string[]) {
  const dir = resolve(words(args)[0] || ".");
  if (existsSync(cfgPath(dir)) && !args.includes("--force")) throw new Error(`${cfgPath(dir)} exists (--force to rewrite)`);
  const inputs = (flag(args, "input") || ".").split(",").map(s => s.trim()).filter(Boolean);
  for (const i of inputs) if (!existsSync(resolve(dir, i))) throw new Error(`input ${i} not found in ${dir}`);
  const kind = flag(args, "kind") || detectKind(resolve(dir, inputs[0])) || undefined;
  if (!kind) throw new Error(`${inputs[0]}: nothing to read (no .md, .jsonl, Facebook export or source folder) — say --input= or --kind=`);
  const gap = flag(args, "gap");
  const port = flag(args, "port") ?? (existsSync(cfgPath(dir)) ? readConfig(dir).serve?.port?.toString() : undefined);   // --force keeps the port
  const c = newConfig(dir, { name: flag(args, "name"), inputs, kind, gap: gap === undefined ? undefined : Number(gap),
    exclude: (flag(args, "exclude") || "").split(",").map(s => s.trim()).filter(Boolean),
    embed: { ...(flag(args, "url") ? { url: flag(args, "url") } : {}), ...(flag(args, "model") ? { model: flag(args, "model") } : {}) },
    serve: port === undefined ? undefined : { port: Number(port) } });
  mkdirSync(join(dir, ".brain"), { recursive: true });
  writeFileSync(join(dir, ".brain", ".gitignore"), GITIGNORE);
  writeConfig(dir, c);
  register(dir);
  log(`brain project "${c.name}" (${kind}, inputs ${inputs.join(", ")}) -> ${cfgPath(dir)}`);
  log(`next: cd ${dir} && maw brain build && maw brain serve   (port ${c.serve?.port})`);
}
