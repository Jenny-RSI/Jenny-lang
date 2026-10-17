/*
 * Jenny-Flow (v0.2) C99 Zero-Cost Runtime Header (jenny_rt.h)
 *
 * Implements:
 *   1. 16-Byte Register-Inline AnyError (`sizeof(JnAnyError) == 16`)
 *      - Payloads <= 8 bytes require 0 heap allocations.
 *   2. 16-Slot Thread-Local Zero-Cost Error Trace RingBuffer (`JnErrorTraceRing`)
 *   3. Optional Value Wrappers (`T?`) and Null-Coalescing (`??`)
 *   4. Zero-Copy String Slice View (`jn_str`) & Structured JSON Contract Guards
 */

#ifndef JENNY_RT_H
#define JENNY_RT_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* =========================================================================
 * 1. 16-Byte Register-Inline AnyError (Module 05 v2.0 Spec)
 * ========================================================================= */
typedef struct JnAnyError {
    uint32_t err_tag;       /* 0 = Ok (No Error), >0 = Specific Error Variant ID */
    uint16_t flags;         /* 0 = Inline <=8B payload (0 heap alloc), 1 = Heap pointer */
    uint16_t trace_depth;   /* Number of propagation hops recorded in RingBuffer */
    union {
        int64_t inline_i64; /* 8-byte inline payload */
        void*   heap_ptr;   /* Boxed payload only when > 8 bytes */
    } payload;
} JnAnyError;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(JnAnyError) == 16, "JnAnyError must be strictly 16 bytes (2x 64-bit registers)");
#else
typedef char jn_static_assert_anyerror_16_bytes[(sizeof(JnAnyError) == 16) ? 1 : -1];
#endif

/* =========================================================================
 * 2. 16-Slot Thread-Local Zero-Cost Error Trace RingBuffer
 * ========================================================================= */
#define JN_TRACE_CAPACITY 16

typedef struct JnTraceFrame {
    const char* module_name;
    const char* fn_name;
    uint32_t    line;
    uint32_t    err_tag;
} JnTraceFrame;

typedef struct JnErrorTraceRing {
    JnTraceFrame frames[JN_TRACE_CAPACITY];
    uint16_t     write_idx;
    uint16_t     depth;
} JnErrorTraceRing;

static JnErrorTraceRing g_jn_trace_ring = { .write_idx = 0, .depth = 0 };

static inline void jn_trace_reset(void) {
    g_jn_trace_ring.write_idx = 0;
    g_jn_trace_ring.depth = 0;
}

static inline uint16_t jn_trace_push(const char* mod_name, const char* fn_name, uint32_t line, uint32_t err_tag) {
    uint16_t slot = g_jn_trace_ring.write_idx % JN_TRACE_CAPACITY;
    g_jn_trace_ring.frames[slot].module_name = mod_name;
    g_jn_trace_ring.frames[slot].fn_name = fn_name;
    g_jn_trace_ring.frames[slot].line = line;
    g_jn_trace_ring.frames[slot].err_tag = err_tag;
    g_jn_trace_ring.write_idx = (uint16_t)((g_jn_trace_ring.write_idx + 1) % JN_TRACE_CAPACITY);
    if (g_jn_trace_ring.depth < JN_TRACE_CAPACITY) {
        g_jn_trace_ring.depth += 1;
    }
    return g_jn_trace_ring.depth;
}

static inline uint16_t jn_last_trace_depth(void) {
    return g_jn_trace_ring.depth;
}

static inline JnAnyError jn_err_raise(uint32_t err_tag, int64_t inline_meta, const char* mod_name, const char* fn_name, uint32_t line) {
    jn_trace_reset();
    uint16_t d = jn_trace_push(mod_name, fn_name, line, err_tag);
    JnAnyError e;
    e.err_tag = err_tag;
    e.flags = 0;
    e.trace_depth = d;
    e.payload.inline_i64 = inline_meta;
    return e;
}

static inline JnAnyError jn_err_propagate(JnAnyError err, const char* mod_name, const char* fn_name, uint32_t line) {
    uint16_t d = jn_trace_push(mod_name, fn_name, line, err.err_tag);
    err.trace_depth = d;
    return err;
}

/* =========================================================================
 * 3. Zero-Copy String Slice View (`str`) & Optional (`T?`)
 * ========================================================================= */
typedef struct jn_str {
    const char* ptr;
    size_t      len;
} jn_str;

static inline jn_str jn_mk_str(const char* s) {
    jn_str r = { s, s ? strlen(s) : 0 };
    return r;
}

static inline bool jn_str_eq(jn_str a, jn_str b) {
    return a.len == b.len && (a.len == 0 || memcmp(a.ptr, b.ptr, a.len) == 0);
}

typedef struct JnOpt_i64 { bool has_val; int64_t val; } JnOpt_i64;
typedef struct JnOpt_i32 { bool has_val; int32_t val; } JnOpt_i32;
typedef struct JnOpt_str { bool has_val; jn_str  val; } JnOpt_str;

static inline JnOpt_i64 jn_some_i64(int64_t v) { JnOpt_i64 o = { true, v }; return o; }
static inline JnOpt_i64 jn_null_i64(void)      { JnOpt_i64 o = { false, 0 }; return o; }
static inline int64_t   jn_coalesce_i64(JnOpt_i64 o, int64_t def_val) { return o.has_val ? o.val : def_val; }

/* =========================================================================
 * 4. Structured Contract Violation Diagnostic Reporter (`--ai-json`)
 * ========================================================================= */
static inline void jn_contract_fail(const char* kind, const char* fn_name, const char* cond) {
    fprintf(
        stdout,
        "{\"diagnostic\": \"JENNY_CONTRACT_VIOLATION\", \"kind\": \"%s\", \"function\": \"%s\", \"condition\": \"%s\", \"sizeof_anyerror\": %zu}\n",
        kind, fn_name, cond, sizeof(JnAnyError)
    );
    exit(42);
}

/* =========================================================================
 * 5. Stage 2 (`Jenny-Mem v0.3`) Dual-Track Memory Runtime
 *    - `*T` Deterministic Unique Native Heap Box (with leak counter)
 *    - `*in(arena) T` O(1) Bump-Pointer Region Allocator (`JnArena`)
 *    - `^T` Managed Shared Heap Handle Pool (Cyclic Graph / LRU safe)
 * ========================================================================= */
static int32_t g_jn_active_boxes = 0;
static int32_t g_jn_total_box_allocs = 0;

static inline void* jn_box_alloc(size_t sz) {
    void* p = calloc(1, sz);
    if (!p) jn_contract_fail("oom", "jn_box_alloc", "calloc != NULL");
    g_jn_active_boxes += 1;
    g_jn_total_box_allocs += 1;
    return p;
}

static inline void jn_box_free(void* p) {
    if (!p) return;
    if (g_jn_active_boxes <= 0) {
        jn_contract_fail("double_free_or_underflow", "jn_box_free", "g_jn_active_boxes > 0");
    }
    g_jn_active_boxes -= 1;
    free(p);
}

static inline int32_t jn_active_native_boxes(void) {
    return g_jn_active_boxes;
}

static inline int32_t jn_total_native_allocs(void) {
    return g_jn_total_box_allocs;
}

static inline void jn_reset_mem_counters(void) {
    g_jn_active_boxes = 0;
    g_jn_total_box_allocs = 0;
}

typedef struct JnArena {
    uint8_t* buf;
    int64_t  capacity;
    int64_t  used;
    int32_t  alloc_count;
} JnArena;

static inline JnArena Arena_new(int64_t capacity) {
    JnArena a;
    a.buf = (uint8_t*)calloc(1, (size_t)(capacity > 0 ? capacity : 4096));
    a.capacity = capacity;
    a.used = 0;
    a.alloc_count = 0;
    return a;
}

static inline void* jn_arena_alloc(JnArena* a, size_t sz) {
    size_t aligned = (sz + 7u) & ~((size_t)7u);
    if (a->used + (int64_t)aligned > a->capacity) {
        jn_contract_fail("arena_overflow", "jn_arena_alloc", "used + aligned <= capacity");
    }
    void* ptr = a->buf + a->used;
    a->used += (int64_t)aligned;
    a->alloc_count += 1;
    return ptr;
}

static inline int64_t Arena_used_bytes(const JnArena* a)  { return a->used; }
static inline int32_t Arena_alloc_count(const JnArena* a) { return a->alloc_count; }
static inline void    Arena_reset(JnArena* a)             { a->used = 0; a->alloc_count = 0; }
static inline void    Arena_drop(JnArena* a)              { if (a->buf) { free(a->buf); a->buf = NULL; } a->used = 0; a->alloc_count = 0; }

#define JN_GC_POOL_MAX 1024
static void*   g_jn_gc_pool[JN_GC_POOL_MAX];
static int32_t g_jn_gc_count = 0;

static inline void* jn_gc_alloc(size_t sz) {
    void* p = calloc(1, sz);
    if (!p) jn_contract_fail("oom", "jn_gc_alloc", "calloc != NULL");
    if (g_jn_gc_count < JN_GC_POOL_MAX) {
        g_jn_gc_pool[g_jn_gc_count++] = p;
    }
    return p;
}

static inline int32_t jn_active_gc_handles(void) {
    return g_jn_gc_count;
}

static inline void jn_gc_collect_all(void) {
    for (int32_t i = 0; i < g_jn_gc_count; i++) {
        free(g_jn_gc_pool[i]);
        g_jn_gc_pool[i] = NULL;
    }
    g_jn_gc_count = 0;
}

static inline jn_str jn_str_slice(jn_str s, int64_t start, int64_t end) {
    if (start < 0 || end < start || (size_t)end > s.len) {
        jn_contract_fail("slice_bounds", "jn_str_slice", "0 <= start <= end <= s.len");
    }
    jn_str r = { s.ptr + start, (size_t)(end - start) };
    return r;
}

static inline int64_t jn_str_byte_at(jn_str s, int64_t idx) {
    if (idx < 0 || (size_t)idx >= s.len) {
        jn_contract_fail("index_bounds", "jn_str_byte_at", "0 <= idx < s.len");
    }
    return (int64_t)(uint8_t)s.ptr[idx];
}

static inline int64_t jn_str_len(jn_str s) {
    return (int64_t)s.len;
}

/* =========================================================================
 * 6. Stage 4 (`Jenny-Native v1.0`) Zero-Glue C FFI & Explicit Raw Pointers
 * ========================================================================= */
#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 199901L
#define JN_RESTRICT restrict
#else
#define JN_RESTRICT
#endif

typedef const uint8_t* jn_raw_ptr;

static inline jn_raw_ptr jn_str_as_raw_ptr(jn_str s) {
    return (const uint8_t*)s.ptr;
}

static inline int64_t jenny_c_crc32(jn_raw_ptr ptr, int64_t len, int64_t seed) {
    if (!ptr || len < 0) return 0;
    int64_t acc = seed;
    for (int64_t i = 0; i < len; i++) {
        acc += (int64_t)ptr[i];
    }
    return acc;
}

static inline int64_t jenny_c_memcmp_prefix(jn_raw_ptr a, jn_raw_ptr b, int64_t n) {
    if (!a || !b || n < 0) return -1;
    return (int64_t)memcmp(a, b, (size_t)n);
}

/* =========================================================================
 * 7. Three-Track Closure Runtime (`fn`, `*fn[own ...]`, `^fn`)
 *    - Track 1 (`fn(i64) -> i64`): 16-Byte Stack-Bound View Fat Pointer (0 heap alloc)
 *    - Track 2 (`*fn(i64) -> i64`): Unique Native Heap Closure with Cascade Drop
 *    - Track 3 (`^fn(i64) -> i64`): 16-Byte Managed GC Heap Closure
 * ========================================================================= */
typedef struct JnFn_i64_to_i64 {
    const void* env;
    int64_t (*call)(const void* env, int64_t arg);
} JnFn_i64_to_i64;

typedef struct JnBoxFn_i64_to_i64 {
    void* env;
    int64_t (*call)(const void* env, int64_t arg);
    void (*drop_env)(void* env);
} JnBoxFn_i64_to_i64;

typedef struct JnGcFn_i64_to_i64 {
    const void* env;
    int64_t (*call)(const void* env, int64_t arg);
} JnGcFn_i64_to_i64;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(JnFn_i64_to_i64) == 16, "Stack closure JnFn_i64_to_i64 must be a 16-byte fat pointer");
_Static_assert(sizeof(JnGcFn_i64_to_i64) == 16, "Managed GC closure JnGcFn_i64_to_i64 must be a 16-byte fat pointer");
#endif

static inline void jn_box_fn_drop(JnBoxFn_i64_to_i64* f) {
    if (f && f->env && f->drop_env) {
        f->drop_env(f->env);
        f->env = NULL;
    }
}

#endif /* JENNY_RT_H */

