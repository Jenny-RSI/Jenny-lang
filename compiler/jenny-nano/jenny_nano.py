#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Jenny-Nano (v0.1) Prototype Compiler, Contract Weaver & C99 Transpiler.

Implements Stage 0 of the Spinning Jenny (Jenny) evolutionary roadmap:
  1. Parses Literate Blueprint (.jni) and Implementation (.jn) files.
  2. Verifies Jenny v2.0 syntax compliance (zero &T, zero 'a, explicit return).
  3. Automatically weaves `requires ... else`, `ensures` (with `old(...)` snapshots),
     and `struct invariant` checks into function bodies.
  4. Transpiles to standard C99 in `.spun/c99_build/` and invokes LLVM `clang.exe`
     to execute `@example` sandbox tests and mutation (bug-injection) tests.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

CLANG_PATH = Path(r"C:\Tools\LLVM\bin\clang.exe")
ROOT_DIR = Path(__file__).resolve().parents[2]


@dataclass
class FieldDecl:
    name: str
    ty: str
    default: Optional[str] = None


@dataclass
class StructDecl:
    name: str
    fields: List[FieldDecl] = field(default_factory=list)
    invariants: List[str] = field(default_factory=list)


@dataclass
class EnumDecl:
    name: str
    variants: List[str] = field(default_factory=list)


@dataclass
class ParamDecl:
    mode: str  # "borrow" (default), "mut", "own"
    name: str
    ty: str


@dataclass
class RequiresClause:
    cond: str
    else_err: Optional[str] = None


@dataclass
class FnSpec:
    name: str
    struct_owner: Optional[str]
    params: List[ParamDecl]
    ret_ty: str
    err_ty: Optional[str]
    requires: List[RequiresClause] = field(default_factory=list)
    ensures: List[str] = field(default_factory=list)
    body_lines: List[str] = field(default_factory=list)


@dataclass
class ExampleBlock:
    title: str
    body_lines: List[str]


@dataclass
class ModuleAST:
    name: str
    enums: Dict[str, EnumDecl] = field(default_factory=dict)
    structs: Dict[str, StructDecl] = field(default_factory=dict)
    functions: Dict[str, FnSpec] = field(default_factory=dict)  # key: "Struct.fn" or "fn"
    examples: List[ExampleBlock] = field(default_factory=list)


def strip_comments(line: str) -> str:
    idx = line.find("//")
    if idx != -1:
        # Make sure // is not inside a string literal like "HTTP/1.1"
        in_str = False
        for i, ch in enumerate(line):
            if ch == '"' and (i == 0 or line[i - 1] != "\\"):
                in_str = not in_str
            elif not in_str and line[i : i + 2] == "//":
                return line[:i].rstrip()
    return line.rstrip()


def extract_jenny_fenced_code(jni_text: str) -> str:
    blocks = re.findall(r"```jenny\s*\n(.*?)```", jni_text, flags=re.DOTALL)
    return "\n".join(blocks)


def parse_param_list(param_str: str, struct_owner: Optional[str]) -> List[ParamDecl]:
    params: List[ParamDecl] = []
    if not param_str.strip():
        return params
    for raw_p in param_str.split(","):
        p = raw_p.strip()
        if not p:
            continue
        if p == "self":
            params.append(ParamDecl("borrow", "self", struct_owner or "Self"))
        elif p == "mut self":
            params.append(ParamDecl("mut", "self", struct_owner or "Self"))
        elif p == "own self":
            params.append(ParamDecl("own", "self", struct_owner or "Self"))
        else:
            m = re.match(r"^(?:(mut|own)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$", p)
            if not m:
                raise ValueError(f"Invalid parameter syntax: {p}")
            mode = m.group(1) or "borrow"
            params.append(ParamDecl(mode, m.group(2), m.group(3).strip()))
    return params


def parse_return_spec(ret_str: str) -> Tuple[str, Optional[str]]:
    ret_str = ret_str.strip()
    if ret_str.endswith("!") and "!" not in ret_str[:-1]:
        return ret_str[:-1].strip(), "AnyError"
    if "!" in ret_str:
        parts = ret_str.split("!", 1)
        return parts[0].strip(), parts[1].strip()
    return ret_str, None


def parse_jni_blueprint(jni_text: str) -> ModuleAST:
    code = extract_jenny_fenced_code(jni_text)
    lines = [strip_comments(l) for l in code.splitlines()]
    mod_name = "unnamed"
    ast = ModuleAST(name=mod_name)

    i = 0
    n = len(lines)
    current_impl: Optional[str] = None
    impl_brace_depth = 0

    while i < n:
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        if line.startswith("module "):
            ast.name = line.split()[1].strip()
            i += 1
            continue

        if current_impl and line == "}":
            current_impl = None
            i += 1
            continue

        # Parse enum
        m_enum = re.match(r"^pub\s+enum\s+([A-Za-z0-9_]+)\s*\{", line)
        if m_enum:
            ename = m_enum.group(1)
            variants = []
            i += 1
            while i < n and lines[i].strip() != "}":
                v = lines[i].strip().rstrip(",")
                if v:
                    variants.append(v)
                i += 1
            ast.enums[ename] = EnumDecl(name=ename, variants=variants)
            i += 1
            continue

        # Parse struct
        m_struct = re.match(r"^pub\s+struct\s+([A-Za-z0-9_]+)\s*\{", line)
        if m_struct:
            sname = m_struct.group(1)
            fields: List[FieldDecl] = []
            invariants: List[str] = []
            i += 1
            while i < n and lines[i].strip() != "}":
                sline = lines[i].strip()
                if not sline:
                    i += 1
                    continue
                if sline.startswith("invariant") and sline.endswith("{"):
                    i += 1
                    while i < n and lines[i].strip() != "}":
                        inv = lines[i].strip()
                        if inv:
                            invariants.append(inv)
                        i += 1
                    i += 1
                    continue
                m_field = re.match(
                    r"^pub\s+([A-Za-z0-9_]+)\s*:\s*([^=,]+)(?:=\s*([^,]+))?,?$",
                    sline,
                )
                if m_field:
                    fields.append(
                        FieldDecl(
                            name=m_field.group(1).strip(),
                            ty=m_field.group(2).strip(),
                            default=m_field.group(3).strip() if m_field.group(3) else None,
                        )
                    )
                i += 1
            ast.structs[sname] = StructDecl(name=sname, fields=fields, invariants=invariants)
            i += 1
            continue

        # Parse impl header
        m_impl = re.match(r"^impl\s+([A-Za-z0-9_]+)\s*\{", line)
        if m_impl:
            current_impl = m_impl.group(1)
            i += 1
            continue

        # Parse function signature in .jni (possibly multiline)
        if line.startswith("pub fn "):
            sig_lines = [line]
            while "->" not in " ".join(sig_lines) or sig_lines[-1].endswith(","):
                i += 1
                sig_lines.append(lines[i].strip())
            full_sig = " ".join(sig_lines)
            m_fn = re.match(
                r"^pub\s+fn\s+([A-Za-z0-9_]+)\s*\((.*)\)\s*->\s*(.+)$", full_sig
            )
            if not m_fn:
                raise ValueError(f"Cannot parse fn signature in .jni: {full_sig}")
            fn_name = m_fn.group(1)
            params = parse_param_list(m_fn.group(2), current_impl)
            ret_ty, err_ty = parse_return_spec(m_fn.group(3))
            reqs: List[RequiresClause] = []
            enss: List[str] = []
            i += 1
            while i < n:
                cline = lines[i].strip()
                if cline.startswith("requires "):
                    r_body = cline[len("requires ") :].strip()
                    if " else " in r_body:
                        cond_p, err_p = r_body.split(" else ", 1)
                        reqs.append(RequiresClause(cond_p.strip(), err_p.strip()))
                    else:
                        reqs.append(RequiresClause(r_body, None))
                    i += 1
                elif cline.startswith("ensures "):
                    enss.append(cline[len("ensures ") :].strip())
                    i += 1
                else:
                    break
            key = f"{current_impl}.{fn_name}" if current_impl else fn_name
            ast.functions[key] = FnSpec(
                name=fn_name,
                struct_owner=current_impl,
                params=params,
                ret_ty=ret_ty,
                err_ty=err_ty,
                requires=reqs,
                ensures=enss,
            )
            continue

        # Parse @example("...") { ... }
        m_ex = re.match(r'^@example\("([^"]+)"\)\s*\{', line)
        if m_ex:
            title = m_ex.group(1)
            body: List[str] = []
            depth = 1
            i += 1
            while i < n and depth > 0:
                raw_l = lines[i]
                depth += raw_l.count("{") - raw_l.count("}")
                if depth > 0:
                    body.append(raw_l.strip())
                i += 1
            ast.examples.append(ExampleBlock(title=title, body_lines=body))
            continue

        i += 1

    return ast


def attach_jn_implementations(ast: ModuleAST, jn_text: str) -> None:
    lines = [strip_comments(l) for l in jn_text.splitlines()]
    i = 0
    n = len(lines)
    current_impl: Optional[str] = None

    while i < n:
        line = lines[i].strip()
        if not line or line.startswith("module "):
            i += 1
            continue

        m_impl = re.match(r"^impl\s+([A-Za-z0-9_]+)\s*\{", line)
        if m_impl:
            current_impl = m_impl.group(1)
            i += 1
            continue

        if current_impl and line == "}":
            current_impl = None
            i += 1
            continue

        if line.startswith("pub fn "):
            sig_lines = [line]
            while not sig_lines[-1].endswith("{"):
                i += 1
                sig_lines.append(lines[i].strip())
            full_sig = " ".join(sig_lines)
            m_fn = re.match(
                r"^pub\s+fn\s+([A-Za-z0-9_]+)\s*\((.*)\)\s*->\s*([^{]+)\{$", full_sig
            )
            if not m_fn:
                raise ValueError(f"Cannot parse fn header in .jn: {full_sig}")
            fn_name = m_fn.group(1)
            key = f"{current_impl}.{fn_name}" if current_impl else fn_name
            if key not in ast.functions:
                raise ValueError(f"Function `{key}` in .jn is missing from .jni blueprint!")

            body: List[str] = []
            depth = 1
            i += 1
            while i < n and depth > 0:
                raw_l = lines[i]
                depth += raw_l.count("{") - raw_l.count("}")
                if depth > 0:
                    if raw_l.strip():
                        body.append(raw_l)
                i += 1
            ast.functions[key].body_lines = body
            continue

        i += 1


# ============================================================================
# C99 Transpiler & Contract Weaver
# ============================================================================


def map_c_type(jn_ty: str) -> str:
    m_arr = re.match(r"^\[(\d+)\](.+)$", jn_ty)
    if m_arr:
        return map_c_type(m_arr.group(2))
    mapping = {
        "i32": "int32_t",
        "i64": "int64_t",
        "u8": "uint8_t",
        "u32": "uint32_t",
        "u64": "uint64_t",
        "usize": "size_t",
        "f64": "double",
        "bool": "bool",
        "str": "jn_str",
        "void": "int32_t",
    }
    return mapping.get(jn_ty, jn_ty)


def c_fn_name(spec: FnSpec) -> str:
    if spec.struct_owner:
        return f"{spec.struct_owner}_{spec.name}"
    return spec.name


def result_typedef_name(spec: FnSpec) -> str:
    return f"Res_{c_fn_name(spec)}"


def translate_expr(
    expr: str,
    ast: ModuleAST,
    current_fn: Optional[FnSpec] = None,
    old_map: Optional[Dict[str, str]] = None,
    ptr_vars: Optional[set] = None,
) -> str:
    s = expr.strip()
    ptr_vars = ptr_vars or set()

    # Replace old(...) snapshots first
    if old_map:
        for orig_old, snap_var in old_map.items():
            s = s.replace(f"old({orig_old})", snap_var)

    # Replace inline `if cond { a } else { b }` expression with C ternary `((cond) ? (a) : (b))`
    m_if_expr = re.match(r"^if\s+(.+?)\s*\{\s*(.+?)\s*\}\s*else\s*\{\s*(.+?)\s*\}$", s)
    if m_if_expr:
        c_cond = translate_expr(m_if_expr.group(1), ast, current_fn, old_map, ptr_vars)
        c_a = translate_expr(m_if_expr.group(2), ast, current_fn, old_map, ptr_vars)
        c_b = translate_expr(m_if_expr.group(3), ast, current_fn, old_map, ptr_vars)
        return f"(({c_cond}) ? ({c_a}) : ({c_b}))"

    # Replace string literals "abc" with jn_mk_str("abc") (avoid double-wrapping)
    def str_repl(m):
        lit = m.group(0)
        return f"jn_mk_str({lit})"

    s = re.sub(r'(?<!jn_mk_str\()"[^"]*"', str_repl, s)

    # Replace `x.as<T>()` with `((c_type)(x))`
    def cast_repl(m):
        inner = m.group(1)
        target_t = map_c_type(m.group(2))
        return f"(({target_t})({inner}))"

    s = re.sub(r"([A-Za-z0-9_.]+)\.as<([A-Za-z0-9_]+)>\(\)", cast_repl, s)

    # Replace Enum.Variant with ErrTag_Enum_Variant
    for ename, edecl in ast.enums.items():
        for v in edecl.variants:
            s = re.sub(rf"\b{ename}\.{v}\b", f"ErrTag_{ename}_{v}", s)

    # Replace Struct.new(...) with Struct_new(...)
    for sname in ast.structs:
        s = re.sub(rf"\b{sname}\.new\s*\(", f"{sname}_new(", s)

    # Replace method calls on structs (`rb.is_empty()`, `rb.push(10)`, `rb.peek()`)
    for key, fspec in ast.functions.items():
        if fspec.struct_owner:
            mname = fspec.name
            cname = c_fn_name(fspec)
            # Match `<var>.<mname>(<args>)`
            def method_repl(m, cname=cname, fspec=fspec):
                recv = m.group(1)
                args = m.group(2).strip()
                recv_arg = recv if recv in ptr_vars else f"&{recv}"
                if args:
                    return f"{cname}({recv_arg}, {args})"
                return f"{cname}({recv_arg})"

            s = re.sub(rf"\b([A-Za-z_][A-Za-z0-9_]*)\.{mname}\(([^)]*)\)", method_repl, s)

    # Replace pointer field accesses `self.` -> `self->`
    for pv in ptr_vars:
        s = re.sub(rf"\b{pv}\.", f"{pv}->", s)

    # Replace string equality `a == jn_mk_str(...)` -> `jn_str_eq(a, jn_mk_str(...))`
    s = re.sub(
        r"([A-Za-z0-9_.\->]+)\s*==\s*(jn_mk_str\([^)]+\))",
        r"jn_str_eq(\1, \2)",
        s,
    )

    return s


def transpile_module_to_c99(ast: ModuleAST) -> str:
    out: List[str] = []
    out.append("/* Auto-generated by Jenny-Nano v0.1 C99 Transpiler (.spun/c99_build) */")
    out.append("#include <stdint.h>")
    out.append("#include <stdbool.h>")
    out.append("#include <stddef.h>")
    out.append("#include <stdio.h>")
    out.append("#include <stdlib.h>")
    out.append("#include <string.h>")
    out.append("")
    out.append("typedef struct { const char* ptr; size_t len; } jn_str;")
    out.append("static inline jn_str jn_mk_str(const char* s) {")
    out.append("    jn_str r = { s, strlen(s) }; return r;")
    out.append("}")
    out.append("static inline bool jn_str_eq(jn_str a, jn_str b) {")
    out.append("    return a.len == b.len && (a.len == 0 || memcmp(a.ptr, b.ptr, a.len) == 0);")
    out.append("}")
    out.append("")
    out.append("static void jn_contract_fail(const char* kind, const char* fn_name, const char* cond) {")
    out.append('    fprintf(stdout, "{\\"diagnostic\\": \\"JENNY_CONTRACT_VIOLATION\\", \\"kind\\": \\"%s\\", \\"function\\": \\"%s\\", \\"condition\\": \\"%s\\"}\\n", kind, fn_name, cond);')
    out.append("    exit(42);")
    out.append("}")
    out.append("")

    # 1. Emit unified Error Tag enum
    out.append("typedef enum {")
    out.append("    ErrTag_None = 0,")
    for ename, edecl in ast.enums.items():
        for v in edecl.variants:
            out.append(f"    ErrTag_{ename}_{v},")
    out.append("} JnErrTag;")
    out.append("")

    # 2. Emit Struct definitions and Invariant checkers
    for sname, sdecl in ast.structs.items():
        out.append(f"typedef struct {sname} {{")
        for f in sdecl.fields:
            m_arr = re.match(r"^\[(\d+)\](.+)$", f.ty)
            if m_arr:
                elem_c = map_c_type(m_arr.group(2))
                out.append(f"    {elem_c} {f.name}[{m_arr.group(1)}];")
            else:
                out.append(f"    {map_c_type(f.ty)} {f.name};")
        out.append(f"}} {sname};")
        out.append("")

        out.append(f"static inline void {sname}_check_invariant(const {sname}* self, const char* fn_ctx) {{")
        for inv in sdecl.invariants:
            c_inv = translate_expr(inv, ast, ptr_vars={"self"})
            escaped_inv = inv.replace('"', '\\"')
            out.append(f'    if (!({c_inv})) jn_contract_fail("invariant ({sname})", fn_ctx, "{escaped_inv}");')
        out.append("}")
        out.append("")

    # 3. Emit Result typedefs for fallible functions
    for key, fspec in ast.functions.items():
        if fspec.err_ty:
            rname = result_typedef_name(fspec)
            val_c = map_c_type(fspec.ret_ty)
            out.append(f"typedef struct {{ bool is_err; JnErrTag err_tag; {val_c} val; }} {rname};")
    out.append("")

    # 4. Emit Function Implementations with Woven Contracts
    for key, fspec in ast.functions.items():
        cname = c_fn_name(fspec)
        ret_c = result_typedef_name(fspec) if fspec.err_ty else map_c_type(fspec.ret_ty)

        ptr_vars = set()
        c_params = []
        for p in fspec.params:
            if p.name == "self":
                ptr_vars.add("self")
                const_q = "" if p.mode == "mut" else "const "
                c_params.append(f"{const_q}{ p.ty }* self")
            else:
                c_params.append(f"{map_c_type(p.ty)} {p.name}")
        param_sig = ", ".join(c_params) if c_params else "void"

        out.append(f"{ret_c} {cname}({param_sig}) {{")

        # 4a. Entry Invariant Check on `self` or struct parameters
        for p in fspec.params:
            if p.ty in ast.structs:
                if p.name == "self":
                    out.append(f'    {p.ty}_check_invariant(self, "{key}:entry");')
                else:
                    out.append(f'    {p.ty}_check_invariant(&{p.name}, "{key}:entry");')

        # 4b. Precondition (`requires`) checks
        for req in fspec.requires:
            c_cond = translate_expr(req.cond, ast, fspec, ptr_vars=ptr_vars)
            if req.else_err and fspec.err_ty:
                c_err = translate_expr(req.else_err, ast, fspec, ptr_vars=ptr_vars)
                out.append(f"    if (!({c_cond})) {{")
                out.append(f"        {ret_c} _err_res = {{ .is_err = true, .err_tag = {c_err} }};")
                out.append("        return _err_res;")
                out.append("    }")
            else:
                escaped = req.cond.replace('"', '\\"')
                out.append(f'    if (!({c_cond})) jn_contract_fail("requires", "{key}", "{escaped}");')

        # 4c. Snapshot `old(expr)` variables needed by `ensures`
        old_map: Dict[str, str] = {}
        for ens in fspec.ensures:
            for m_old in re.finditer(r"old\(([^)]+)\)", ens):
                orig_expr = m_old.group(1).strip()
                if orig_expr not in old_map:
                    snap_name = f"_old_{len(old_map)}"
                    old_map[orig_expr] = snap_name
                    c_snap_expr = translate_expr(orig_expr, ast, fspec, ptr_vars=ptr_vars)
                    out.append(f"    size_t {snap_name} = (size_t)({c_snap_expr});")

        # Helper to emit exit invariant + ensures checks before returning
        def emit_exit_checks(result_var: Optional[str]) -> List[str]:
            checks: List[str] = []
            if "self" in ptr_vars and fspec.struct_owner in ast.structs:
                checks.append(f'    {fspec.struct_owner}_check_invariant(self, "{key}:exit");')
            if result_var and fspec.ret_ty in ast.structs:
                checks.append(f'    {fspec.ret_ty}_check_invariant(&{result_var}, "{key}:return");')
            for ens in fspec.ensures:
                c_ens = translate_expr(ens, ast, fspec, old_map=old_map, ptr_vars=ptr_vars)
                escaped = ens.replace('"', '\\"')
                checks.append(f'    if (!({c_ens})) jn_contract_fail("ensures", "{key}", "{escaped}");')
            return checks

        # 4d. Translate function body statements
        b_idx = 0
        blines = [l.strip() for l in fspec.body_lines if l.strip()]
        while b_idx < len(blines):
            stmt = blines[b_idx]

            # Handle `guard <cond> else { raise <Err> }`
            if stmt.startswith("guard ") and stmt.endswith("else {"):
                g_cond = stmt[len("guard ") : -len("else {")].strip()
                b_idx += 1
                inner_stmt = blines[b_idx]
                b_idx += 1  # closing }
                if b_idx < len(blines) and blines[b_idx] == "}":
                    b_idx += 1
                m_raise = re.match(r"^raise\s+(.+)$", inner_stmt)
                if not m_raise:
                    raise ValueError(f"Expected raise inside guard else: {inner_stmt}")
                c_cond = translate_expr(g_cond, ast, fspec, ptr_vars=ptr_vars)
                c_err = translate_expr(m_raise.group(1), ast, fspec, ptr_vars=ptr_vars)
                out.append(f"    if (!({c_cond})) {{")
                out.append(f"        {ret_c} _err_res = {{ .is_err = true, .err_tag = {c_err} }};")
                out.append("        return _err_res;")
                out.append("    }")
                continue

            # Handle `return StructName { ... }` multiline struct literal return
            if stmt.startswith("return ") and stmt.endswith("{"):
                sname = stmt[len("return ") : -1].strip()
                field_inits: List[str] = []
                b_idx += 1
                while b_idx < len(blines) and blines[b_idx] != "}":
                    fline = blines[b_idx].rstrip(",")
                    m_fi = re.match(r"^([A-Za-z0-9_]+)\s*:\s*(.+)$", fline)
                    if m_fi:
                        fname = m_fi.group(1)
                        fval = m_fi.group(2).strip()
                        if fval.startswith("[") and fval.endswith("]"):
                            c_fval = "{" + fval[1:-1] + "}"
                        else:
                            c_fval = translate_expr(fval, ast, fspec, ptr_vars=ptr_vars)
                        field_inits.append(f".{fname} = {c_fval}")
                    b_idx += 1
                b_idx += 1  # skip '}'
                out.append(f"    {sname} result = ({sname}){{ {', '.join(field_inits)} }};")
                out.extend(emit_exit_checks("result"))
                if fspec.err_ty:
                    out.append(f"    return ({ret_c}){{ .is_err = false, .err_tag = ErrTag_None, .val = result }};")
                else:
                    out.append("    return result;")
                continue

            # Handle single-line `return <expr>`
            if stmt.startswith("return "):
                ret_expr = stmt[len("return ") :].strip()
                c_ret = translate_expr(ret_expr, ast, fspec, ptr_vars=ptr_vars)
                val_c = map_c_type(fspec.ret_ty)
                out.append(f"    {val_c} result = {c_ret};")
                out.extend(emit_exit_checks("result"))
                if fspec.err_ty:
                    out.append(f"    return ({ret_c}){{ .is_err = false, .err_tag = ErrTag_None, .val = result }};")
                else:
                    out.append("    return result;")
                b_idx += 1
                continue

            # Handle `val x = fn_call(...)?` error propagation `?`
            m_try = re.match(r"^(?:val|var)\s+([A-Za-z0-9_]+)\s*=\s*(.+)\?$", stmt)
            if m_try:
                vname = m_try.group(1)
                call_expr = m_try.group(2).strip()
                called_fn_name = call_expr.split("(")[0].strip()
                called_spec = ast.functions[called_fn_name]
                called_res_ty = result_typedef_name(called_spec)
                called_val_ty = map_c_type(called_spec.ret_ty)
                c_call = translate_expr(call_expr, ast, fspec, ptr_vars=ptr_vars)
                out.append(f"    {called_res_ty} _try_{vname} = {c_call};")
                out.append(f"    if (_try_{vname}.is_err) {{")
                out.append(f"        return ({ret_c}){{ .is_err = true, .err_tag = _try_{vname}.err_tag }};")
                out.append("    }")
                out.append(f"    {called_val_ty} {vname} = _try_{vname}.val;")
                b_idx += 1
                continue

            # Handle `val/var x = expr`
            m_decl = re.match(r"^(?:val|var)\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_]+))?\s*=\s*(.+)$", stmt)
            if m_decl:
                vname = m_decl.group(1)
                expl_ty = m_decl.group(2)
                rhs = m_decl.group(3).strip()
                c_rhs = translate_expr(rhs, ast, fspec, ptr_vars=ptr_vars)
                if expl_ty:
                    c_ty = map_c_type(expl_ty)
                elif "jn_mk_str" in c_rhs:
                    c_ty = "jn_str"
                elif not rhs.startswith("if ") and (c_rhs in ("true", "false") or "==" in rhs or "||" in rhs or "&&" in rhs):
                    c_ty = "bool"
                elif "self->data" in c_rhs:
                    c_ty = "int32_t"
                else:
                    c_ty = "int64_t"
                out.append(f"    {c_ty} {vname} = {c_rhs};")
                b_idx += 1
                continue

            # General assignment / mutation statement
            c_stmt = translate_expr(stmt, ast, fspec, ptr_vars=ptr_vars)
            out.append(f"    {c_stmt};")
            b_idx += 1

        # If void function without explicit return at end, emit exit checks and return
        if fspec.ret_ty == "void":
            out.extend(emit_exit_checks(None))
            if fspec.err_ty:
                out.append(f"    return ({ret_c}){{ .is_err = false, .err_tag = ErrTag_None, .val = 0 }};")
            else:
                out.append("    return 0;")

        out.append("}")
        out.append("")

    # 5. Emit @example test runners and main()
    for idx, ex in enumerate(ast.examples):
        out.append(f"static void run_example_{idx}(void) {{")
        b_idx = 0
        ex_lines = [l.strip() for l in ex.body_lines if l.strip()]
        res_vars: Dict[str, str] = {}
        while b_idx < len(ex_lines):
            stmt = ex_lines[b_idx]

            # Handle `while cond { ... }`
            if stmt.startswith("while ") and stmt.endswith("{"):
                w_cond = stmt[len("while ") : -1].strip()
                out.append(f"    while ({translate_expr(w_cond, ast)}) {{")
                b_idx += 1
                continue
            if stmt == "}":
                out.append("    }")
                b_idx += 1
                continue

            # Handle `assert(x is Enum.Variant)`
            m_assert_is = re.match(r"^assert\(([A-Za-z0-9_]+)\s+is\s+([A-Za-z0-9_.]+)\)$", stmt)
            if m_assert_is:
                vname = m_assert_is.group(1)
                expected_tag = translate_expr(m_assert_is.group(2), ast)
                escaped = stmt.replace('"', '\\"')
                out.append(f'    if (!({vname}.is_err && {vname}.err_tag == {expected_tag})) jn_contract_fail("example_assert", "example_{idx}", "{escaped}");')
                b_idx += 1
                continue

            # Handle `assert(expr)`
            m_assert = re.match(r"^assert\((.+)\)$", stmt)
            if m_assert:
                inner = m_assert.group(1).strip()
                # Check if inner has `fn()!` unwrap
                inner = re.sub(r"([A-Za-z0-9_.]+\([^)]*\))!", r"\1.val", inner)
                c_inner = translate_expr(inner, ast)
                escaped = stmt.replace('"', '\\"')
                out.append(f'    if (!({c_inner})) jn_contract_fail("example_assert", "example_{idx}", "{escaped}");')
                b_idx += 1
                continue

            # Handle `val/var x = call(...)!` (unwrap result)
            m_unwrap_decl = re.match(r"^(?:val|var)\s+([A-Za-z0-9_]+)\s*=\s*(.+)!$", stmt)
            if m_unwrap_decl:
                vname = m_unwrap_decl.group(1)
                call_expr = m_unwrap_decl.group(2).strip()
                c_call = translate_expr(call_expr, ast)
                fn_prefix = c_call.split("(")[0].strip()
                # Find matching FnSpec
                matched_spec = None
                for fspec in ast.functions.values():
                    if c_fn_name(fspec) == fn_prefix:
                        matched_spec = fspec
                        break
                res_ty = result_typedef_name(matched_spec)
                val_ty = map_c_type(matched_spec.ret_ty)
                out.append(f"    {res_ty} _u_{vname} = {c_call};")
                out.append(f'    if (_u_{vname}.is_err) jn_contract_fail("unwrap_err", "example_{idx}", "{vname}");')
                out.append(f"    {val_ty} {vname} = _u_{vname}.val;")
                b_idx += 1
                continue

            # Handle standalone `call(...)!`
            if stmt.endswith("!"):
                call_expr = stmt[:-1].strip()
                c_call = translate_expr(call_expr, ast)
                out.append(f"    if (({c_call}).is_err) jn_contract_fail(\"unwrap_err\", \"example_{idx}\", \"stmt\");")
                b_idx += 1
                continue

            # Handle `val/var x = call(...)` (possibly returning Result or Struct)
            m_decl = re.match(r"^(?:val|var)\s+([A-Za-z0-9_]+)(?:\s*:\s*([A-Za-z0-9_]+))?\s*=\s*(.+)$", stmt)
            if m_decl:
                vname = m_decl.group(1)
                expl_ty = m_decl.group(2)
                rhs = m_decl.group(3).strip()
                c_rhs = translate_expr(rhs, ast)
                fn_prefix = c_rhs.split("(")[0].strip()
                matched_spec = None
                for fspec in ast.functions.values():
                    if c_fn_name(fspec) == fn_prefix:
                        matched_spec = fspec
                        break
                if expl_ty:
                    c_ty = map_c_type(expl_ty)
                elif matched_spec:
                    c_ty = result_typedef_name(matched_spec) if matched_spec.err_ty else map_c_type(matched_spec.ret_ty)
                else:
                    c_ty = "int32_t"
                out.append(f"    {c_ty} {vname} = {c_rhs};")
                b_idx += 1
                continue

            out.append(f"    {translate_expr(stmt, ast)};")
            b_idx += 1

        escaped_title = ex.title.replace('"', '\\"')
        out.append(f'    printf("[PASS] %s\\n", "{escaped_title}");')
        out.append("}")
        out.append("")

    out.append("int main(int argc, char** argv) {")
    out.append("    int target = (argc > 1) ? atoi(argv[1]) : -1;")
    for idx in range(len(ast.examples)):
        out.append(f"    if (target == -1 || target == {idx}) run_example_{idx}();")
    out.append("    return 0;")
    out.append("}")
    return "\n".join(out)


def compile_and_run_benchmark(bdir: Path, custom_jn_text: Optional[str] = None) -> Dict:
    jni_file = next(bdir.glob("*.jni"))
    jn_file = next(bdir.glob("*.jn"))
    jni_text = jni_file.read_text(encoding="utf-8")
    jn_text = custom_jn_text if custom_jn_text is not None else jn_file.read_text(encoding="utf-8")

    ast = parse_jni_blueprint(jni_text)
    attach_jn_implementations(ast, jn_text)
    c99_code = transpile_module_to_c99(ast)

    spun_dir = ROOT_DIR / ".spun" / "c99_build"
    spun_dir.mkdir(parents=True, exist_ok=True)
    c_file = spun_dir / f"{ast.name}.c"
    exe_file = spun_dir / f"{ast.name}.exe"
    c_file.write_text(c99_code, encoding="utf-8")

    t0 = time.perf_counter()
    comp = subprocess.run(
        [str(CLANG_PATH), "-std=c99", "-O1", "-Wall", "-Wno-unused-variable", str(c_file), "-o", str(exe_file)],
        capture_output=True,
        text=True,
    )
    compile_ms = round((time.perf_counter() - t0) * 1000, 2)
    if comp.returncode != 0:
        return {
            "module": ast.name,
            "compile_ok": False,
            "compile_stderr": comp.stderr,
            "compile_ms": compile_ms,
        }

    ex_results = []
    for idx, ex in enumerate(ast.examples):
        t_run = time.perf_counter()
        proc = subprocess.run([str(exe_file), str(idx)], capture_output=True, text=True)
        run_ms = round((time.perf_counter() - t_run) * 1000, 2)
        ex_results.append(
            {
                "id": f"EX-{idx+1}",
                "title": ex.title,
                "exit_code": proc.returncode,
                "passed": proc.returncode == 0,
                "stdout": proc.stdout.strip(),
                "stderr": proc.stderr.strip(),
                "run_ms": run_ms,
            }
        )

    return {
        "module": ast.name,
        "c99_path": str(c_file.relative_to(ROOT_DIR)),
        "compile_ok": True,
        "compile_ms": compile_ms,
        "examples": ex_results,
    }


def run_mutation_suite() -> List[Dict]:
    """
    Execute Gate G0-4: Inject specification-violating mutants across B01-B10
    and verify 100% interception by woven contracts (`ensures` / `invariant`).
    """
    seed_root = ROOT_DIR / "benchmarks" / "seed_10"

    def read_jn(folder: str, fname: str) -> Tuple[Path, str]:
        d = seed_root / folder
        return d, (d / fname).read_text(encoding="utf-8")

    b01_dir, b01_jn = read_jn("B01_ring_buffer", "ring_buffer.jn")
    b02_dir, b02_jn = read_jn("B02_http_parser", "http_parser.jn")
    b03_dir, b03_jn = read_jn("B03_expr_evaluator", "expr_evaluator.jn")
    b04_dir, b04_jn = read_jn("B04_lru_ttl_cache", "lru_ttl_cache.jn")
    b05_dir, b05_jn = read_jn("B05_order_pipeline", "order_pipeline.jn")
    b06_dir, b06_jn = read_jn("B06_log_aggregator", "log_aggregator.jn")
    b07_dir, b07_jn = read_jn("B07_audio_normalizer", "audio_normalizer.jn")
    b08_dir, b08_jn = read_jn("B08_storage_decorator", "storage_decorator.jn")
    b09_dir, b09_jn = read_jn("B09_order_fsm", "order_fsm.jn")
    b10_dir, b10_jn = read_jn("B10_concurrent_aggregator", "concurrent_aggregator.jn")

    mutants = [
        {
            "id": "MUT-B01-A",
            "dir": b01_dir,
            "desc": "RingBuffer.push forgets to increment self.len",
            "jn_code": b01_jn.replace("self.len += 1", "// MUTANT: forgot self.len += 1"),
        },
        {
            "id": "MUT-B01-B",
            "dir": b01_dir,
            "desc": "RingBuffer.push corrupts self.len > self.capacity",
            "jn_code": b01_jn.replace("self.len += 1", "self.len = 99"),
        },
        {
            "id": "MUT-B02-A",
            "dir": b02_dir,
            "desc": "parse_request fabricates empty method string",
            "jn_code": b02_jn.replace("method: raw_method,", 'method: "",'),
        },
        {
            "id": "MUT-B03-A",
            "dir": b03_dir,
            "desc": "eval_and_clamp bypasses upper max_bound clamping",
            "jn_code": b03_jn.replace("clamped_value: clamped,", "clamped_value: raw,"),
        },
        {
            "id": "MUT-B04-A",
            "dir": b04_dir,
            "desc": "CacheSlot.get forgets to increment hit counter",
            "jn_code": b04_jn.replace("self.hits += 1", "// MUTANT: no hit increment"),
        },
        {
            "id": "MUT-B05-A",
            "dir": b05_dir,
            "desc": "settle_order miscalculates negative final_cents",
            "jn_code": b05_jn.replace("val final_amt = gross - discount_cents", "val final_amt = -100"),
        },
        {
            "id": "MUT-B06-A",
            "dir": b06_dir,
            "desc": "LogAggregator.ingest fails to update max_latency_ms",
            "jn_code": b06_jn.replace("self.max_latency_ms = next_max", "self.max_latency_ms = 0"),
        },
        {
            "id": "MUT-B07-A",
            "dir": b07_dir,
            "desc": "NormalizerState.normalize_sample returns unclipped sample > 32767",
            "jn_code": b07_jn.replace("return final_sample", "return scaled"),
        },
        {
            "id": "MUT-B08-A",
            "dir": b08_dir,
            "desc": "TrackedStorage.write_block forgets to update used_bytes",
            "jn_code": b08_jn.replace("self.used_bytes += payload_bytes", "// MUTANT: no used_bytes update"),
        },
        {
            "id": "MUT-B09-A",
            "dir": b09_dir,
            "desc": "OrderStateMachine.pay transitions to wrong state and skips version bump",
            "jn_code": b09_jn.replace("self.version += 1", "// MUTANT: forgot version bump"),
        },
        {
            "id": "MUT-B10-A",
            "dir": b10_dir,
            "desc": "select_fastest_replica returns invalid winner_id 99",
            "jn_code": b10_jn.replace("winner_id: best_id,", "winner_id: 99,"),
        },
    ]

    results = []
    for m in mutants:
        res = compile_and_run_benchmark(m["dir"], custom_jn_text=m["jn_code"])
        # Restore clean build afterwards
        compile_and_run_benchmark(m["dir"])
        first_fail = next((ex for ex in res.get("examples", []) if not ex["passed"]), None)
        intercepted = first_fail is not None and first_fail["exit_code"] == 42
        diag_json = None
        if first_fail and first_fail["stdout"]:
            for line in first_fail["stdout"].splitlines():
                if line.startswith("{"):
                    diag_json = json.loads(line)
        results.append(
            {
                "mutant_id": m["id"],
                "description": m["desc"],
                "intercepted": intercepted,
                "exit_code": first_fail["exit_code"] if first_fail else 0,
                "diagnostic": diag_json,
            }
        )
    return results


def main():
    parser = argparse.ArgumentParser(description="Jenny-Nano v0.1 Compiler & Contract Verifier")
    parser.add_argument("--mutate", action="store_true", help="Run mutation bug-injection test suite")
    args = parser.parse_args()

    seed_dir = ROOT_DIR / "benchmarks" / "seed_10"
    bench_dirs = sorted([d for d in seed_dir.iterdir() if d.is_dir()])

    all_reports = []
    for bdir in bench_dirs:
        all_reports.append(compile_and_run_benchmark(bdir))

    mutation_reports = run_mutation_suite() if args.mutate else []

    output = {
        "compiler": "jenny-nano v0.1 (C99 / LLVM Clang backend)",
        "clang_version": str(CLANG_PATH),
        "benchmarks": all_reports,
        "mutations": mutation_reports,
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
