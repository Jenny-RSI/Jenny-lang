#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Jenny Phase 1 LLM In-Context Evaluation & `--ai-json` Self-Healing Harness.

Supports:
  - `--provider mock`: Offline self-healing simulation testing the full loop.
  - `--provider ollama --model qwen2.5-coder:3b`: Live local LLM evaluation via Ollama HTTP API
    (`http://127.0.0.1:11434/api/generate`), measuring real Pass@1, Heal@2, Heal@3, latency,
    and generating the Phase 1 Error Heatmap across Jenny benchmarks.
"""

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR / "compiler" / "jenny-flow"))
sys.path.insert(0, str(ROOT_DIR / "benchmarks" / "eval"))

import jenny_flow  # type: ignore
import measure_tokens  # type: ignore

SYNTAX_CARD_PATH = ROOT_DIR / "benchmarks" / "eval" / "jenny_syntax_card.md"


def apply_ai_json_fixes(bad_jn_code: str, ai_diagnostics: List[Dict]) -> str:
    """
    Apply deterministic `jenny-flow` `--ai-json` quick-fixes for forbidden syntax.
    """
    lines = bad_jn_code.splitlines()
    for diag in ai_diagnostics:
        line_idx = diag.get("line", 0) - 1
        code = diag["code"]
        if 0 <= line_idx < len(lines):
            if code in (
                "E0101_FORBIDDEN_REF_SYNTAX",
                "E0103_FORBIDDEN_RUST_CAST_AS",
                "E0401_FFI_IMPLICIT_RAW_PTR",
            ):
                lines[line_idx] = lines[line_idx].replace(
                    diag["offending_token"], diag["suggested_replacement"]
                )
            elif code == "E0102_FORBIDDEN_LET_BINDING":
                lines[line_idx] = (
                    lines[line_idx].replace("let mut ", "var ").replace("let ", "val ")
                )
            elif code == "E0106_MISSING_TRY_OPERATOR":
                stripped_l = lines[line_idx].rstrip().rstrip(";")
                if not stripped_l.endswith("?"):
                    lines[line_idx] = stripped_l + "?"
            elif code == "E0107_FORBIDDEN_RUST_OPTION_RESULT":
                fixed_l = re.sub(r"\.unwrap_or\(([^)]+)\)", r" ?? \1", lines[line_idx])
                fixed_l = re.sub(r"^(\s*)Ok\((.+?)\);?\s*$", r"\1return \2", fixed_l)
                fixed_l = re.sub(r"^(\s*)(?:return\s+)?Err\((.+?)\);?\s*$", r"\1raise \2", fixed_l)
                lines[line_idx] = fixed_l
            elif code == "E0108_MISSING_ENSURES_FIELD_MUTATION":
                fn_name = diag.get("function", "")
                repl = diag.get("suggested_replacement", "")
                if fn_name and repl:
                    # Remove any partial branch-only occurrence of `repl` first
                    lines = [l for l in lines if l.strip().rstrip(";") != repl.strip().rstrip(";")]
                    for idx_l, l_txt in enumerate(lines):
                        if re.search(rf"\bfn\s+{fn_name}\s*\(", l_txt):
                            brace_l = idx_l
                            while brace_l < len(lines) and not lines[brace_l].rstrip().endswith("{"):
                                brace_l += 1
                            if brace_l < len(lines):
                                lines.insert(brace_l + 1, f"        {repl}")
                            break
    return "\n".join(lines)


def extract_code_from_llm(raw_text: str) -> str:
    """
    Extract pure `.jn` implementation code from an LLM markdown response.
    """
    fenced = re.findall(r"```(?:jenny|jn|rust|c)?\s*\n(.*?)```", raw_text, flags=re.DOTALL)
    if fenced:
        code = "\n\n".join(block.strip() for block in fenced)
    else:
        code = raw_text.strip()
    # Strip any accidental top-level struct/enum or @example re-declarations if the model repeated `.jni` items
    cleaned_lines: List[str] = []
    skip_type_block = False
    brace_depth = 0
    for line in code.splitlines():
        s = line.strip()
        is_top_level = len(line) - len(line.lstrip()) == 0
        if not skip_type_block and is_top_level and (
            s.startswith("@apply(")
            or s.startswith("@repr(")
            or s.startswith("import c ")
        ):
            continue
        if not skip_type_block and is_top_level and (
            re.match(r"^(?:@\w+\([^)]*\)\s+)?(pub\s+)?(struct|enum|trait)\s+\w+\s*\{", s)
            or s.startswith("@example(")
        ):
            skip_type_block = True
            brace_depth = line.count("{") - line.count("}")
            continue
        if skip_type_block:
            brace_depth += line.count("{") - line.count("}")
            if brace_depth <= 0:
                skip_type_block = False
            continue
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip() + "\n"


def call_ollama(prompt: str, model: str, endpoint: str) -> Tuple[str, float, float]:
    """
    Call Ollama `/api/generate` and return (response_text, elapsed_sec, tokens_per_sec).
    """
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.0,
                "seed": 42,
                "num_ctx": 4096,
                "num_predict": 1024,
            },
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        endpoint, data=payload, headers={"Content-Type": "application/json"}
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    t0 = time.perf_counter()
    with opener.open(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    elapsed = time.perf_counter() - t0
    eval_count = data.get("eval_count", 0)
    eval_duration_ns = data.get("eval_duration", 0)
    tps = (eval_count / (eval_duration_ns / 1e9)) if eval_duration_ns > 0 else 0.0
    return data.get("response", ""), round(elapsed, 2), round(tps, 1)


def build_round1_prompt(
    syntax_card: str, jni_text: str, skeleton: str, module_name: str, blind_mode: bool = True
) -> str:
    visible_jni = jenny_flow.strip_jenny_test_for_agent(jni_text) if blind_mode else jni_text
    return f"""You are an expert developer in the Spinning Jenny (`Jenny` v2.0) programming language.
Read the Jenny v2.0 Syntax Card below carefully and strictly follow every rule:

{syntax_card}

CRITICAL RULES FOR `.jn` IMPLEMENTATION FILES:
1. Fill in the `// TODO: implement` bodies of the compiler-generated `.jn` skeleton below.
2. Output ONLY a single ```jenny ... ``` code block containing the complete `.jn` file.
3. Do NOT re-declare `struct` or `enum` types, and do NOT write `requires` or `ensures` in `.jn`.
4. NEVER use `&self`, `&mut self`, `&T`, `&mut T`, or `let`. Use `self`, `mut self`, `val`, and `var`.
5. Every non-void `pub fn` MUST use explicit `return expr`.
6. Pay close attention to the Markdown design specification and the formal `requires` / `ensures` / `invariant` contracts in `jenny_decl`! (Note: `jenny_test` is withheld in blind evaluation mode—implement the general algorithm, never hardcode test literals.)

### `.jni` Literate Contract Blueprint (`jenny_decl`) for `{module_name}`:
```markdown
{visible_jni}
```

### Compiler-Generated `.jn` Skeleton (`jenny skeleton`):
```jenny
{skeleton}
```

Now write the complete `.jn` implementation for `{module_name}` inside a ```jenny ... ``` block:
"""


def build_self_heal_prompt(
    syntax_card: str,
    jni_text: str,
    skeleton: str,
    prev_jn: str,
    eval_result: Dict,
    blind_mode: bool = True,
) -> str:
    visible_jni = jenny_flow.strip_jenny_test_for_agent(jni_text) if blind_mode else jni_text
    diags = eval_result.get("ai_diagnostics", [])
    compile_err = eval_result.get("compile_stderr", "")
    failed_examples = [
        ex for ex in eval_result.get("examples", []) if not ex.get("passed", False)
    ]
    feedback_parts: List[str] = []
    if diags:
        feedback_parts.append(
            "1. Jenny `--ai-json` Syntax & Contract Diagnostics:\n"
            + json.dumps(diags, indent=2, ensure_ascii=False)
        )
    if compile_err:
        feedback_parts.append(f"2. Compiler Error Output:\n{compile_err}")
    if failed_examples:
        contract_alerts: List[str] = []
        for ex in failed_examples:
            stdout_txt = ex.get("stdout", "")
            for line in stdout_txt.splitlines():
                if "JENNY_CONTRACT_VIOLATION" in line:
                    try:
                        vobj = json.loads(line.strip())
                        contract_alerts.append(
                            f"- CRITICAL CONTRACT VIOLATION in `{vobj.get('function')}` ({vobj.get('kind')}): "
                            f"Failed condition `{vobj.get('condition')}`! Check all struct fields updated in `{vobj.get('function')}`!"
                        )
                    except Exception:
                        pass
        if contract_alerts:
            feedback_parts.append(
                "3. CRITICAL CONTRACT / ASSERTION VIOLATIONS TO FIX:\n"
                + "\n".join(contract_alerts)
            )
        shown_examples = (
            jenny_flow.desensitize_failed_examples(failed_examples, jni_text)
            if blind_mode
            else failed_examples
        )
        feedback_parts.append(
            "4. Desensitized Sandbox Verification Feedback (Test Literals Redacted):\n"
            + json.dumps(shown_examples, indent=2, ensure_ascii=False)
        )
    feedback_str = "\n\n".join(feedback_parts)

    return f"""Your previous Jenny (`.jn`) implementation failed compiler or contract verification!

### Compiler & Contract Sandbox Feedback (`--ai-json`):
{feedback_str}

{syntax_card}

### Blueprint (`jenny_decl`):
```markdown
{visible_jni}
```

### Required `.jn` Function Skeleton (`jenny skeleton`):
```jenny
{skeleton}
```

### Your Previous `.jn` Code:
```jenny
{prev_jn}
```

Fix ALL errors above:
- Keep the exact `module` and `impl` / `pub fn` structure from the `.jn` skeleton.
- Never use `&self`, `&mut self`, `&T`, `&mut T`, or `let` (use `self`, `mut self`, `val`, `var`).
- Apply every `suggested_replacement` from `--ai-json` diagnostics!
Output ONLY the corrected `.jn` code inside a ```jenny ... ``` block:
"""


def build_architect_audit_prompt(
    jni_text: str,
    last_failed_jn: str,
    static_audit: Dict,
) -> str:
    return f"""You are the Lead Architect Agent for the Spinning Jenny (`Jenny` v2.0) programming language.
The Code Agent failed all 3 blind implementation & self-healing rounds (`Heal@3` exhausted).
Unlike the Code Agent (which was blind to `jenny_test`), you have FULL privileged access to both `jenny_decl` and `jenny_test`.

### Static Root-Cause Pre-Audit:
{json.dumps(static_audit, indent=2, ensure_ascii=False)}

### Complete `.jni` Blueprint (`jenny_decl` + `jenny_test`):
```markdown
{jni_text}
```

### Code Agent's Final Failed `.jn` Implementation (Round 3):
```jenny
{last_failed_jn}
```

Provide a concise 2-sentence root-cause diagnosis explaining:
1. Why the Code Agent failed (confirming whether it is `{static_audit.get('root_cause_category')}`), and
2. The exact algorithmic or contract fix required (without telling the Code Agent to hardcode test literals).
"""


def classify_failure_reasons(eval_result: Dict, raw_jn: str) -> List[str]:
    reasons: List[str] = []
    for d in eval_result.get("ai_diagnostics", []):
        reasons.append(d["code"])
    if eval_result.get("tolerant_semicolons", 0) > 0:
        reasons.append("W0103_TOLERANT_TRAILING_SEMICOLON")
    if not eval_result.get("compile_ok", False) and not eval_result.get("ai_diagnostics"):
        stderr = eval_result.get("compile_stderr", "")
        if "undeclared" in stderr or "implicit declaration" in stderr:
            reasons.append("E0201_UNDECLARED_IDENTIFIER_OR_TYPE")
        else:
            reasons.append("E0200_C99_BACKEND_SYNTAX_MISMATCH")
    for ex in eval_result.get("examples", []):
        if not ex.get("passed", False):
            if ex.get("exit_code") == 42:
                reasons.append("E0301_CONTRACT_VIOLATION_AT_RUNTIME")
            else:
                reasons.append("E0302_EXAMPLE_ASSERTION_FAILURE")
    return sorted(list(set(reasons)))


def evaluate_benchmark_with_ollama(
    bench_dir: Path,
    syntax_card: str,
    model: str,
    endpoint: str,
    max_rounds: int = 3,
    blind_mode: bool = True,
    architect_model: Optional[str] = None,
) -> Dict:
    jni_file = next(bench_dir.glob("*.jni"))
    jn_file = next(bench_dir.glob("*.jn"))
    jni_text = jni_file.read_text(encoding="utf-8")
    golden_jn_text = jn_file.read_text(encoding="utf-8") if jn_file.exists() else None
    blind_jni_text = jenny_flow.strip_jenny_test_for_agent(jni_text)
    full_jni_tokens = measure_tokens.count_code_tokens(jni_text)
    blind_jni_tokens = measure_tokens.count_code_tokens(blind_jni_text)

    ast_for_skel = jenny_flow.parse_jni_blueprint(jni_text)
    skeleton = jenny_flow.generate_jn_skeleton(ast_for_skel)
    rounds_log: List[Dict] = []
    current_jn = ""
    passed_at_round: Optional[int] = None
    round1_errors: List[str] = []

    for r_idx in range(1, max_rounds + 1):
        if r_idx == 1:
            prompt = build_round1_prompt(
                syntax_card, jni_text, skeleton, bench_dir.name, blind_mode=blind_mode
            )
        else:
            prompt = build_self_heal_prompt(
                syntax_card,
                jni_text,
                skeleton,
                current_jn,
                rounds_log[-1]["eval_result"],
                blind_mode=blind_mode,
            )

        raw_resp, elapsed_s, tps = call_ollama(prompt, model, endpoint)
        extracted_jn = extract_code_from_llm(raw_resp)

        # In Round >= 2, also assist with deterministic `--ai-json` token replacements if needed
        eval_res = jenny_flow.compile_and_run_benchmark(bench_dir, custom_jn_text=extracted_jn)
        if r_idx >= 2 and eval_res.get("ai_diagnostics"):
            patched_jn = apply_ai_json_fixes(extracted_jn, eval_res["ai_diagnostics"])
            if patched_jn != extracted_jn:
                extracted_jn = patched_jn
                eval_res = jenny_flow.compile_and_run_benchmark(
                    bench_dir, custom_jn_text=extracted_jn
                )
        if (
            r_idx >= 2
            and not eval_res.get("compile_ok", False)
            and rounds_log[-1]["eval_result"].get("ai_diagnostics")
        ):
            prev_patched = apply_ai_json_fixes(
                rounds_log[-1]["generated_jn"],
                rounds_log[-1]["eval_result"]["ai_diagnostics"],
            )
            if prev_patched != rounds_log[-1]["generated_jn"]:
                prev_res = jenny_flow.compile_and_run_benchmark(
                    bench_dir, custom_jn_text=prev_patched
                )
                if prev_res.get("compile_ok", False):
                    extracted_jn = prev_patched
                    eval_res = prev_res

        current_jn = extracted_jn
        compile_ok = eval_res.get("compile_ok", False)
        examples = eval_res.get("examples", [])
        all_ex_ok = compile_ok and len(examples) > 0 and all(e["passed"] for e in examples)
        failure_tags = classify_failure_reasons(eval_res, extracted_jn)
        if r_idx == 1:
            round1_errors = failure_tags

        rounds_log.append(
            {
                "round": r_idx,
                "elapsed_sec": elapsed_s,
                "tokens_per_sec": tps,
                "compile_ok": compile_ok,
                "all_examples_passed": all_ex_ok,
                "tolerant_semicolons": eval_res.get("tolerant_semicolons", 0),
                "failure_tags": failure_tags,
                "generated_jn": extracted_jn,
                "eval_result": {
                    "compile_ok": compile_ok,
                    "compile_stderr": eval_res.get("compile_stderr", "")[:500],
                    "ai_diagnostics": eval_res.get("ai_diagnostics", []),
                    "examples": examples,
                },
            }
        )

        if all_ex_ok:
            passed_at_round = r_idx
            break

    # Fallback Strategy: If all 3 repair rounds fail (`passed_at_round is None`),
    # trigger the Architect Agent Root-Cause Audit with full `.jni` (`jenny_decl` + `jenny_test`) visibility!
    architect_audit: Optional[Dict] = None
    if passed_at_round is None:
        audit_input_history = [
            {
                "round": r["round"],
                "jn_code": r["generated_jn"],
                "failure_reasons": r["failure_tags"],
                "ai_diagnostics": r["eval_result"]["ai_diagnostics"],
                "compile_stderr": r["eval_result"]["compile_stderr"],
                "examples": r["eval_result"]["examples"],
            }
            for r in rounds_log
        ]
        architect_audit = jenny_flow.run_architect_root_cause_audit(
            jni_text, ast_for_skel, audit_input_history, golden_jn_text=golden_jn_text
        )
        arch_model_name = architect_model or model
        try:
            arch_prompt = build_architect_audit_prompt(
                jni_text, current_jn, architect_audit
            )
            arch_resp, arch_sec, _ = call_ollama(arch_prompt, arch_model_name, endpoint)
            architect_audit["architect_model"] = arch_model_name
            architect_audit["architect_llm_diagnosis"] = arch_resp.strip()
            architect_audit["audit_elapsed_sec"] = arch_sec
        except Exception as exc:
            architect_audit["architect_llm_diagnosis"] = f"Static audit completed ({exc})"

    # Always restore the canonical `.jn` C99 build after evaluating
    jenny_flow.compile_and_run_benchmark(bench_dir)

    return {
        "benchmark": bench_dir.name,
        "blind_mode": blind_mode,
        "full_jni_tokens": full_jni_tokens,
        "blind_jni_tokens": blind_jni_tokens,
        "prompt_jni_token_reduction_pct": round(
            (1.0 - blind_jni_tokens / max(1, full_jni_tokens)) * 100.0, 1
        ),
        "passed_at_round": passed_at_round,
        "pass_at_1": passed_at_round == 1,
        "heal_at_2": passed_at_round is not None and passed_at_round <= 2,
        "heal_at_3": passed_at_round is not None and passed_at_round <= 3,
        "round1_failure_tags": round1_errors,
        "architect_root_cause_audit": architect_audit,
        "rounds": rounds_log,
    }


def run_mock_self_heal_suite() -> Dict:
    b01_dir = ROOT_DIR / "benchmarks" / "seed_10" / "B01_ring_buffer"
    b05_dir = ROOT_DIR / "benchmarks" / "seed_10" / "B05_order_pipeline"
    b11_dir = ROOT_DIR / "benchmarks" / "stage1_flow" / "B11_layered_gateway"

    b01_clean = (b01_dir / "ring_buffer.jn").read_text(encoding="utf-8")
    b05_clean = (b05_dir / "order_pipeline.jn").read_text(encoding="utf-8")
    b11_clean = (b11_dir / "layered_gateway.jn").read_text(encoding="utf-8")

    test_cases = [
        {
            "id": "HEAL-01",
            "dir": b01_dir,
            "simulated_prior_error": "Rust habit: wrote `&mut self` and `&self` in RingBuffer",
            "round1_jn": b01_clean.replace("mut self", "&mut self").replace("(self)", "(&self)"),
        },
        {
            "id": "HEAL-02",
            "dir": b05_dir,
            "simulated_prior_error": "Rust/TS habit: wrote `let ` bindings and trailing `;` in OrderPipeline",
            "round1_jn": b05_clean.replace("val available", "let available").replace(
                "return 10", "return 10;"
            ),
        },
        {
            "id": "HEAL-03",
            "dir": b11_dir,
            "simulated_prior_error": "Rust habit: wrote `let unit_price` and trailing `;` in LayeredGateway",
            "round1_jn": b11_clean.replace("val unit_price", "let unit_price").replace(
                "return 1000", "return 1000;"
            ),
        },
    ]

    cases_report = []
    for tc in test_cases:
        r1 = jenny_flow.compile_and_run_benchmark(tc["dir"], custom_jn_text=tc["round1_jn"])
        r1_diags = r1.get("ai_diagnostics", [])
        healed_jn = apply_ai_json_fixes(tc["round1_jn"], r1_diags)
        r2 = jenny_flow.compile_and_run_benchmark(tc["dir"], custom_jn_text=healed_jn)
        jenny_flow.compile_and_run_benchmark(tc["dir"])
        r2_passed = r2.get("compile_ok", False) and all(
            ex["passed"] for ex in r2.get("examples", [])
        )
        cases_report.append(
            {
                "case_id": tc["id"],
                "simulated_error": tc["simulated_prior_error"],
                "round1_compile_ok": r1.get("compile_ok", False),
                "round1_ai_diagnostics_count": len(r1_diags),
                "round1_diagnostics": r1_diags,
                "round2_healed_ok": r2_passed,
                "round2_tolerant_semicolons": r2.get("tolerant_semicolons", 0),
            }
        )

    # 4. Verify Blind-Test Stripping & E0905 Anti-Overfitting Audit
    b01_jni = (b01_dir / "ring_buffer.jni").read_text(encoding="utf-8")
    blind_b01_jni = jenny_flow.strip_jenny_test_for_agent(b01_jni)
    cheating_jn = b01_clean.replace(
        "return self.len == self.capacity",
        "if self.len == 999 { return true }\n        return self.len == self.capacity",
    )
    overfit_res = jenny_flow.compile_and_run_benchmark(b01_dir, custom_jn_text=cheating_jn)
    jenny_flow.compile_and_run_benchmark(b01_dir)
    overfit_caught = any(
        d["code"] == "E0905_TEST_LITERAL_OVERFITTING"
        for d in overfit_res.get("ai_diagnostics", [])
    )

    # 5. Verify Heal@3 Exhausted -> Architect Root-Cause Audit Fallback (RC1 / RC2 / RC3)
    b01_ast = jenny_flow.parse_jni_blueprint(b01_jni)
    broken_jn = b01_clean.replace("self.len += 1", "// forgot to increment len")
    broken_eval = jenny_flow.compile_and_run_benchmark(b01_dir, custom_jn_text=broken_jn)
    jenny_flow.compile_and_run_benchmark(b01_dir)
    mock_3_rounds = [
        {
            "round": r,
            "jn_code": broken_jn,
            "failure_reasons": classify_failure_reasons(broken_eval, broken_jn),
            "ai_diagnostics": broken_eval.get("ai_diagnostics", []),
            "compile_stderr": broken_eval.get("compile_stderr", ""),
            "examples": broken_eval.get("examples", []),
        }
        for r in (1, 2, 3)
    ]
    architect_report = jenny_flow.run_architect_root_cause_audit(
        b01_jni, b01_ast, mock_3_rounds, golden_jn_text=b01_clean
    )

    return {
        "all_healed_at_round2": all(c["round2_healed_ok"] for c in cases_report),
        "blind_test_stripped_cleanly": "@example" not in blind_b01_jni and "jenny_test" not in blind_b01_jni,
        "e0905_overfitting_caught": overfit_caught,
        "architect_audit_fallback_verified": (
            architect_report["root_cause_category"] == "RC3_ALGORITHMIC_BOTTLENECK"
            and bool(architect_report.get("algorithmic_prescription"))
        ),
        "architect_sample_report": architect_report,
        "cases": cases_report,
    }


def get_target_benchmarks(filter_names: Optional[List[str]] = None) -> List[Path]:
    all_dirs = sorted(
        list((ROOT_DIR / "benchmarks" / "seed_10").glob("B*"))
        + list((ROOT_DIR / "benchmarks" / "stage1_flow").glob("B*"))
        + list((ROOT_DIR / "benchmarks" / "stage2_mem").glob("B*"))
        + list((ROOT_DIR / "benchmarks" / "stage3_spin").glob("B*"))
        + list((ROOT_DIR / "benchmarks" / "stage4_native").glob("B*"))
    )
    if not filter_names:
        return all_dirs
    return [d for d in all_dirs if any(f in d.name for f in filter_names)]


def main():
    parser = argparse.ArgumentParser(description="Jenny LLM Evaluation & Self-Healing Harness")
    parser.add_argument("--provider", choices=["mock", "ollama"], default="mock")
    parser.add_argument("--model", default="qwen2.5-coder:3b")
    parser.add_argument("--architect-model", default=None, help="Model for Architect Root-Cause Audit when Heal@3 fails")
    parser.add_argument("--endpoint", default="http://127.0.0.1:11434/api/generate")
    parser.add_argument(
        "--benchmarks",
        nargs="*",
        default=None,
        help="Optional benchmark prefixes to evaluate (e.g., B01 B04 B05 B06 B11 B12)",
    )
    parser.add_argument("--max-rounds", type=int, default=3)
    parser.add_argument(
        "--allow-test-peek",
        action="store_true",
        help="Disable default blind-test isolation (for ablation studies only)",
    )
    parser.add_argument("--output-json", default=None)
    args = parser.parse_args()

    card_text = SYNTAX_CARD_PATH.read_text(encoding="utf-8")
    card_tokens = measure_tokens.count_code_tokens(card_text)
    blind_mode = not args.allow_test_peek

    if args.provider == "mock":
        heal_report = run_mock_self_heal_suite()
        out = {
            "syntax_card_path": str(SYNTAX_CARD_PATH.relative_to(ROOT_DIR)),
            "syntax_card_tokens": card_tokens,
            "syntax_card_within_400_budget": card_tokens <= 400,
            "mode": "mock_self_heal_and_blind_audit_verification",
            "self_heal_suite": heal_report,
        }
    else:
        target_dirs = get_target_benchmarks(args.benchmarks)
        results = []
        heatmap: Dict[str, int] = {}
        architect_audits: List[Dict] = []
        for bdir in target_dirs:
            sys.stderr.write(
                f"[Ollama:{args.model} | Blind={blind_mode}] Evaluating {bdir.name}...\n"
            )
            res = evaluate_benchmark_with_ollama(
                bdir,
                card_text,
                args.model,
                args.endpoint,
                max_rounds=args.max_rounds,
                blind_mode=blind_mode,
                architect_model=args.architect_model,
            )
            results.append(res)
            for tag in res["round1_failure_tags"]:
                heatmap[tag] = heatmap.get(tag, 0) + 1
            if res.get("architect_root_cause_audit"):
                architect_audits.append(
                    {
                        "benchmark": bdir.name,
                        **res["architect_root_cause_audit"],
                    }
                )

        total = len(results)
        p1 = sum(1 for r in results if r["pass_at_1"])
        h2 = sum(1 for r in results if r["heal_at_2"])
        h3 = sum(1 for r in results if r["heal_at_3"])
        avg_tps = round(
            sum(r["rounds"][0]["tokens_per_sec"] for r in results) / max(1, total), 1
        )
        avg_tok_red = round(
            sum(r["prompt_jni_token_reduction_pct"] for r in results) / max(1, total), 1
        )
        out = {
            "provider": "ollama",
            "model": args.model,
            "blind_mode": blind_mode,
            "avg_prompt_jni_token_reduction_pct": avg_tok_red,
            "syntax_card_tokens": card_tokens,
            "total_benchmarks": total,
            "pass_at_1_count": p1,
            "pass_at_1_rate": round(p1 / max(1, total), 4),
            "heal_at_2_count": h2,
            "heal_at_2_rate": round(h2 / max(1, total), 4),
            "heal_at_3_count": h3,
            "heal_at_3_rate": round(h3 / max(1, total), 4),
            "architect_audit_triggered_count": len(architect_audits),
            "architect_root_cause_audits": architect_audits,
            "avg_tokens_per_sec": avg_tps,
            "round1_error_heatmap": heatmap,
            "benchmarks": results,
        }

    json_txt = json.dumps(out, indent=2, ensure_ascii=False)
    if args.output_json:
        Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output_json).write_text(json_txt, encoding="utf-8")
    else:
        print(json_txt)


if __name__ == "__main__":
    main()
