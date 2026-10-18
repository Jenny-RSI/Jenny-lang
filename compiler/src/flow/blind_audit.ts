import type { Diagnostic, ModuleAST } from "./ast.ts";
import { stripCommentsAndSemi } from "./ast.ts";
import {
  extractJennyTestCode,
  parseJniBlueprint,
  stripJennyTestForAgent,
} from "./blueprint.ts";

const COMMON_TRIVIAL_LITERALS = new Set<string>([
  "-1", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "12", "15", "16", "20", "24", "31", "32", "48", "56", "63", "64",
  "100", "127", "128", "255", "256", "512", "1000", "1024", "4096", "65535", "65536",
  "0.0", "1.0", "-1.0", "0.5", "2.0",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectLiterals(txt: string): Set<string> {
  const noComments = txt.replace(/\/\/[^\n]*/g, "");
  const strs = new Set<string>();
  const strRe = /"([^"\\]{3,})"/g;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(noComments)) !== null) {
    strs.add(m[1]);
  }
  const titles = new Set<string>();
  const titleRe = /(?:test|@example)\s*\(?\s*"([^"]+)"/g;
  while ((m = titleRe.exec(noComments)) !== null) {
    titles.add(m[1]);
  }
  const noStrings = noComments.replace(/"[^"\\]*"/g, '""');
  const nums = new Set<string>();
  const numRe = /(?<![A-Za-z0-9_])(?:-?\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g;
  while ((m = numRe.exec(noStrings)) !== null) {
    nums.add(m[0]);
  }
  const out = new Set<string>();
  for (const n of nums) {
    if (!COMMON_TRIVIAL_LITERALS.has(n)) {
      out.add(n);
    }
  }
  for (const s of strs) {
    if (!titles.has(s)) {
      out.add(s);
    }
  }
  return out;
}

export function extractSecretTestLiterals(jniText: string): Set<string> {
  const testCode = extractJennyTestCode(jniText);
  const blindJni = stripJennyTestForAgent(jniText);

  const lTest = collectLiterals(testCode);
  const lDecl = collectLiterals(blindJni);
  const secret = new Set<string>();

  for (const lit of lTest) {
    if (lDecl.has(lit)) {
      continue;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(lit)) {
      const numPat = new RegExp(`(?<![A-Za-z0-9_.])${escapeRegExp(lit)}(?![A-Za-z0-9_.])`);
      if (numPat.test(blindJni)) {
        continue;
      }
    } else if (blindJni.includes(lit)) {
      continue;
    }
    secret.add(lit);
  }
  return secret;
}

export function auditTestLiteralOverfitting(
  jniText: string,
  jnText: string,
  moduleName: string,
): Diagnostic[] {
  const secretLits = extractSecretTestLiterals(jniText);
  if (secretLits.size === 0) {
    return [];
  }
  const sortedSecrets = [...secretLits].sort();
  const diagnostics: Diagnostic[] = [];
  const lines = jnText.replace(/\r\n/g, "\n").split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const codeLine = stripCommentsAndSemi(lines[idx]).trim();
    if (!codeLine) {
      continue;
    }
    const isBranchOrRet = /\b(?:if|else\s+if|guard|return)\b|==|!=|=>/.test(codeLine);
    if (!isBranchOrRet) {
      continue;
    }
    for (const lit of sortedSecrets) {
      const pat = !/^-?\d+(?:\.\d+)?$/.test(lit)
        ? new RegExp(`"${escapeRegExp(lit)}"`)
        : new RegExp(`(?<![A-Za-z0-9_.])${escapeRegExp(lit)}(?![A-Za-z0-9_.])`);
      if (pat.test(codeLine)) {
        diagnostics.push({
          code: "E0905_TEST_LITERAL_OVERFITTING",
          severity: "error",
          module: moduleName,
          line: lineNo,
          offending_token: lit,
          message:
            `Anti-overfitting violation (\`E0905\`): \`.jn\` implementation contains hardcoded test-only ` +
            `literal \`${lit}\` from \`jenny_test\`! Implement the general algorithm from \`jenny_decl\` contracts instead of hardcoding test cases.`,
          suggested_replacement:
            "// Remove hardcoded test literal branch and implement general contract logic",
        });
        break;
      }
    }
  }
  return diagnostics;
}

export function desensitizeFailedExamples(
  examples: Record<string, any>[],
  secretLiterals: Set<string> | string = new Set<string>(),
): Record<string, any>[] {
  const secretLits =
    typeof secretLiterals === "string"
      ? secretLiterals
        ? extractSecretTestLiterals(secretLiterals)
        : new Set<string>()
      : secretLiterals;
  const sortedLits = [...secretLits].sort((a, b) => b.length - a.length);
  const desensitized: Record<string, any>[] = [];
  for (const ex of examples) {
    const rawOut = String(ex.stdout ?? "");
    let maskedOut = rawOut;
    for (const lit of sortedLits) {
      if (/^-?\d+(?:\.\d+)?$/.test(lit)) {
        const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(lit)}(?![A-Za-z0-9_])`, "g");
        maskedOut = maskedOut.replace(re, "<REDACTED_TEST_LITERAL>");
      } else {
        maskedOut = maskedOut.replaceAll(lit, "<REDACTED_TEST_LITERAL>");
      }
    }
    desensitized.push({
      title: ex.title ?? "anonymous_test",
      passed: false,
      diagnostic_mode: "BLIND_DESENSITIZED",
      contract_or_assertion_summary: maskedOut,
    });
  }
  return desensitized;
}

export function runArchitectRootCauseAudit(
  jniText: string,
  failedHistory: Record<string, any>[] | ModuleAST,
  moduleName?: string | Record<string, any>[],
  goldenJnText: string | null = null,
): Record<string, any> {
  let roundHistory: Record<string, any>[];
  let modName: string;
  if (Array.isArray(failedHistory)) {
    roundHistory = failedHistory;
    modName =
      typeof moduleName === "string" && moduleName.length > 0
        ? moduleName
        : parseJniBlueprint(jniText).name;
  } else {
    modName = failedHistory.name;
    roundHistory = Array.isArray(moduleName) ? moduleName : [];
  }

  const lastRound = roundHistory.length > 0 ? roundHistory[roundHistory.length - 1] : {};
  const lastDiags: Record<string, any>[] = Array.isArray(lastRound.ai_diagnostics)
    ? lastRound.ai_diagnostics
    : [];
  const lastExamples: Record<string, any>[] = Array.isArray(lastRound.examples)
    ? lastRound.examples
    : [];
  const failedExs = lastExamples.filter((ex) => !ex.passed);

  // 1. Check RC1_BLUEPRINT_UNDERSPECIFIED
  const effectiveGoldenJn = goldenJnText ?? (typeof lastRound.golden_jn_text === "string" ? lastRound.golden_jn_text : null);
  if (effectiveGoldenJn) {
    const goldenOverfit = auditTestLiteralOverfitting(jniText, effectiveGoldenJn, modName);
    if (goldenOverfit.length > 0) {
      const missingConsts = goldenOverfit.map((d) => d.offending_token);
      const constsRepr = `[${missingConsts.map((c) => `'${c}'`).join(", ")}]`;
      return {
        triggered_after_round: roundHistory.length,
        auditor_role: "Architect-Agent (Full-Context)",
        root_cause_category: "RC1_BLUEPRINT_UNDERSPECIFIED",
        summary: `Blueprint \`${modName}.jni\` is underspecified: \`jenny_test\` expects domain constant(s) ${constsRepr} that are never documented in \`jenny_decl\` or Markdown prose.`,
        blueprint_remediation: `Add explicit specification or \`ensures\` contract for ${constsRepr} in \`${modName}.jni\` (\`jenny_decl\`).`,
        algorithmic_prescription: null,
      };
    }
  }

  // 2. Check RC2_TEST_CASE_DEFECT
  for (const ex of failedExs) {
    const out = String(ex.stdout ?? "");
    if (out.includes("JENNY_CONTRACT_VIOLATION") && out.replaceAll(" ", "").includes('"kind":"requires"')) {
      return {
        triggered_after_round: roundHistory.length,
        auditor_role: "Architect-Agent (Full-Context)",
        root_cause_category: "RC2_TEST_CASE_DEFECT",
        summary: `Test block \`${ex.title}\` in \`jenny_test\` passed arguments violating \`requires\` precondition in \`jenny_decl\` without asserting \`=> err(...)\`.`,
        blueprint_remediation: `Fix test case \`${ex.title}\` in \`${modName}.jni\` (\`jenny_test\`).`,
        algorithmic_prescription: null,
      };
    }
  }

  // 3. Default to RC3_ALGORITHMIC_BOTTLENECK
  const recurringCodes: string[] = [];
  for (const r of roundHistory) {
    for (const reason of r.failure_reasons ?? []) {
      if (!recurringCodes.includes(reason)) {
        recurringCodes.push(reason);
      }
    }
  }

  const prescriptions: string[] = [];
  for (const d of lastDiags) {
    const code = d.code ?? "";
    const msg = d.message ?? "";
    const repl = d.suggested_replacement ?? "";
    prescriptions.push(`[${code}] ${msg}` + (repl ? ` -> Fix: \`${repl}\`` : ""));
  }

  for (const ex of failedExs) {
    const out = String(ex.stdout ?? "");
    for (const line of out.replace(/\r\n/g, "\n").split("\n")) {
      if (line.includes("JENNY_CONTRACT_VIOLATION")) {
        prescriptions.push(`[CONTRACT_VIOLATION] ${line.trim()}`);
      }
    }
  }

  if (prescriptions.length === 0) {
    const compileErr = String(lastRound.compile_stderr ?? "").trim();
    if (compileErr) {
      const errLines = compileErr.replace(/\r\n/g, "\n").split("\n");
      const firstErrLine =
        errLines.find((l) => l.includes("error:"))?.trim() ??
        (errLines[0] ? errLines[0].trim() : "C99 codegen error");
      prescriptions.push(`[COMPILER_BACKEND_ERROR] ${firstErrLine}`);
    } else {
      prescriptions.push(
        `[LOGIC_MISMATCH] Implementation of \`${modName}\` compiled but failed held-out \`jenny_test\` state transitions. ` +
          `Verify all struct field updates and boundary return paths against \`jenny_decl\` contracts.`,
      );
    }
  }

  return {
    triggered_after_round: roundHistory.length,
    auditor_role: "Architect-Agent (Full-Context)",
    root_cause_category: "RC3_ALGORITHMIC_BOTTLENECK",
    recurring_failure_codes: recurringCodes,
    summary: `Code Agent exhausted 3 rounds on \`${modName}\` due to recurring \`${recurringCodes.join(", ") || "LOGIC_ERROR"}\` while \`jenny_decl\` and \`jenny_test\` are well-formed.`,
    blueprint_remediation: "None required (`jenny_decl` and `jenny_test` are consistent).",
    algorithmic_prescription: prescriptions.join(" | "),
  };
}
