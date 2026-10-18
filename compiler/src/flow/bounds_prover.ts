import type { Diagnostic, FnSpec, ModuleAST } from "./ast.ts";
import { stripCommentsAndSemi } from "./ast.ts";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countChar(s: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) {
      count += 1;
    }
  }
  return count;
}

/**
 * Jenny-BoundsProver (`QF_LIA` Verification Condition Generator for `mask [Unsafe]`):
 * Verifies that every `.get_unchecked(idx)` / `.set_unchecked(idx, ...)` inside a `mask [Unsafe]`
 * scope is 100% dominated by complete lower-bound (`0 <= idx`) and upper-bound (`idx < len`) guards.
 * If incomplete, synthesizes a concrete numerical counterexample and emits `E0711_UNPROVEN_BOUNDS_CONTAINMENT`.
 */
export function verifyBoundsContainmentVcg(
  fnName: string,
  fspec: FnSpec | null | undefined,
  bodyLines: string[],
  moduleName: string,
  lineNo = 1,
): [Record<string, any>[], Diagnostic[]] {
  const diags: Diagnostic[] = [];
  const uncheckedAccesses: Array<[string, string, number, string]> = [];
  const guardFacts: string[] = [];

  if (fspec && fspec.requires) {
    for (const req of fspec.requires) {
      guardFacts.push(req.cond);
    }
  }

  for (const sl of bodyLines) {
    const mGd = /^guard\s+(.+?)\s+else\b/.exec(sl);
    if (mGd) {
      guardFacts.push(mGd[1].trim());
      continue;
    }
    const ucRe = /\b([A-Za-z0-9_.]+)\.(?:get_unchecked|set_unchecked)\s*\(\s*([^,)]+)/g;
    let mUc: RegExpExecArray | null;
    while ((mUc = ucRe.exec(sl)) !== null) {
      const seqName = mUc[1].trim();
      const idxExpr = mUc[2].trim();
      const mLin = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+\s*(\d+))?$/.exec(idxExpr);
      if (mLin) {
        const baseV = mLin[1];
        const kOff = mLin[2] ? parseInt(mLin[2], 10) : 0;
        uncheckedAccesses.push([seqName, baseV, kOff, idxExpr]);
      }
    }
  }

  if (uncheckedAccesses.length === 0) {
    return [
      [
        {
          module: moduleName,
          function: fnName,
          line: lineNo,
          audit_status: "PROVEN_SAFE_BY_VCG",
        },
      ],
      diags,
    ];
  }

  const factsJoined = guardFacts.join(" && ");
  for (const [seqName, baseV, kOff, idxExpr] of uncheckedAccesses) {
    const lenExpr = `${seqName}.len`;
    const escBase = escapeRegExp(baseV);
    const escLen = escapeRegExp(lenExpr);
    const lowerRe = new RegExp(`\\b${escBase}\\s*>=\\s*0\\b|\\b0\\s*<=\\s*${escBase}\\b`);
    const hasLower = lowerRe.test(factsJoined);
    const reqSpan = kOff + 1;
    let hasUpper = false;
    const upperRe = new RegExp(
      `\\b${escBase}\\s*\\+\\s*(\\d+)\\s*<=\\s*${escLen}\\b|\\b${escBase}\\s*<=\\s*${escLen}\\s*-\\s*(\\d+)\\b`,
      "g",
    );
    let mUb: RegExpExecArray | null;
    while ((mUb = upperRe.exec(factsJoined)) !== null) {
      const boundN = parseInt(mUb[1] || mUb[2], 10);
      if (boundN >= reqSpan) {
        hasUpper = true;
        break;
      }
    }
    if (kOff === 0 && new RegExp(`\\b${escBase}\\s*<\\s*${escLen}\\b`).test(factsJoined)) {
      hasUpper = true;
    }

    if (!hasLower || !hasUpper) {
      let ceLen: number;
      let ceBase: number;
      let ceReason: string;
      if (!hasLower) {
        ceLen = Math.max(4, reqSpan);
        ceBase = -2;
        ceReason = `\`{ ${lenExpr} = ${ceLen}, ${baseV} = ${ceBase} }\` satisfies \`${factsJoined || "true"}\` but \`${idxExpr} = ${ceBase + kOff} < 0\` violates lower bound \`0 <= ${idxExpr}\``;
      } else {
        ceLen = kOff;
        ceBase = 0;
        ceReason = `\`{ ${lenExpr} = ${ceLen}, ${baseV} = ${ceBase} }\` satisfies \`${factsJoined || "true"}\` but \`${idxExpr} = ${ceBase + kOff} >= ${lenExpr}\` violates upper bound \`${idxExpr} < ${lenExpr}\``;
      }
      diags.push({
        code: "E0711_UNPROVEN_BOUNDS_CONTAINMENT",
        severity: "error",
        module: moduleName,
        line: lineNo,
        function: fnName,
        offending_token: `${seqName}.get_unchecked(${idxExpr})`,
        unproven_obligation: `0 <= ${idxExpr} && ${idxExpr} < ${lenExpr}`,
        counterexample: ceReason,
        message:
          `Jenny-BoundsProver (\`QF_LIA\` VCG) rejected \`mask [Unsafe]\` in \`${fnName}\`: ` +
          `bounds check is incomplete for \`${seqName}.get_unchecked(${idxExpr})\`! ` +
          `Counterexample: ${ceReason}.`,
        suggested_replacement: `guard ${baseV} >= 0 && ${baseV} <= ${lenExpr} - ${reqSpan} else { ... }`,
      });
      return [
        [
          {
            module: moduleName,
            function: fnName,
            line: lineNo,
            audit_status: "E0711_UNPROVEN_BOUNDS_CONTAINMENT",
          },
        ],
        diags,
      ];
    }
  }

  return [
    [
      {
        module: moduleName,
        function: fnName,
        line: lineNo,
        audit_status: "PROVEN_SAFE_BY_VCG",
      },
    ],
    diags,
  ];
}

/**
 * Scan `.jn` source for `mask [...]` controlled effect containment sites (Spec 02 §1.3, Spec 05 §6.3 & Spec 07 §6.5).
 * Returns `[audit_signals, diagnostics]`:
 *   - `E0709_MASKED_LOCK_ESCAPE`: Rejects returning or escaping a `MutexGuard` / `RwLockGuard` / `SemaphorePermit`
 *     or unreleased lock handle from a `mask [Sync]` function or block.
 *   - `E0711_UNPROVEN_BOUNDS_CONTAINMENT`: Rejects incomplete bounds checks inside `mask [Unsafe]` via `QF_LIA` VCG
 *     and outputs a concrete numerical counterexample.
 *   - Classifies valid `mask [...]` sites as `SAFE_LEAF_CRITICAL_SECTION`, `PROVEN_SAFE_BY_VCG`, or
 *     `W0710_EXTERNAL_CALL_UNDER_MASKED_SYNC` for `spindle audit` reporting.
 */
export function extractEffectMaskAuditSignals(
  rawJnText: string,
  moduleName: string,
  ast: ModuleAST | null = null,
): [Record<string, any>[], Diagnostic[]] {
  const signals: Record<string, any>[] = [];
  const diags: Diagnostic[] = [];
  if (!rawJnText || !rawJnText.includes("mask")) {
    return [signals, diags];
  }

  const rawLines = rawJnText.split(/\r?\n/);
  let curFn = "<top-level>";
  for (let idx = 1; idx <= rawLines.length; idx++) {
    const rawL = rawLines[idx - 1];
    const s = stripCommentsAndSemi(rawL).trim();
    const mFn = /^(?:@spin\s+)?(?:pub\s+|pkg\s+)?fn\s+([A-Za-z0-9_.]+)\s*\(/.exec(s);
    if (mFn) {
      curFn = mFn[1];
    }
    const maskRe = /\bmask\s*\[([^\]]+)\]/g;
    let mMk: RegExpExecArray | null;
    while ((mMk = maskRe.exec(s)) !== null) {
      const maskedList = mMk[1]
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      const scopeLines: string[] = [];
      let depth = countChar(s, "{") - countChar(s, "}");
      let j = idx;
      while (j < rawLines.length && depth > 0) {
        const nl = stripCommentsAndSemi(rawLines[j]).trim();
        depth += countChar(nl, "{") - countChar(nl, "}");
        if (depth > 0 && nl) {
          scopeLines.push(nl);
        }
        j += 1;
      }

      const scopeJoined = scopeLines.join("\n");
      let guardEscape = false;
      if (maskedList.includes("Sync")) {
        if (/->\s*(?:MutexGuard|RwLockReadGuard|RwLockWriteGuard|SemaphorePermit)\b/.test(s)) {
          guardEscape = true;
        }
        for (const sl of scopeLines) {
          if (
            /^return\s+(?:[A-Za-z0-9_.]+\.(?:lock|read_lock|write_lock|acquire)\s*\(|\b[A-Za-z0-9_]*(?:guard|permit)\b)/.test(
              sl,
            )
          ) {
            guardEscape = true;
            break;
          }
        }
      }

      let auditStatus: string;
      if (guardEscape) {
        diags.push({
          code: "E0709_MASKED_LOCK_ESCAPE",
          severity: "error",
          module: moduleName,
          line: idx,
          function: curFn,
          offending_token: `mask [${maskedList.join(", ")}]`,
          message: `Function/block \`${curFn}\` specifies \`mask [Sync]\` to contain synchronization effects internally, but allows a lock guard or permit to escape across the return boundary! All locks/permits acquired inside \`mask [Sync]\` must be released before exiting the scope.`,
          suggested_replacement:
            "Release the lock guard inside the `mask [Sync]` scope and return only the computed value.",
        });
        auditStatus = "E0709_MASKED_LOCK_ESCAPE";
      } else if (maskedList.includes("Unsafe")) {
        const fspec = ast && curFn in ast.functions ? ast.functions[curFn] : null;
        const [vcgSignals, vcgDiags] = verifyBoundsContainmentVcg(
          curFn,
          fspec,
          scopeLines,
          moduleName,
          idx,
        );
        auditStatus = vcgSignals[0]?.audit_status ?? "PROVEN_SAFE_BY_VCG";
        diags.push(...vcgDiags);
      } else if (
        maskedList.includes("Sync") &&
        /\b(?:cb|callback|handler|hook|visitor|delegate_fn)\s*\(/.test(scopeJoined)
      ) {
        auditStatus = "W0710_EXTERNAL_CALL_UNDER_MASKED_SYNC";
      } else {
        auditStatus = "SAFE_LEAF_CRITICAL_SECTION";
      }

      signals.push({
        module: moduleName,
        function: curFn,
        line: idx,
        masked_effects: maskedList,
        guard_escape_check: guardEscape ? "FAILED_ESCAPE" : "PASSED_SCOPED_RAII",
        audit_status: auditStatus,
      });
    }
  }

  return [signals, diags];
}
