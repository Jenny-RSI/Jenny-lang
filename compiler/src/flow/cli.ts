import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT_DIR } from "./ast.ts";
import { generateJnSkeleton, parseJniBlueprint } from "./blueprint.ts";
import {
  checkSingleFile,
  compileAndRunBenchmark,
  discoverAllBenchDirs,
  discoverStdJniFiles,
  runContractFuzzAll,
  testAbiCompilationFirewall,
} from "./driver.ts";
import {
  runStage1Mutations,
  runStage2Mutations,
  runStage3Mutations,
  runStage4Mutations,
} from "./mutations.ts";
import { distillBoilerplate } from "./spin.ts";

export function runFlowCli(argv: string[] = process.argv.slice(2)): number {
  let mutate = false;
  let fuzz = false;
  let buildNative = false;
  let checkFile: string | null = null;
  let runFile: string | null = null;
  let skeleton: string | null = null;
  let distill: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mutate") {
      mutate = true;
    } else if (arg === "--fuzz") {
      fuzz = true;
    } else if (arg === "--build-native") {
      buildNative = true;
    } else if ((arg === "--check-file" || arg === "--check") && i + 1 < argv.length) {
      checkFile = argv[++i];
    } else if (arg.startsWith("--check-file=")) {
      checkFile = arg.slice("--check-file=".length);
    } else if (arg.startsWith("--check=")) {
      checkFile = arg.slice("--check=".length);
    } else if ((arg === "--run-file" || arg === "--run") && i + 1 < argv.length) {
      runFile = argv[++i];
    } else if (arg.startsWith("--run-file=")) {
      runFile = arg.slice("--run-file=".length);
    } else if (arg.startsWith("--run=")) {
      runFile = arg.slice("--run=".length);
    } else if (arg === "--skeleton" && i + 1 < argv.length) {
      skeleton = argv[++i];
    } else if (arg.startsWith("--skeleton=")) {
      skeleton = arg.slice("--skeleton=".length);
    } else if (arg === "--distill" && i + 1 < argv.length) {
      distill = argv[++i];
    } else if (arg.startsWith("--distill=")) {
      distill = arg.slice("--distill=".length);
    }
  }

  if (distill) {
    const fpath = path.resolve(distill);
    console.log(JSON.stringify(distillBoilerplate(fpath), null, 2));
    return 0;
  }

  if (skeleton) {
    const fpath = path.resolve(skeleton);
    const ast = parseJniBlueprint(fs.readFileSync(fpath, "utf-8"));
    process.stdout.write(generateJnSkeleton(ast));
    return 0;
  }

  if (checkFile) {
    const fpath = path.resolve(checkFile);
    return checkSingleFile(fpath, true);
  }

  if (runFile) {
    const fpath = path.resolve(runFile);
    const isFile = fs.existsSync(fpath) && fs.statSync(fpath).isFile();
    const pairedJni = fpath.replace(/\.[^.]+$/, ".jni");
    const target =
      isFile && fs.existsSync(pairedJni)
        ? fpath
        : fs.existsSync(fpath) && fs.statSync(fpath).isDirectory()
          ? fpath
          : path.dirname(fpath);
    console.log(JSON.stringify(compileAndRunBenchmark(target), null, 2));
    return 0;
  }

  const allDirs = discoverAllBenchDirs();
  const stdFiles = discoverStdJniFiles();

  if (fuzz && !mutate && !buildNative) {
    console.log(JSON.stringify(runContractFuzzAll([...allDirs, ...stdFiles]), null, 2));
    return 0;
  }

  const allReports: Record<string, any>[] = [];
  for (const bdir of allDirs) {
    allReports.push(compileAndRunBenchmark(bdir));
  }
  const stdReports: Record<string, any>[] = [];
  for (const sfile of stdFiles) {
    stdReports.push(compileAndRunBenchmark(sfile));
  }

  const b24Dir = path.join(ROOT_DIR, "benchmarks", "stage4_native", "B24_kv_storage_engine");
  const firewallReport =
    buildNative || mutate ? testAbiCompilationFirewall(b24Dir, allDirs) : null;
  const fuzzReport = fuzz ? runContractFuzzAll([...allDirs, ...stdFiles]) : null;
  const mutations = mutate ? runStage1Mutations() : [];
  const s2Mutations = mutate ? runStage2Mutations() : [];
  const s3Mutations = mutate ? runStage3Mutations() : [];
  const s4Mutations = mutate ? runStage4Mutations() : [];

  const combined = [...allReports, ...stdReports];
  const allPassed = combined.every(
    (r) => Boolean(r.compile_ok) && ((r.examples ?? []) as Record<string, any>[]).every((ex) => Boolean(ex.passed)),
  );

  const output = {
    compiler:
      "jenny-native v0.2-alpha2 (TypeScript Modular Compiler + C99 -O3 Native Backend + .jni ABI Compilation Firewall + Immix 64KB Block Collector + Jenny-Std)",
    total_modules: allReports.length,
    std_modules_count: stdReports.length,
    all_passed: allPassed,
    benchmarks: allReports,
    std_modules: stdReports,
    abi_firewall_and_cas_cache: firewallReport,
    contract_fuzz_report: fuzzReport,
    stage1_mutations: mutations,
    stage2_mutations: s2Mutations,
    stage3_mutations: s3Mutations,
    stage4_mutations: s4Mutations,
  };
  console.log(JSON.stringify(output, null, 2));
  return allPassed ? 0 : 1;
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  process.exit(runFlowCli(process.argv.slice(2)));
}
