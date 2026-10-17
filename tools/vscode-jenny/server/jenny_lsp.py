#!/usr/bin/env python3
"""
Spinning Jenny (Jenny v2.0) Standard JSON-RPC 2.0 Language Server (`jenny-lsp`).

Zero external dependencies (uses Python 3 standard library + `jenny_flow.py`).
Supports:
- `initialize` / `initialized` / `shutdown` / `exit`
- `textDocument/didOpen`, `textDocument/didChange`, `textDocument/didSave`
- `textDocument/publishDiagnostics` (bridges `jenny_flow.py --ai-json` E0101~E0108 & W0103)
- `textDocument/hover` (Jenny v2.0 contract & ownership documentation + blueprint signatures)
- `textDocument/documentSymbol` (Outline symbols for `.jni` and `.jn` files)
"""

from __future__ import annotations

import json
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT_DIR = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT_DIR / "compiler" / "jenny-flow"))

import jenny_flow  # noqa: E402

HOVER_DOCS: Dict[str, str] = {
    "requires": "**`requires <cond> [else <ErrVariant>]`**\n\nFirst-class precondition contract verified at function entry.",
    "ensures": "**`ensures <cond>`**\n\nFirst-class postcondition contract verified at every `return` path. Supports `result` and `old(expr)`.",
    "invariant": "**`invariant <cond>`**\n\nStruct data invariant verified after construction and every `mut self` method.",
    "old": "**`old(<expr>)`**\n\nCaptures entry-state snapshot for `ensures` postcondition verification.",
    "result": "**`result`**\n\nBinds the return value inside `ensures` contract clauses.",
    "mut": "**`mut`**\n\nIn-place mutable borrow parameter/receiver modifier (`mut x: T`, `mut self`). Jenny v2.0 abolishes `&mut T`.",
    "own": "**`own`**\n\nOwnership transfer modifier (`own x: T`, `own self`).",
    "guard": "**`guard <cond> else { ... }`**\n\nLinear precondition/pattern guard that enforces early exit on failure.",
    "AnyError": "**`AnyError`**\n\n16-byte inline type-erased error value with zero heap allocation.",
    "@example": "**`@example(\"title\") { ... }`**\n\nCompile-time contract verification sandbox test in `.jni` blueprints.",
    "@spin": "**`@spin`**\n\nWhite-box compile-time metaprogramming (`@spin fn`, `@spin dsl`, `@spin if`), persisted to `.spun/`.",
}


def uri_to_path(uri: str) -> Path:
    parsed = urllib.parse.urlparse(uri)
    raw_path = urllib.parse.unquote(parsed.path)
    if raw_path.startswith("/") and len(raw_path) > 2 and raw_path[2] == ":":
        raw_path = raw_path[1:]
    return Path(raw_path)


class JennyLanguageServer:
    def __init__(self) -> None:
        self.documents: Dict[str, str] = {}
        self.running = True

    def send_message(self, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        sys.stdout.buffer.write(header + body)
        sys.stdout.buffer.flush()

    def send_response(self, msg_id: Any, result: Any) -> None:
        self.send_message({"jsonrpc": "2.0", "id": msg_id, "result": result})

    def send_notification(self, method: str, params: Dict[str, Any]) -> None:
        self.send_message({"jsonrpc": "2.0", "method": method, "params": params})

    def publish_diagnostics(self, uri: str, text: Optional[str] = None) -> None:
        fpath = uri_to_path(uri)
        report = jenny_flow.check_single_file(fpath, custom_text=text)
        lsp_diags: List[Dict[str, Any]] = []
        for d in report.get("diagnostics", []):
            line_idx = max(0, int(d.get("line", 1)) - 1)
            sev = 2 if d.get("severity") == "warning" else 1
            msg = f"[{d.get('code', 'E0100')}] {d.get('message', '')}"
            if d.get("suggested_replacement"):
                msg += f"\nSuggested fix: {d['suggested_replacement']}"
            lsp_diags.append(
                {
                    "range": {
                        "start": {"line": line_idx, "character": 0},
                        "end": {"line": line_idx, "character": 120},
                    },
                    "severity": sev,
                    "code": d.get("code", "E0100"),
                    "source": "jenny-lsp",
                    "message": msg,
                }
            )
        self.send_notification(
            "textDocument/publishDiagnostics",
            {"uri": uri, "diagnostics": lsp_diags},
        )

    def handle_request(self, msg: Dict[str, Any]) -> None:
        method = msg.get("method", "")
        msg_id = msg.get("id")
        params = msg.get("params", {})

        if method == "initialize":
            self.send_response(
                msg_id,
                {
                    "capabilities": {
                        "textDocumentSync": 1,  # Full sync
                        "hoverProvider": True,
                        "documentSymbolProvider": True,
                    },
                    "serverInfo": {"name": "jenny-lsp", "version": "0.2.0"},
                },
            )
        elif method == "initialized":
            return
        elif method == "shutdown":
            self.send_response(msg_id, None)
        elif method == "exit":
            self.running = False
        elif method == "textDocument/didOpen":
            td = params.get("textDocument", {})
            uri = td.get("uri", "")
            text = td.get("text", "")
            self.documents[uri] = text
            self.publish_diagnostics(uri, text)
        elif method == "textDocument/didChange":
            td = params.get("textDocument", {})
            uri = td.get("uri", "")
            changes = params.get("contentChanges", [])
            if changes:
                self.documents[uri] = changes[-1].get("text", "")
                self.publish_diagnostics(uri, self.documents[uri])
        elif method == "textDocument/didSave":
            td = params.get("textDocument", {})
            uri = td.get("uri", "")
            self.publish_diagnostics(uri, self.documents.get(uri))
        elif method == "textDocument/hover":
            td = params.get("textDocument", {})
            pos = params.get("position", {})
            uri = td.get("uri", "")
            text = self.documents.get(uri)
            if text is None:
                fpath = uri_to_path(uri)
                if fpath.exists():
                    text = fpath.read_text(encoding="utf-8")
            word = self._word_at(text or "", pos.get("line", 0), pos.get("character", 0))
            if word in HOVER_DOCS:
                self.send_response(
                    msg_id,
                    {"contents": {"kind": "markdown", "value": HOVER_DOCS[word]}},
                )
            else:
                self.send_response(msg_id, None)
        elif method == "textDocument/documentSymbol":
            td = params.get("textDocument", {})
            uri = td.get("uri", "")
            fpath = uri_to_path(uri)
            text = self.documents.get(uri)
            report = jenny_flow.check_single_file(fpath, custom_text=text)
            symbols = []
            for idx, sym in enumerate(report.get("symbols", [])):
                kind_map = {"struct": 23, "enum": 10, "function": 12, "example": 6}
                symbols.append(
                    {
                        "name": sym["name"],
                        "detail": sym.get("detail", ""),
                        "kind": kind_map.get(sym.get("kind", ""), 13),
                        "range": {
                            "start": {"line": idx, "character": 0},
                            "end": {"line": idx, "character": 40},
                        },
                        "selectionRange": {
                            "start": {"line": idx, "character": 0},
                            "end": {"line": idx, "character": 40},
                        },
                    }
                )
            self.send_response(msg_id, symbols)
        elif msg_id is not None:
            self.send_response(msg_id, None)

    @staticmethod
    def _word_at(text: str, line: int, col: int) -> str:
        lines = text.splitlines()
        if line < 0 or line >= len(lines):
            return ""
        row = lines[line]
        if col < 0 or col > len(row):
            return ""
        start = col
        while start > 0 and (row[start - 1].isalnum() or row[start - 1] in "_@"):
            start -= 1
        end = col
        while end < len(row) and (row[end].isalnum() or row[end] == "_"):
            end += 1
        return row[start:end]

    def run_stdio(self) -> None:
        while self.running:
            headers: Dict[str, str] = {}
            while True:
                line = sys.stdin.buffer.readline()
                if not line:
                    return
                decoded = line.decode("ascii", errors="ignore").strip()
                if not decoded:
                    break
                if ":" in decoded:
                    k, v = decoded.split(":", 1)
                    headers[k.strip().lower()] = v.strip()
            content_len = int(headers.get("content-length", "0"))
            if content_len <= 0:
                continue
            body = sys.stdin.buffer.read(content_len)
            if not body:
                return
            msg = json.loads(body.decode("utf-8"))
            self.handle_request(msg)


if __name__ == "__main__":
    JennyLanguageServer().run_stdio()
