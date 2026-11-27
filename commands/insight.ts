import type { CommandMeta, Log } from "../lib/command-types";
import { brainDir, engineCmd, runLive, words } from "../lib/run";

export const meta: CommandMeta = {
  name: "insight",
  help: "insight <brain dir>   topics (HDBSCAN + c-TF-IDF, Thai words via PyThaiNLP) + the Separate layout (build runs it)",
};

export async function run(log: Log, _t: string, args: string[]) {
  const t = words(args).join(" ");
  if (!t) { log("usage: maw brain insight <brain dir>"); return; }
  await runLive(engineCmd(["insight", brainDir(t)]), log, "brain-engine.py insight");
  log("a running page picks it up after: maw brain reload --port=<port>");
}
