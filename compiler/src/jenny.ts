import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFlowCli } from "./flow/cli.ts";
import { runSpindleCli } from "./spindle/cli.ts";

const SPINDLE_SUBCOMMANDS = new Set<string>([
  "spindle",
  "audit",
  "build",
  "context",
  "firewall-test",
  "mutate",
  "lock",
  "semver-check",
  "synthesize",
  "bindgen-c",
  "pack",
  "decompile",
  "std-check",
]);

export function runJennyCli(argv: string[] = process.argv.slice(2)): number {
  const firstArg = argv[0] ?? "";
  if (SPINDLE_SUBCOMMANDS.has(firstArg)) {
    const forwarded = firstArg === "spindle" ? argv.slice(1) : argv;
    return runSpindleCli(forwarded);
  }
  return runFlowCli(argv);
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (isMain) {
  process.exit(runJennyCli(process.argv.slice(2)));
}
