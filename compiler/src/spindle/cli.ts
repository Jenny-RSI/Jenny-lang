import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT_DIR } from "../flow/ast.ts";
import {
  cmdAudit,
  cmdBuild,
  cmdContext,
  cmdFirewallTest,
  cmdMutate,
} from "./audit_and_build.ts";
import {
  cmdBindgenC,
  cmdDecompile,
  cmdPack,
  cmdStdCheck,
} from "./bindgen_and_pack.ts";
import { STD_DIR } from "./manifest.ts";
import { cmdLock, cmdSemverCheck, cmdSynthesize } from "./semver_and_lock.ts";

const SPINDLE_COMMANDS = new Set<string>([
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
  "all",
]);

export function runSpindleCli(argv: string[] = process.argv.slice(2)): number {
  const tokens = [...argv];
  if (tokens[0] === "spindle") {
    tokens.shift();
  }

  let command = "all";
  let pkgDir = STD_DIR;
  let entryMod: string | null = null;
  let domain: string | null = null;
  let stage: number | null = null;
  let useCache = false;
  let headerRel: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (arg === "--pkg" && i + 1 < tokens.length) {
      pkgDir = path.resolve(tokens[++i]);
    } else if (arg === "--entry" && i + 1 < tokens.length) {
      entryMod = tokens[++i];
    } else if (arg === "--domain" && i + 1 < tokens.length) {
      domain = tokens[++i];
    } else if (arg === "--stage" && i + 1 < tokens.length) {
      stage = parseInt(tokens[++i], 10);
    } else if (arg === "--header" && i + 1 < tokens.length) {
      headerRel = tokens[++i];
    } else if (arg === "--cache") {
      useCache = true;
    } else if (arg === "--mutate") {
      command = "mutate";
    } else if (!arg.startsWith("-")) {
      if (SPINDLE_COMMANDS.has(arg)) {
        command = arg;
      } else if (!entryMod) {
        entryMod = arg;
      }
    }
  }

  let out: Record<string, any>;
  if (command === "audit") {
    out = cmdAudit(pkgDir);
  } else if (command === "build") {
    out = cmdBuild(pkgDir, entryMod, useCache);
  } else if (command === "context") {
    out = cmdContext(pkgDir, entryMod ?? "std::collections::vec");
  } else if (command === "firewall-test") {
    out = cmdFirewallTest(pkgDir);
  } else if (command === "mutate") {
    out = cmdMutate(pkgDir);
  } else if (command === "lock") {
    out = cmdLock(pkgDir);
  } else if (command === "semver-check") {
    out = cmdSemverCheck(pkgDir);
  } else if (command === "synthesize") {
    out = cmdSynthesize(pkgDir, entryMod ?? "std::str::str_view");
  } else if (command === "bindgen-c") {
    out = cmdBindgenC(pkgDir, headerRel);
  } else if (command === "pack") {
    out = cmdPack(pkgDir);
  } else if (command === "decompile") {
    out = cmdDecompile(pkgDir, entryMod);
  } else if (command === "std-check") {
    out = cmdStdCheck(pkgDir, entryMod, domain, stage);
  } else {
    out = {
      audit: cmdAudit(pkgDir),
      lockfile: cmdLock(pkgDir),
      package_ast_archive: cmdPack(pkgDir),
      ast_decompile_verification: cmdDecompile(pkgDir),
      std_completeness_check: cmdStdCheck(pkgDir),
      lazy_subgraph_build_vec: cmdBuild(
        pkgDir,
        "std::collections::vec",
        false,
      ),
      full_std_build: cmdBuild(pkgDir, null, false),
      warm_cas_std_build: cmdBuild(pkgDir, null, true),
      context_packer_vec: cmdContext(pkgDir, "std::collections::vec"),
      context_packer_cursor: cmdContext(pkgDir, "std::io::cursor"),
      header_firewall_verification: cmdFirewallTest(pkgDir),
      supply_chain_mutations: cmdMutate(pkgDir),
      semver_upgrade_verification: cmdSemverCheck(pkgDir),
      blueprint_on_demand_synthesis: cmdSynthesize(pkgDir),
      whitebox_c_bindgen_verification: cmdBindgenC(pkgDir),
    };
  }

  const snapshotPath = path.join(
    ROOT_DIR,
    ".jenny-cache",
    "spindle_report_snapshot.json",
  );
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const jsonText = JSON.stringify(out, null, 2);
  fs.writeFileSync(snapshotPath, jsonText, "utf-8");
  console.log(jsonText);
  return 0;
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exit(runSpindleCli(process.argv.slice(2)));
}
