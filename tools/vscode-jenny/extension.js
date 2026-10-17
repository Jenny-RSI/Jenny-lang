const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");

const JENNY_HOVER_DOCS = {
  requires:
    "**`requires <cond> [else <ErrVariant>]`** — *First-Class Precondition Contract*\n\n" +
    "Checked automatically at function entry before executing `.jn` body. If violated, immediately returns `<ErrVariant>` (or aborts in infallible functions).",
  ensures:
    "**`ensures <cond>`** — *First-Class Postcondition Contract*\n\n" +
    "Verified automatically at every `return` site. Can reference `result` (return value) and `old(expr)` (entry snapshot).",
  invariant:
    "**`invariant <cond>`** — *Struct Data Invariant*\n\n" +
    "Checked after `Struct.new(...)` construction and after every `mut self` method invocation.",
  old:
    "**`old(<expr>)`** — *Pre-State Snapshot*\n\n" +
    "Captures the value of `<expr>` at function entry so `ensures` postconditions can verify state transitions (e.g. `ensures self.count == old(self.count) + 1`).",
  result:
    "**`result`** — *Return Value Binding in `ensures`*\n\n" +
    "Refers to the normal return value of the current function inside an `ensures` contract clause.",
  mut:
    "**`mut`** — *In-Place Mutable Borrow Mode (Jenny v2.0)*\n\n" +
    "In Jenny v2.0, `&T` and `&mut T` are abolished. Parameters are read-only borrows by default (`x: T`, `self`); write `mut x: T` or `mut self` for in-place mutation.",
  own:
    "**`own`** — *Ownership Transfer Mode (Jenny v2.0)*\n\n" +
    "Explicitly transfers and consumes ownership of the argument or receiver (e.g., `fn drop(own self)` or `own frame: *PcmFrame`).",
  guard:
    "**`guard <cond-or-pattern> else { ... }`** — *Linear Early-Exit Guard*\n\n" +
    "Asserts a positive condition or pattern (`guard x is Variant(v) else { raise Err }`) and keeps the happy path unindented.",
  AnyError:
    "**`AnyError`** — *16-Byte Inline Type-Erased Error Carrier*\n\n" +
    "Used in Tier-2 (`T ! (BizError | AnyError)`) and Tier-3 (`T!`) error signatures. Zero heap allocation, paired with a 16-slot thread-local error trace ring buffer.",
  "@example":
    "**`@example(\"title\") { ... }`** — *Compile-Time Contract Sandbox Test*\n\n" +
    "Embedded executable specification in `.jni`. Automatically compiled and verified by the Jenny compiler.",
  "@spin":
    "**`@spin`** — *White-Box Compile-Time Metaprogramming*\n\n" +
    "Purely additive compile-time code generation (`@spin fn`, `@spin dsl`, `@spin if`), persisted to `.spun/<module>.spun.jn` for zero-magic debugging."
};

function findCompilerScript(filePath) {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "compiler", "jenny-flow", "jenny_flow.py");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (vscode.workspace.workspaceFolders) {
    for (const wf of vscode.workspace.workspaceFolders) {
      const candidate = path.join(wf.uri.fsPath, "compiler", "jenny-flow", "jenny_flow.py");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function isJennyRelatedDocument(doc) {
  if (!doc || !doc.fileName) return false;
  const ext = path.extname(doc.fileName).toLowerCase();
  return ext === ".jni" || ext === ".jn";
}

function activate(context) {
  const diagCollection = vscode.languages.createDiagnosticCollection("jenny");
  const outputChannel = vscode.window.createOutputChannel("Spinning Jenny");
  context.subscriptions.push(diagCollection, outputChannel);

  function runFastEditorDiagnostics(doc) {
    if (!isJennyRelatedDocument(doc)) return;
    const ext = path.extname(doc.fileName).toLowerCase();
    const text = doc.getText();
    const lines = text.split(/\r?\n/);
    const diags = [];

    let inFence = ext === ".jn";
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (ext === ".jni") {
        if (trimmed.startsWith("```jenny") || trimmed.startsWith("```jn")) {
          inFence = true;
          continue;
        }
        if (inFence && trimmed.startsWith("```")) {
          inFence = false;
          continue;
        }
      }
      if (!inFence) continue;
      const codePart = rawLine.split("//")[0];
      if (!codePart.trim()) continue;

      const refMatch = codePart.match(/&\s*(mut\b|self\b|[A-Za-z_])/);
      if (refMatch) {
        const col = codePart.indexOf(refMatch[0]);
        const range = new vscode.Range(i, Math.max(0, col), i, Math.max(0, col + refMatch[0].length));
        const d = new vscode.Diagnostic(
          range,
          "[E0101_FORBIDDEN_REF_SYNTAX] Jenny v2.0 abolishes `&T`, `&mut T`, and `&self`! Parameters default to read-only borrow (`x: T`, `self`); use `mut` or `own`.",
          vscode.DiagnosticSeverity.Error
        );
        d.source = "jenny-v2";
        d.code = "E0101";
        diags.push(d);
      }

      const letMatch = codePart.match(/^\s*(let)\s+[A-Za-z0-9_]+/);
      if (letMatch) {
        const col = codePart.indexOf("let");
        const range = new vscode.Range(i, col, i, col + 3);
        const d = new vscode.Diagnostic(
          range,
          "[E0102_FORBIDDEN_LET_BINDING] Jenny v2.0 uses `val` (immutable) or `var` (mutable), never `let`.",
          vscode.DiagnosticSeverity.Error
        );
        d.source = "jenny-v2";
        d.code = "E0102";
        diags.push(d);
      }

      if (ext === ".jn" && codePart.trimEnd().endsWith(";")) {
        const semiCol = codePart.lastIndexOf(";");
        const range = new vscode.Range(i, semiCol, i, semiCol + 1);
        const d = new vscode.Diagnostic(
          range,
          "[W0103_TOLERANT_TRAILING_SEMICOLON] Jenny v2.0 is semicolon-free (trailing `;` is absorbed by the compiler).",
          vscode.DiagnosticSeverity.Information
        );
        d.source = "jenny-v2";
        d.code = "W0103";
        diags.push(d);
      }
    }

    diagCollection.set(doc.uri, diags);
  }

  function runCompilerCheckOnDisk(doc) {
    if (!isJennyRelatedDocument(doc)) return;
    runFastEditorDiagnostics(doc);
    const compilerScript = findCompilerScript(doc.fileName);
    if (!compilerScript) return;

    cp.execFile(
      "python",
      [compilerScript, "--check-file", doc.fileName],
      { cwd: path.dirname(compilerScript), timeout: 8000 },
      (err, stdout) => {
        if (err && !stdout) return;
        try {
          const report = JSON.parse(stdout);
          const diags = [];
          for (const item of report.diagnostics || []) {
            const lineIdx = Math.max(0, (item.line || 1) - 1);
            const lineText = lineIdx < doc.lineCount ? doc.lineAt(lineIdx).text : "";
            const range = new vscode.Range(lineIdx, 0, lineIdx, Math.max(1, lineText.length));
            const sev =
              item.severity === "warning"
                ? vscode.DiagnosticSeverity.Information
                : vscode.DiagnosticSeverity.Error;
            const msg = item.suggested_replacement
              ? `[${item.code}] ${item.message}\n💡 Suggested Fix: ${item.suggested_replacement}`
              : `[${item.code}] ${item.message}`;
            const d = new vscode.Diagnostic(range, msg, sev);
            d.source = "jenny-flow";
            d.code = item.code;
            diags.push(d);
          }
          diagCollection.set(doc.uri, diags);
        } catch (_) {
          // Ignore parse errors during partial edits
        }
      }
    );
  }

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("jenny.runExamples", async (uriArg) => {
      const targetUri =
        uriArg || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (!targetUri) return;
      const filePath = targetUri.fsPath;
      const compilerScript = findCompilerScript(filePath);
      if (!compilerScript) {
        vscode.window.showErrorMessage("Could not locate compiler/jenny-flow/jenny_flow.py in workspace.");
        return;
      }

      outputChannel.show(true);
      outputChannel.appendLine(`\n[Jenny] Running @example contract verification for: ${filePath} ...`);

      cp.execFile(
        "python",
        [compilerScript, "--run-file", filePath],
        { cwd: path.dirname(compilerScript), timeout: 15000 },
        (err, stdout, stderr) => {
          if (stderr) outputChannel.appendLine(stderr);
          try {
            const res = JSON.parse(stdout);
            outputChannel.appendLine(JSON.stringify(res, null, 2));
            if (res.compile_ok && (res.examples || []).every((e) => e.passed)) {
              const count = (res.examples || []).length;
              vscode.window.showInformationMessage(
                `✅ Jenny Module '${res.module}': All ${count}/${count} @example contract tests PASSED! (${res.compile_ms} ms)`
              );
            } else {
              vscode.window.showErrorMessage(
                `❌ Jenny Module '${res.module}' verification failed. Check 'Spinning Jenny' output panel.`
              );
            }
          } catch (e) {
            outputChannel.appendLine(stdout || String(err));
            vscode.window.showErrorMessage("Failed to run Jenny @example tests.");
          }
        }
      );
    }),

    vscode.commands.registerCommand("jenny.generateSkeleton", async (uriArg) => {
      const targetUri =
        uriArg || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (!targetUri) return;
      const filePath = targetUri.fsPath;
      const compilerScript = findCompilerScript(filePath);
      if (!compilerScript) return;

      cp.execFile(
        "python",
        [compilerScript, "--skeleton", filePath],
        { cwd: path.dirname(compilerScript), timeout: 8000 },
        async (err, stdout) => {
          if (err || !stdout) {
            vscode.window.showErrorMessage("Failed to generate .jn skeleton from .jni blueprint.");
            return;
          }
          const doc = await vscode.workspace.openTextDocument({
            language: "jenny",
            content: stdout.trim() + "\n"
          });
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
        }
      );
    }),

    vscode.commands.registerCommand("jenny.previewBlueprint", async (uriArg) => {
      const targetUri =
        uriArg || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (!targetUri) return;
      await vscode.commands.executeCommand("markdown.showPreviewToSide", targetUri);
    }),

    vscode.commands.registerCommand("jenny.checkFile", async () => {
      if (vscode.window.activeTextEditor) {
        runCompilerCheckOnDisk(vscode.window.activeTextEditor.document);
        vscode.window.showInformationMessage("Jenny v2.0 contract & syntax check completed.");
      }
    })
  );

  // CodeLens Provider for .jni (markdown) and .jn (jenny)
  const codeLensProvider = {
    provideCodeLenses(document) {
      if (!isJennyRelatedDocument(document)) return [];
      const ext = path.extname(document.fileName).toLowerCase();
      const lenses = [];
      const lines = document.getText().split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (ext === ".jni" && (trimmed.startsWith("```jenny") || trimmed.startsWith("```jn"))) {
          const range = new vscode.Range(i, 0, i, trimmed.length);
          lenses.push(
            new vscode.CodeLens(range, {
              title: "▶ Run @example Contract Tests",
              command: "jenny.runExamples",
              arguments: [document.uri]
            }),
            new vscode.CodeLens(range, {
              title: "🦴 Generate .jn Skeleton",
              command: "jenny.generateSkeleton",
              arguments: [document.uri]
            }),
            new vscode.CodeLens(range, {
              title: "👁️ Preview .jni Blueprint",
              command: "jenny.previewBlueprint",
              arguments: [document.uri]
            })
          );
        } else if (trimmed.startsWith("@example(")) {
          const range = new vscode.Range(i, 0, i, trimmed.length);
          lenses.push(
            new vscode.CodeLens(range, {
              title: "▶ Verify @example in Sandbox",
              command: "jenny.runExamples",
              arguments: [document.uri]
            })
          );
        } else if (ext === ".jn" && trimmed.startsWith("module ")) {
          const range = new vscode.Range(i, 0, i, trimmed.length);
          lenses.push(
            new vscode.CodeLens(range, {
              title: "▶ Run Module @example Contract Tests",
              command: "jenny.runExamples",
              arguments: [document.uri]
            }),
            new vscode.CodeLens(range, {
              title: "🔍 Check Contracts (--ai-json)",
              command: "jenny.checkFile"
            })
          );
        }
      }
      return lenses;
    }
  };

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "jenny" },
        { language: "markdown", pattern: "**/*.jni" }
      ],
      codeLensProvider
    )
  );

  // Hover Provider
  const hoverProvider = {
    provideHover(document, position) {
      if (!isJennyRelatedDocument(document)) return null;
      const wordRange = document.getWordRangeAtPosition(position, /@[a-zA-Z_]+|[a-zA-Z_][a-zA-Z0-9_]*/);
      if (!wordRange) return null;
      const word = document.getText(wordRange);
      if (JENNY_HOVER_DOCS[word]) {
        return new vscode.Hover(new vscode.MarkdownString(JENNY_HOVER_DOCS[word]), wordRange);
      }
      return null;
    }
  };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [
        { language: "jenny" },
        { language: "markdown", pattern: "**/*.jni" }
      ],
      hoverProvider
    )
  );

  // Document Symbol Provider for .jn files
  const symbolProvider = {
    provideDocumentSymbols(document) {
      const symbols = [];
      const lines = document.getText().split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        let m = line.match(/^(?:pub\s+)?(struct|enum|impl)\s+([A-Za-z0-9_]+)/);
        if (m) {
          const kind =
            m[1] === "struct"
              ? vscode.SymbolKind.Struct
              : m[1] === "enum"
              ? vscode.SymbolKind.Enum
              : vscode.SymbolKind.Class;
          const range = new vscode.Range(i, 0, i, lines[i].length);
          symbols.push(new vscode.DocumentSymbol(m[2], m[1], kind, range, range));
          continue;
        }
        m = line.match(/^(?:pub\s+)?fn\s+([A-Za-z0-9_]+)\s*\(/);
        if (m) {
          const range = new vscode.Range(i, 0, i, lines[i].length);
          symbols.push(new vscode.DocumentSymbol(m[1], "fn", vscode.SymbolKind.Function, range, range));
        }
      }
      return symbols;
    }
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider({ language: "jenny" }, symbolProvider)
  );

  // Document Lifecycle Listeners
  let debounceTimer = null;
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => runCompilerCheckOnDisk(doc)),
    vscode.workspace.onDidSaveTextDocument((doc) => runCompilerCheckOnDisk(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isJennyRelatedDocument(e.document)) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runFastEditorDiagnostics(e.document), 300);
    })
  );

  for (const doc of vscode.workspace.textDocuments) {
    if (isJennyRelatedDocument(doc)) {
      runCompilerCheckOnDisk(doc);
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
