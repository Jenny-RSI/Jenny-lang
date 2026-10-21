import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./ast.ts";
import { compileAndRunBenchmark } from "./driver.ts";

export function runStage1Mutations(
  b11Dir: string = path.join(ROOT_DIR, "benchmarks", "stage1_flow", "B11_layered_gateway"),
  b12Dir: string = path.join(ROOT_DIR, "benchmarks", "stage1_flow", "B12_stream_pipeline"),
): Record<string, any>[] {
  const b11Jn = fs.readFileSync(path.join(b11Dir, "layered_gateway.jn"), "utf-8").replace(/\r\n/g, "\n");
  const b12Jn = fs.readFileSync(path.join(b12Dir, "stream_pipeline.jn"), "utf-8").replace(/\r\n/g, "\n");

  const mutants = [
    {
      id: "MUT-B11-A",
      dir: b11Dir,
      desc: "service_settle_checkout miscalculates total_charged < subtotal",
      jn_code: b11Jn.replace("val total = sub + tax", "val total = sub - 100"),
    },
    {
      id: "MUT-B12-A",
      dir: b12Dir,
      desc: "execute_pipeline skips clamp_score upper bound 1000",
      jn_code: b12Jn.replace("|> clamp_score(0, 1000)", ""),
    },
  ];

  const results: Record<string, any>[] = [];
  for (const m of mutants) {
    const res = compileAndRunBenchmark(m.dir, m.jn_code);
    compileAndRunBenchmark(m.dir);
    const examples: Record<string, any>[] = res.examples ?? [];
    const firstFail = examples.find((ex) => !ex.passed) ?? null;
    const intercepted = firstFail !== null && firstFail.exit_code === 42;
    let diagJson: Record<string, any> | null = null;
    if (firstFail && firstFail.stdout) {
      for (const line of String(firstFail.stdout).split(/\r?\n/)) {
        if (line.startsWith("{")) {
          try {
            diagJson = JSON.parse(line);
          } catch {
            // ignore
          }
        }
      }
    }
    results.push({
      mutant_id: m.id,
      description: m.desc,
      intercepted,
      exit_code: firstFail ? firstFail.exit_code : 0,
      diagnostic: diagJson,
    });
  }
  return results;
}

export function runStage2Mutations(
  b13Dir: string = path.join(ROOT_DIR, "benchmarks", "stage2_mem", "B13_pcm_frame_pipeline"),
  b14Dir: string = path.join(ROOT_DIR, "benchmarks", "stage2_mem", "B14_zero_copy_http_view"),
  b16Dir: string = path.join(ROOT_DIR, "benchmarks", "stage2_mem", "B16_lru_doubly_linked"),
): Record<string, any>[] {
  const b13Jn = fs.readFileSync(path.join(b13Dir, "pcm_frame_pipeline.jn"), "utf-8").replace(/\r\n/g, "\n");
  const b14Jn = fs.readFileSync(path.join(b14Dir, "http_view.jn"), "utf-8").replace(/\r\n/g, "\n");
  const b16Jn = fs.readFileSync(path.join(b16Dir, "lru_doubly_linked.jn"), "utf-8").replace(/\r\n/g, "\n");

  const staticMutants = [
    {
      id: "MUT-S2-E0201",
      dir: b13Dir,
      expected_code: "E0201_USE_AFTER_OWN",
      desc: "Use `*PcmFrame` variable `frame` after `consume_and_archive(own frame)`",
      jn_code: b13Jn.replace(
        "return consume_and_archive(own frame)",
        "val s = consume_and_archive(own frame)\n    return frame.s0 + s",
      ),
    },
    {
      id: "MUT-S2-E0106",
      dir: b13Dir,
      expected_code: "E0106_READONLY_PARAM_MUTATION",
      desc: "Mutate `self.s0` inside read-only `peak_energy(self)` method",
      jn_code: b13Jn.replace(
        "return self.s0 * self.s0",
        "self.s0 = 999\n        return self.s0 * self.s0",
      ),
    },
    {
      id: "MUT-S2-E0202",
      dir: b16Dir,
      expected_code: "E0202_CONFLICTING_MUT_BORROW",
      desc: "Pass `mut n1` twice in `link_two_nodes(mut n1, mut n1)` causing aliasing mut borrow",
      jn_code: b16Jn.replace(
        "link_two_nodes(mut n1, mut n2)",
        "link_two_nodes(mut n1, mut n1)",
      ),
    },
    {
      id: "MUT-S2-E0203",
      dir: b14Dir,
      expected_code: "E0203_VIEW_STRUCT_ESCAPE",
      desc: "Attempt to heap-box stack-bound slice view `*HttpRequestView`",
      jn_code: b14Jn.replace(
        "return HttpRequestView {",
        "return *HttpRequestView {",
      ),
    },
    {
      id: "MUT-S2-E0204",
      dir: b16Dir,
      expected_code: "E0204_UNDECLARED_EFFECT",
      desc: "Allocate `^LruNode` inside pure function `sum_linked_pair` without `effects [AllocGC]`",
      jn_code: b16Jn.replace(
        "return head.next.val_data + tail.prev.val_data",
        "val leaked = ^LruNode { key: 0, val_data: 0, prev: null, next: null }\n    return head.next.val_data + tail.prev.val_data",
      ),
    },
  ];

  const results: Record<string, any>[] = [];
  for (const m of staticMutants) {
    const res = compileAndRunBenchmark(m.dir, m.jn_code, null, true);
    const diags: Record<string, any>[] = res.ai_diagnostics ?? [];
    const codes = diags.map((d) => String(d.code));
    const intercepted = !res.compile_ok && codes.includes(m.expected_code);
    results.push({
      mutant_id: m.id,
      expected_code: m.expected_code,
      description: m.desc,
      intercepted,
      codes_caught: codes,
    });
  }
  return results;
}

export function runStage3Mutations(
  b18Dir: string = path.join(ROOT_DIR, "benchmarks", "stage3_spin", "B18_trait_delegate_decorator"),
  b20Dir: string = path.join(ROOT_DIR, "benchmarks", "stage3_spin", "B20_spin_binary_codec"),
  fmtDir: string = path.join(ROOT_DIR, "library", "std", "str", "fmt.jni"),
): Record<string, any>[] {
  const b19Dir = path.join(path.dirname(b18Dir), "B19_spin_fsm_order");
  const fmtMod = fmtDir.endsWith(".jni") ? fmtDir : path.join(fmtDir, "fmt.jni");

  const b18Jni = fs.readFileSync(path.join(b18Dir, "trait_delegate.jni"), "utf-8").replace(/\r\n/g, "\n");
  const b19Jn = fs.readFileSync(path.join(b19Dir, "spin_fsm_order.jn"), "utf-8").replace(/\r\n/g, "\n");
  const b20Jni = fs.readFileSync(path.join(b20Dir, "spin_binary_codec.jni"), "utf-8").replace(/\r\n/g, "\n");
  const fmtJni = fs.readFileSync(fmtMod, "utf-8").replace(/\r\n/g, "\n");

  const staticMutants = [
    {
      id: "MUT-S3-E0305",
      dir: b20Dir,
      expected_code: "E0305_SPIN_GC_IN_BINARY_CODEC",
      desc: "Embed a managed GC handle `^TelemetryPacket` inside `@apply(codec::binary)` struct",
      jni_code: b20Jni.replaceAll(
        "pub checksum: i64 = 0,",
        "pub checksum: i64 = 0,\n    pub gc_ref: ^TelemetryPacket,",
      ),
      jn_code: null as string | null,
    },
    {
      id: "MUT-S3-E0306",
      dir: b19Dir,
      expected_code: "E0306_SPIN_MUTATE_EXISTING_FIELD",
      desc: "Attempt to mutate/delete an existing struct field inside `@spin` block (violating Additive-Only rule)",
      jni_code: null as string | null,
      jn_code: b19Jn.replaceAll(
        "0 --[0]--> 1 guard (self.amount_cents > 0)",
        "!delete_field amount_cents\n    0 --[0]--> 1 guard (self.amount_cents > 0)",
      ),
    },
    {
      id: "MUT-S3-E0307",
      dir: b18Dir,
      expected_code: "E0307_INVALID_DELEGATE_TARGET",
      desc: "Delegate `KvEngine` to non-existent struct field `self.missing_engine`",
      jni_code: b18Jni.replaceAll(
        "delegate KvEngine to self.inner",
        "delegate KvEngine to self.missing_engine",
      ),
      jn_code: null as string | null,
    },
    {
      id: "MUT-S3-E0309",
      dir: fmtMod,
      expected_code: "E0309_VARIADIC_TRAIT_BOUND_UNSATISFIED",
      desc: 'Pass an unformattable tuple `("bad", FmtSpec.HexLower, 4)` to `@spin fn format(...args: Formattable)`',
      jni_code: fmtJni.replaceAll(
        "val hex_item = (48879, FmtSpec.HexLower, 4)",
        'val hex_item = ("bad", FmtSpec.HexLower, 4)',
      ),
      jn_code: null as string | null,
    },
    {
      id: "MUT-S3-E0507",
      dir: b18Dir,
      expected_code: "E0507_SEMVER_STRENGTHENED_REQUIRES",
      desc: "Strengthen precondition on `MemKvStore.read_slot` with `requires slot >= 0` not present on `KvEngine.read_slot` under `impl KvEngine for MemKvStore {}`",
      jni_code: b18Jni.replace(
        "impl MemKvStore {\n    pub fn new(s0: i64, s1: i64, s2: i64, s3: i64) -> MemKvStore\n        ensures result.writes == 0\n\n    pub fn read_slot(self, slot: i64) -> i64",
        "impl KvEngine for MemKvStore {}\n\nimpl MemKvStore {\n    pub fn new(s0: i64, s1: i64, s2: i64, s3: i64) -> MemKvStore\n        ensures result.writes == 0\n\n    pub fn read_slot(self, slot: i64) -> i64\n        requires slot >= 0",
      ),
      jn_code: null as string | null,
    },
  ];

  const results: Record<string, any>[] = [];
  for (const m of staticMutants) {
    const res = compileAndRunBenchmark(m.dir, m.jn_code, m.jni_code, true);
    compileAndRunBenchmark(m.dir, null, null, true);
    const diags: Record<string, any>[] = res.ai_diagnostics ?? [];
    const codes = diags.map((d) => String(d.code));
    const intercepted = !res.compile_ok && codes.includes(m.expected_code);
    results.push({
      mutant_id: m.id,
      expected_code: m.expected_code,
      description: m.desc,
      intercepted,
      codes_caught: codes,
    });
  }
  return results;
}

export function runStage4Mutations(
  b22Dir: string = path.join(ROOT_DIR, "benchmarks", "stage4_native", "B22_c_ffi_crc32_hasher"),
  b25Dir: string = path.join(ROOT_DIR, "benchmarks", "stage4_native", "B25_closure_lifetimes"),
): Record<string, any>[] {
  if (!fs.existsSync(b22Dir)) {
    return [];
  }

  const b22Jni = fs.readFileSync(path.join(b22Dir, "c_ffi_crc32.jni"), "utf-8").replace(/\r\n/g, "\n");
  const b22Jn = fs.readFileSync(path.join(b22Dir, "c_ffi_crc32.jn"), "utf-8").replace(/\r\n/g, "\n");
  const b25Jn = fs.existsSync(b25Dir)
    ? fs.readFileSync(path.join(b25Dir, "closure_lifetimes.jn"), "utf-8").replace(/\r\n/g, "\n")
    : "";

  const staticMutants: {
    id: string;
    dir: string;
    expected_code: string;
    desc: string;
    jni_code: string | null;
    jn_code: string | null;
  }[] = [
    {
      id: "MUT-S4-E0401",
      dir: b22Dir,
      expected_code: "E0401_FFI_IMPLICIT_RAW_PTR",
      desc: "Pass Jenny `str` slice `payload` directly to `c_crc::jenny_c_crc32(payload, ...)` without `.as_raw_ptr()`",
      jni_code: null,
      jn_code: b22Jn.replace(
        "c_crc::jenny_c_crc32(payload.as_raw_ptr(), payload.len(), seed)",
        "c_crc::jenny_c_crc32(payload, payload.len(), seed)",
      ),
    },
    {
      id: "MUT-S4-E0402",
      dir: b22Dir,
      expected_code: "E0402_FFI_MISSING_UNSAFE_EFFECT",
      desc: "Call C FFI function `c_crc::jenny_c_crc32` inside `compute_packet_crc` without `effects [Unsafe]` in blueprint",
      jni_code: b22Jni.replace("    effects [Unsafe]\n", ""),
      jn_code: null,
    },
    {
      id: "MUT-S4-E0403",
      dir: b22Dir,
      expected_code: "E0403_FFI_GC_PTR_TO_C",
      desc: "Embed a managed GC handle `^CrcPacket` inside `@repr(C) pub struct CrcPacket`",
      jni_code: b22Jni.replace(
        "pub seed_used: i64,",
        "pub seed_used: i64,\n    pub gc_leak: ^CrcPacket,",
      ),
      jn_code: null,
    },
  ];

  if (fs.existsSync(b25Dir)) {
    staticMutants.push(
      {
        id: "MUT-S4-E0205",
        dir: b25Dir,
        expected_code: "E0205_STACK_CLOSURE_ESCAPE",
        desc: "Attempt to return stack-bound closure `fn(v) => ...` out of `make_shared_scorer` stack frame",
        jni_code: null,
        jn_code: b25Jn.replace(
          "return ^fn(v) => v * weight - threshold",
          "return fn(v) => v * weight - threshold",
        ),
      },
      {
        id: "MUT-S4-E0206",
        dir: b25Dir,
        expected_code: "E0206_CLOSURE_MISSING_OWN_CAPTURE",
        desc: "Attempt to capture unique native box `sig: *SignalBox` inside escaping closure without `[own sig]`",
        jni_code: null,
        jn_code: b25Jn.replace(
          "return *fn[own sig](v) => v * sig.base_gain + sig.offset + extra",
          "return *fn(v) => v * sig.base_gain + sig.offset + extra",
        ),
      },
      {
        id: "MUT-S4-E0709",
        dir: b25Dir,
        expected_code: "E0709_MASKED_LOCK_ESCAPE",
        desc: "Attempt to escape a lock guard (`return mtx_guard`) out of a `mask [Sync]` scope",
        jni_code: null,
        jn_code:
          b25Jn +
          "\nfn leaked_sync_helper(x: i64) -> i64 mask [Sync] {\n    val mtx_guard = x\n    return mtx_guard\n}\n",
      },
      {
        id: "MUT-S4-E0711",
        dir: b25Dir,
        expected_code: "E0711_UNPROVEN_BOUNDS_CONTAINMENT",
        desc: "Incomplete bounds check (`guard offset + 4 <= buf.len` missing lower bound `offset >= 0`) before `buf.get_unchecked(offset + 3)` under `mask [Unsafe]`",
        jni_code: null,
        jn_code:
          b25Jn +
          "\nfn bad_read_u32(offset: i64) -> i64 mask [Unsafe] {\n    guard offset + 4 <= buf.len else { return 0 }\n    return buf.get_unchecked(offset + 3)\n}\n",
      },
    );
  }

  const results: Record<string, any>[] = [];
  for (const m of staticMutants) {
    const res = compileAndRunBenchmark(m.dir, m.jn_code, m.jni_code, true);
    compileAndRunBenchmark(m.dir, null, null, true);
    const diags: Record<string, any>[] = res.ai_diagnostics ?? [];
    const codes = diags.map((d) => String(d.code));
    const intercepted = !res.compile_ok && codes.includes(m.expected_code);
    results.push({
      mutant_id: m.id,
      expected_code: m.expected_code,
      description: m.desc,
      intercepted,
      codes_caught: codes,
    });
  }
  return results;
}
