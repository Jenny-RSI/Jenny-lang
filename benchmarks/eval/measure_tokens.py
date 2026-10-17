#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Jenny Token Economics (TCR, TCR_impl, ECC) and v2.0 Syntax Compliance Evaluator.

Uses a deterministic lexical/subword regex counter (`TOKEN_PATTERN`) so that any
reviewer running `python benchmarks/eval/measure_tokens.py` reproduces the exact
integer counts reported in the paper without external tokenizer drift.

Reports three independent, non-overlapping metric families:
1. Implementation Writing Volume (`TCR_impl` vs full `.rs` and `TCR_impl_vs_prod` vs production `.rs` excluding `#[cfg(test)]`, plus `.spun/` expanded tokens).
2. Code & Document Volume (`TCR` = `(.jni fenced + .jn) / .rs`, `TCR_vs_prod`, and `TCR_doc_all` including `.jni` Markdown prose).
3. Cross-Module Interface Footprint (`ECC_self = 1 - .jni_iface / (.jni_fenced + .jn)`, `ECC_vs_rs = 1 - .jni_iface / .rs`, `ECC_vs_rs_prod = 1 - .jni_iface / .rs_prod`).
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

ROOT_DIR = Path(__file__).resolve().parents[2]
SEED_DIR = ROOT_DIR / "benchmarks" / "seed_10"

TOKEN_PATTERN = re.compile(
    r"[A-Za-z_][A-Za-z0-9_]*|[0-9]+|==|!=|<=|>=|->|=>|::|\+=|-=|\*=|/=|&&|\|\||[^\s\w]"
)

SPUN_MAP = {
    "B18_trait_delegate_decorator": "trait_delegate.spun.jn",
    "B19_spin_fsm_order": "spin_fsm_order.spun.jn",
    "B20_spin_binary_codec": "spin_binary_codec.spun.jn",
    "B21_spin_crud_service": "spin_crud_service.spun.jn",
    "B24_kv_storage_engine": "kv_storage_engine.spun.jn",
}


def count_code_tokens(code: str) -> int:
    """Count deterministic lexical/subword code tokens (stripping `//` comments and blank lines)."""
    lines = []
    for line in code.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    return len(TOKEN_PATTERN.findall(cleaned))


def extract_jni_parts(jni_text: str) -> Tuple[str, str, str]:
    """
    Return (all_fenced_jenny_code, interface_only_code_without_examples, markdown_prose_outside_fences).
    """
    blocks = re.findall(r"```jenny\s*\n(.*?)```", jni_text, flags=re.DOTALL)
    full_code = "\n".join(blocks)
    prose_only = re.sub(r"```jenny\s*\n.*?```", "", jni_text, flags=re.DOTALL)

    # Remove @example(...) { ... } blocks to measure downstream caller interface context
    interface_lines = []
    in_example = False
    brace_depth = 0
    for line in full_code.splitlines():
        if line.strip().startswith("@example"):
            in_example = True
            brace_depth = line.count("{") - line.count("}")
            if brace_depth <= 0:
                in_example = False
            continue
        if in_example:
            brace_depth += line.count("{") - line.count("}")
            if brace_depth <= 0:
                in_example = False
            continue
        interface_lines.append(line)
    return full_code, "\n".join(interface_lines), prose_only


def extract_jni_code_blocks(jni_text: str) -> Tuple[str, str]:
    full_code, iface_code, _ = extract_jni_parts(jni_text)
    return full_code, iface_code


def check_v2_syntax_compliance(jni_text: str, jn_text: str) -> Dict[str, int]:
    """Check SYN-01 through SYN-05 v2.0 syntax compliance rules."""
    jni_code, _ = extract_jni_code_blocks(jni_text)
    combined_code = jni_code + "\n" + jn_text

    syn01_matches = re.findall(r"(?<!&)&(?!&)\s*(?:mut\b|self\b|\*|\^|[A-Za-z_])", combined_code)
    syn02_matches = re.findall(r"<'[a-z_]+>|\bview\s+struct\b", combined_code)
    syn03_matches = re.findall(r"\bif\s+let\b|#if\b|@meta\b", combined_code)
    syn04_matches = re.findall(r"^\s*///|^\s*//!", jni_text, flags=re.MULTILINE)

    syn05_violations = 0
    fn_pattern = re.compile(
        r"pub\s+fn\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*->\s*([^{]+)\{",
        flags=re.MULTILINE,
    )
    for match in fn_pattern.finditer(jn_text):
        ret_type = match.group(2).strip()
        if ret_type.startswith("void"):
            continue
        start_idx = match.end()
        depth = 1
        idx = start_idx
        while idx < len(jn_text) and depth > 0:
            if jn_text[idx] == "{":
                depth += 1
            elif jn_text[idx] == "}":
                depth -= 1
            idx += 1
        body = jn_text[start_idx : idx - 1]
        if "return " not in body and "raise " not in body:
            syn05_violations += 1

    return {
        "SYN-01": len(syn01_matches),
        "SYN-02": len(syn02_matches),
        "SYN-03": len(syn03_matches),
        "SYN-04": len(syn04_matches),
        "SYN-05": syn05_violations,
    }


def _aggregate_subset(rows: List[Dict]) -> Dict:
    rs = sum(r["rs_tokens"] for r in rows)
    rs_prod = sum(r["rs_prod_tokens"] for r in rows)
    rs_test = sum(r["rs_test_tokens"] for r in rows)
    jni_iface = sum(r["jni_iface_tokens"] for r in rows)
    jni_full = sum(r["jni_full_tokens"] for r in rows)
    jni_prose = sum(r["jni_prose_tokens"] for r in rows)
    jn = sum(r["jn_tokens"] for r in rows)
    spun = sum(r["spun_tokens"] for r in rows)
    jenny_code = sum(r["jenny_total_tokens"] for r in rows)
    jenny_doc_all = sum(r["jenny_doc_all_tokens"] for r in rows)
    return {
        "module_count": len(rows),
        "rs_tokens": rs,
        "rs_prod_tokens": rs_prod,
        "rs_test_tokens": rs_test,
        "jni_iface_tokens": jni_iface,
        "jni_full_tokens": jni_full,
        "jni_prose_tokens": jni_prose,
        "jn_tokens": jn,
        "spun_tokens": spun,
        "jenny_total_tokens": jenny_code,
        "jenny_doc_all_tokens": jenny_doc_all,
        "tcr": round(jenny_code / rs, 4) if rs else 0.0,
        "tcr_vs_prod": round(jenny_code / rs_prod, 4) if rs_prod else 0.0,
        "tcr_doc_all": round(jenny_doc_all / rs, 4) if rs else 0.0,
        "tcr_impl": round(jn / rs, 4) if rs else 0.0,
        "tcr_impl_vs_prod": round(jn / rs_prod, 4) if rs_prod else 0.0,
        "ecc_saving_self": round(1.0 - (jni_iface / jenny_code), 4) if jenny_code else 0.0,
        "ecc_saving_vs_rs": round(1.0 - (jni_iface / rs), 4) if rs else 0.0,
        "ecc_saving_vs_rs_prod": round(1.0 - (jni_iface / rs_prod), 4) if rs_prod else 0.0,
    }


def evaluate_all() -> Dict:
    seed_dirs = sorted([d for d in SEED_DIR.iterdir() if d.is_dir()])
    s1_dir = ROOT_DIR / "benchmarks" / "stage1_flow"
    s1_dirs = sorted([d for d in s1_dir.iterdir() if d.is_dir()]) if s1_dir.exists() else []
    s2_dir = ROOT_DIR / "benchmarks" / "stage2_mem"
    s2_dirs = sorted([d for d in s2_dir.iterdir() if d.is_dir()]) if s2_dir.exists() else []
    s3_dir = ROOT_DIR / "benchmarks" / "stage3_spin"
    s3_dirs = sorted([d for d in s3_dir.iterdir() if d.is_dir()]) if s3_dir.exists() else []
    s4_dir = ROOT_DIR / "benchmarks" / "stage4_native"
    s4_dirs = sorted([d for d in s4_dir.iterdir() if d.is_dir()]) if s4_dir.exists() else []
    benchmarks = seed_dirs + s1_dirs + s2_dirs + s3_dirs + s4_dirs

    rows = []
    syn_totals = {"SYN-01": 0, "SYN-02": 0, "SYN-03": 0, "SYN-04": 0, "SYN-05": 0}

    for bdir in benchmarks:
        jni_file = next(bdir.glob("*.jni"))
        jn_file = next(bdir.glob("*.jn"))
        rs_file = next(bdir.glob("*.rs"))

        jni_text = jni_file.read_text(encoding="utf-8")
        jn_text = jn_file.read_text(encoding="utf-8")
        rs_text = rs_file.read_text(encoding="utf-8")

        jni_full_code, jni_iface_code, jni_prose = extract_jni_parts(jni_text)
        rs_prod_text = rs_text.split("#[cfg(test)]")[0]

        rs_tokens = count_code_tokens(rs_text)
        rs_prod_tokens = count_code_tokens(rs_prod_text)
        rs_test_tokens = rs_tokens - rs_prod_tokens

        jni_full_tokens = count_code_tokens(jni_full_code)
        jni_iface_tokens = count_code_tokens(jni_iface_code)
        jni_prose_tokens = count_code_tokens(jni_prose)
        jn_tokens = count_code_tokens(jn_text)
        jenny_total = jni_full_tokens + jn_tokens
        jenny_doc_all = jni_prose_tokens + jenny_total

        spun_tokens = jn_tokens
        if bdir.name in SPUN_MAP:
            spun_path = ROOT_DIR / ".spun" / SPUN_MAP[bdir.name]
            if spun_path.exists():
                spun_tokens = count_code_tokens(spun_path.read_text(encoding="utf-8"))

        syn = check_v2_syntax_compliance(jni_text, jn_text)
        for k, v in syn.items():
            syn_totals[k] += v

        rows.append(
            {
                "benchmark": bdir.name,
                "rs_tokens": rs_tokens,
                "rs_prod_tokens": rs_prod_tokens,
                "rs_test_tokens": rs_test_tokens,
                "jni_iface_tokens": jni_iface_tokens,
                "jni_full_tokens": jni_full_tokens,
                "jni_prose_tokens": jni_prose_tokens,
                "jn_tokens": jn_tokens,
                "spun_tokens": spun_tokens,
                "jenny_total_tokens": jenny_total,
                "jenny_doc_all_tokens": jenny_doc_all,
                "tcr": round(jenny_total / rs_tokens, 4),
                "tcr_vs_prod": round(jenny_total / rs_prod_tokens, 4),
                "tcr_doc_all": round(jenny_doc_all / rs_tokens, 4),
                "tcr_impl": round(jn_tokens / rs_tokens, 4),
                "tcr_impl_vs_prod": round(jn_tokens / rs_prod_tokens, 4),
                "ecc_saving": round(1.0 - (jni_iface_tokens / jenny_total), 4),
                "ecc_saving_vs_rs": round(1.0 - (jni_iface_tokens / rs_tokens), 4),
                "ecc_saving_vs_rs_prod": round(1.0 - (jni_iface_tokens / rs_prod_tokens), 4),
                "syntax_violations": syn,
            }
        )

    all_agg = _aggregate_subset(rows)
    b01_b24_agg = _aggregate_subset(rows[:24])
    b25_agg = _aggregate_subset(rows[24:25])
    s0_agg = _aggregate_subset(rows[0:10])
    s1_agg = _aggregate_subset(rows[10:12])
    s2_agg = _aggregate_subset(rows[12:17])
    s3_agg = _aggregate_subset(rows[17:21])
    s3_dsl_agg = _aggregate_subset(rows[18:21])
    s4_b22_b24_agg = _aggregate_subset(rows[21:24])
    s4_all_agg = _aggregate_subset(rows[21:25])

    summary = {
        "tokenizer": "deterministic_regex_subword_v1 (TOKEN_PATTERN)",
        "total_rs_tokens": all_agg["rs_tokens"],
        "total_rs_prod_tokens": all_agg["rs_prod_tokens"],
        "total_rs_test_tokens": all_agg["rs_test_tokens"],
        "total_jni_iface_tokens": all_agg["jni_iface_tokens"],
        "total_jni_full_tokens": all_agg["jni_full_tokens"],
        "total_jni_prose_tokens": all_agg["jni_prose_tokens"],
        "total_jn_tokens": all_agg["jn_tokens"],
        "total_jenny_tokens": all_agg["jenny_total_tokens"],
        "total_jenny_doc_all_tokens": all_agg["jenny_doc_all_tokens"],
        "overall_tcr": all_agg["tcr"],
        "overall_tcr_vs_prod": all_agg["tcr_vs_prod"],
        "overall_tcr_doc_all": all_agg["tcr_doc_all"],
        "overall_tcr_impl": all_agg["tcr_impl"],
        "overall_tcr_impl_vs_prod": all_agg["tcr_impl_vs_prod"],
        "overall_ecc_saving": all_agg["ecc_saving_self"],
        "overall_ecc_saving_vs_rs": all_agg["ecc_saving_vs_rs"],
        "overall_ecc_saving_vs_rs_prod": all_agg["ecc_saving_vs_rs_prod"],
        "stage_summaries": {
            "stage0_seed_10": s0_agg,
            "stage1_flow_2": s1_agg,
            "stage2_mem_5": s2_agg,
            "stage3_spin_4": s3_agg,
            "stage3_spin_dsl_b19_b21": s3_dsl_agg,
            "stage4_native_b22_b24": s4_b22_b24_agg,
            "stage4_b25_closure_lifetimes": b25_agg,
            "stage4_native_b22_b25": s4_all_agg,
            "subtotal_b01_b24": b01_b24_agg,
            "grand_total_b01_b25": all_agg,
        },
        "stage2_mem_summary": {
            "s2_rs_tokens": s2_agg["rs_tokens"],
            "s2_jni_iface_tokens": s2_agg["jni_iface_tokens"],
            "s2_jn_tokens": s2_agg["jn_tokens"],
            "s2_jenny_tokens": s2_agg["jenny_total_tokens"],
            "s2_tcr": s2_agg["tcr"],
            "s2_tcr_impl": s2_agg["tcr_impl"],
            "s2_ecc_saving": s2_agg["ecc_saving_self"],
        },
        "stage3_spin_summary": {
            "s3_rs_tokens": s3_agg["rs_tokens"],
            "s3_jni_iface_tokens": s3_agg["jni_iface_tokens"],
            "s3_jn_tokens": s3_agg["jn_tokens"],
            "s3_jenny_tokens": s3_agg["jenny_total_tokens"],
            "s3_tcr": s3_agg["tcr"],
            "s3_tcr_impl": s3_agg["tcr_impl"],
            "s3_dsl_tcr_impl": s3_dsl_agg["tcr_impl"],
            "s3_ecc_saving": s3_agg["ecc_saving_self"],
        },
        "stage4_native_summary": {
            "s4_rs_tokens": s4_all_agg["rs_tokens"],
            "s4_jni_iface_tokens": s4_all_agg["jni_iface_tokens"],
            "s4_jn_tokens": s4_all_agg["jn_tokens"],
            "s4_jenny_tokens": s4_all_agg["jenny_total_tokens"],
            "s4_tcr": s4_all_agg["tcr"],
            "s4_tcr_impl": s4_all_agg["tcr_impl"],
            "s4_ecc_saving": s4_all_agg["ecc_saving_self"],
        },
        "syntax_totals": syn_totals,
        "benchmarks": rows,
    }
    snapshot_path = ROOT_DIR / ".jenny-cache" / "token_metrics_snapshot.json"
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


if __name__ == "__main__":
    report = evaluate_all()
    print(json.dumps(report, indent=2, ensure_ascii=False))
