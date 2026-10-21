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

typedef struct JnSlice_i64 {
    int64_t* ptr;
    int64_t  len;
} JnSlice_i64;

typedef struct JnSlice_u8 {
    uint8_t* ptr;
    int64_t  len;
} JnSlice_u8;

typedef struct JnSlice_u64 {
    uint64_t* ptr;
    int64_t   len;
} JnSlice_u64;

typedef struct JnSlice_str {
    jn_str* ptr;
    int64_t len;
} JnSlice_str;

static inline JnSlice_i64 jn_slice_i64_sub(JnSlice_i64 xs, int64_t start, int64_t end) {
    JnSlice_i64 r = { xs.ptr ? (xs.ptr + start) : NULL, end - start };
    return r;
}

static inline JnSlice_u8 jn_slice_u8_sub(JnSlice_u8 xs, int64_t start, int64_t end) {
    JnSlice_u8 r = { xs.ptr ? (xs.ptr + start) : NULL, end - start };
    return r;
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

/* -------------------------------------------------------------------------
 * 5a. Native Contiguous Heap Buffer Primitives (`*T` backing store for std)
 *     Tracked by `g_jn_active_boxes` & `g_jn_total_box_allocs` for leak detection.
 * ------------------------------------------------------------------------- */
static inline int64_t jn_raw_alloc(int64_t cap) {
    if (cap <= 0) return 0;
    int64_t* p = (int64_t*)calloc((size_t)cap, sizeof(int64_t));
    if (!p) jn_contract_fail("oom", "jn_raw_alloc", "calloc != NULL");
    g_jn_active_boxes += 1;
    g_jn_total_box_allocs += 1;
    return (int64_t)(intptr_t)p;
}

static inline void jn_raw_free(int64_t raw_ptr) {
    if (raw_ptr == 0) return;
    if (g_jn_active_boxes <= 0) {
        jn_contract_fail("double_free_or_underflow", "jn_raw_free", "g_jn_active_boxes > 0");
    }
    g_jn_active_boxes -= 1;
    free((void*)(intptr_t)raw_ptr);
}

static inline int64_t jn_raw_realloc(int64_t old_ptr, int64_t old_cap, int64_t new_cap) {
    if (new_cap <= 0) {
        jn_raw_free(old_ptr);
        return 0;
    }
    int64_t* new_p = (int64_t*)calloc((size_t)new_cap, sizeof(int64_t));
    if (!new_p) jn_contract_fail("oom", "jn_raw_realloc", "calloc != NULL");
    g_jn_total_box_allocs += 1;
    if (old_ptr != 0) {
        int64_t copy_cnt = (old_cap < new_cap) ? old_cap : new_cap;
        if (copy_cnt > 0) {
            memcpy(new_p, (const void*)(intptr_t)old_ptr, (size_t)copy_cnt * sizeof(int64_t));
        }
        free((void*)(intptr_t)old_ptr);
    } else {
        g_jn_active_boxes += 1;
    }
    return (int64_t)(intptr_t)new_p;
}

static inline int64_t jn_raw_get(int64_t raw_ptr, int64_t idx) {
    if (raw_ptr == 0 || idx < 0) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_get", "raw_ptr != 0 && idx >= 0");
    }
    const int64_t* p = (const int64_t*)(intptr_t)raw_ptr;
    return p[idx];
}

static inline int64_t jn_raw_set(int64_t raw_ptr, int64_t idx, int64_t val) {
    if (raw_ptr == 0 || idx < 0) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_set", "raw_ptr != 0 && idx >= 0");
    }
    int64_t* p = (int64_t*)(intptr_t)raw_ptr;
    p[idx] = val;
    return val;
}

static inline int64_t jn_raw_copy(int64_t dst_ptr, int64_t dst_off, int64_t src_ptr, int64_t src_off, int64_t count) {
    if (count <= 0) return 0;
    if (dst_ptr == 0 || src_ptr == 0 || dst_off < 0 || src_off < 0) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_copy", "valid pointers and non-negative offsets");
    }
    int64_t* dst = ((int64_t*)(intptr_t)dst_ptr) + dst_off;
    const int64_t* src = ((const int64_t*)(intptr_t)src_ptr) + src_off;
    memmove(dst, src, (size_t)count * sizeof(int64_t));
    return count;
}

/* -------------------------------------------------------------------------
 * 5b. True 64KB Block + 128B Line Immix Bump-Pointer & Mark-Region Collector
 *     - Block size: 65,536 bytes (64 KB)
 *     - Line size:  128 bytes (512 lines per block)
 *     - Bump-allocates inside free line holes `[cursor_line .. limit_line)`
 *     - Reclaims unmarked lines and recycles empty 64KB blocks in O(blocks)
 * ------------------------------------------------------------------------- */
#define JN_IMMIX_BLOCK_SIZE      65536u
#define JN_IMMIX_LINE_SIZE       128u
#define JN_IMMIX_LINES_PER_BLOCK 512u
#define JN_IMMIX_MAX_BLOCKS      64u
#define JN_GC_HEADER_MAGIC       0x4A4E4743u /* 'JNGC' */

typedef struct JnGcHeader {
    uint32_t size_bytes;
    uint16_t block_idx;
    uint16_t start_line;
    uint16_t span_lines;
    uint8_t  marked;
    uint8_t  generation;
    uint32_t magic;
} JnGcHeader;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(JnGcHeader) == 16, "JnGcHeader must be 16-byte aligned");
#endif

typedef struct JnImmixBlock {
    uint8_t* raw_mem;
    uint8_t  line_marks[JN_IMMIX_LINES_PER_BLOCK];
    uint16_t cursor_line;
    uint16_t limit_line;
    uint16_t live_lines;
    uint8_t  in_use;
    uint8_t  recycled;
} JnImmixBlock;

static JnImmixBlock g_jn_immix_blocks[JN_IMMIX_MAX_BLOCKS];
static int32_t      g_jn_immix_block_count = 0;
static int32_t      g_jn_gc_count = 0;
static int32_t      g_jn_gc_live_lines = 0;
static int32_t      g_jn_gc_recycled_blocks = 0;

static inline bool jn_immix_find_hole(JnImmixBlock* blk, uint16_t start_from, uint16_t needed_lines, uint16_t* out_start, uint16_t* out_limit) {
    uint16_t l = start_from;
    while (l < JN_IMMIX_LINES_PER_BLOCK) {
        while (l < JN_IMMIX_LINES_PER_BLOCK && blk->line_marks[l] != 0) {
            l++;
        }
        if (l >= JN_IMMIX_LINES_PER_BLOCK) break;
        uint16_t hole_start = l;
        while (l < JN_IMMIX_LINES_PER_BLOCK && blk->line_marks[l] == 0) {
            l++;
        }
        uint16_t hole_end = l;
        if ((uint16_t)(hole_end - hole_start) >= needed_lines) {
            *out_start = hole_start;
            *out_limit = hole_end;
            return true;
        }
    }
    return false;
}

static inline void* jn_gc_alloc(size_t sz) {
    size_t aligned_payload = (sz + 7u) & ~((size_t)7u);
    size_t total_bytes = sizeof(JnGcHeader) + aligned_payload;
    uint16_t needed_lines = (uint16_t)((total_bytes + JN_IMMIX_LINE_SIZE - 1u) / JN_IMMIX_LINE_SIZE);
    if (needed_lines == 0) needed_lines = 1;
    if (needed_lines > JN_IMMIX_LINES_PER_BLOCK) {
        jn_contract_fail("immix_oversize_object", "jn_gc_alloc", "needed_lines <= 512");
    }

    int32_t chosen_blk = -1;
    uint16_t alloc_line = 0;

    for (int32_t b = 0; b < g_jn_immix_block_count; b++) {
        JnImmixBlock* blk = &g_jn_immix_blocks[b];
        if (!blk->in_use) continue;
        if ((uint16_t)(blk->limit_line - blk->cursor_line) >= needed_lines) {
            chosen_blk = b;
            alloc_line = blk->cursor_line;
            blk->cursor_line = (uint16_t)(blk->cursor_line + needed_lines);
            break;
        }
        uint16_t hole_start = 0, hole_limit = 0;
        if (jn_immix_find_hole(blk, blk->cursor_line, needed_lines, &hole_start, &hole_limit)) {
            chosen_blk = b;
            alloc_line = hole_start;
            blk->cursor_line = (uint16_t)(hole_start + needed_lines);
            blk->limit_line = hole_limit;
            break;
        }
    }

    if (chosen_blk < 0) {
        if (g_jn_immix_block_count >= (int32_t)JN_IMMIX_MAX_BLOCKS) {
            jn_contract_fail("immix_block_pool_exhausted", "jn_gc_alloc", "block_count < JN_IMMIX_MAX_BLOCKS");
        }
        chosen_blk = g_jn_immix_block_count++;
        JnImmixBlock* blk = &g_jn_immix_blocks[chosen_blk];
        if (!blk->raw_mem) {
            blk->raw_mem = (uint8_t*)calloc(1, JN_IMMIX_BLOCK_SIZE);
            if (!blk->raw_mem) jn_contract_fail("oom", "jn_gc_alloc", "calloc 64KB block != NULL");
        } else {
            memset(blk->raw_mem, 0, JN_IMMIX_BLOCK_SIZE);
        }
        memset(blk->line_marks, 0, sizeof(blk->line_marks));
        blk->in_use = 1;
        blk->recycled = 0;
        blk->live_lines = 0;
        alloc_line = 0;
        blk->cursor_line = needed_lines;
        blk->limit_line = JN_IMMIX_LINES_PER_BLOCK;
    }

    JnImmixBlock* blk = &g_jn_immix_blocks[chosen_blk];
    for (uint16_t l = 0; l < needed_lines; l++) {
        if (blk->line_marks[alloc_line + l] == 0) {
            blk->line_marks[alloc_line + l] = 1;
            blk->live_lines++;
            g_jn_gc_live_lines++;
        }
    }

    uint8_t* line_addr = blk->raw_mem + ((size_t)alloc_line * JN_IMMIX_LINE_SIZE);
    memset(line_addr, 0, (size_t)needed_lines * JN_IMMIX_LINE_SIZE);
    JnGcHeader* hdr = (JnGcHeader*)line_addr;
    hdr->size_bytes = (uint32_t)sz;
    hdr->block_idx = (uint16_t)chosen_blk;
    hdr->start_line = alloc_line;
    hdr->span_lines = needed_lines;
    hdr->marked = 1;
    hdr->generation = 0;
    hdr->magic = JN_GC_HEADER_MAGIC;

    g_jn_gc_count += 1;
    return (void*)(hdr + 1);
}

static inline void jn_gc_begin_mark(void) {
    g_jn_gc_live_lines = 0;
    for (int32_t b = 0; b < g_jn_immix_block_count; b++) {
        JnImmixBlock* blk = &g_jn_immix_blocks[b];
        if (!blk->in_use) continue;
        memset(blk->line_marks, 0, sizeof(blk->line_marks));
        blk->live_lines = 0;
    }
}

static inline void jn_gc_mark_ptr(const void* ptr) {
    if (!ptr) return;
    const JnGcHeader* hdr = ((const JnGcHeader*)ptr) - 1;
    if (hdr->magic != JN_GC_HEADER_MAGIC || hdr->block_idx >= (uint16_t)g_jn_immix_block_count) {
        return;
    }
    JnImmixBlock* blk = &g_jn_immix_blocks[hdr->block_idx];
    if (!blk->in_use) return;
    for (uint16_t l = 0; l < hdr->span_lines; l++) {
        uint16_t idx = (uint16_t)(hdr->start_line + l);
        if (idx < JN_IMMIX_LINES_PER_BLOCK && blk->line_marks[idx] == 0) {
            blk->line_marks[idx] = 1;
            blk->live_lines++;
            g_jn_gc_live_lines++;
        }
    }
}

static inline int32_t jn_gc_sweep_epoch(void) {
    int32_t reclaimed_lines = 0;
    for (int32_t b = 0; b < g_jn_immix_block_count; b++) {
        JnImmixBlock* blk = &g_jn_immix_blocks[b];
        if (!blk->in_use) continue;
        reclaimed_lines += (int32_t)(JN_IMMIX_LINES_PER_BLOCK - blk->live_lines);
        if (blk->live_lines == 0) {
            blk->cursor_line = 0;
            blk->limit_line = JN_IMMIX_LINES_PER_BLOCK;
            blk->recycled = 1;
            g_jn_gc_recycled_blocks += 1;
        } else {
            uint16_t hs = 0, hl = 0;
            if (jn_immix_find_hole(blk, 0, 1, &hs, &hl)) {
                blk->cursor_line = hs;
                blk->limit_line = hl;
            } else {
                blk->cursor_line = JN_IMMIX_LINES_PER_BLOCK;
                blk->limit_line = JN_IMMIX_LINES_PER_BLOCK;
            }
            blk->recycled = 1;
        }
    }
    return reclaimed_lines;
}

static inline int32_t jn_active_gc_handles(void)   { return g_jn_gc_count; }
static inline int32_t jn_gc_active_blocks(void)    { return g_jn_immix_block_count; }
static inline int32_t jn_gc_live_lines(void)       { return g_jn_gc_live_lines; }
static inline int32_t jn_gc_recycled_blocks(void)  { return g_jn_gc_recycled_blocks; }

static inline void jn_gc_collect_all(void) {
    for (int32_t b = 0; b < g_jn_immix_block_count; b++) {
        if (g_jn_immix_blocks[b].raw_mem) {
            free(g_jn_immix_blocks[b].raw_mem);
            g_jn_immix_blocks[b].raw_mem = NULL;
        }
        memset(&g_jn_immix_blocks[b], 0, sizeof(JnImmixBlock));
    }
    g_jn_immix_block_count = 0;
    g_jn_gc_count = 0;
    g_jn_gc_live_lines = 0;
    g_jn_gc_recycled_blocks = 0;
}

static inline jn_str jn_str_slice(jn_str s, int64_t start, int64_t end) {
    if (start < 0 || end < start || (size_t)end > s.len) {
        jn_contract_fail("slice_bounds", "jn_str_slice", "0 <= start <= end <= s.len");
    }
    jn_str r = { s.ptr + start, (size_t)(end - start) };
    return r;
}

static inline jn_str jn_str_sub(jn_str s, int64_t rel_off, int64_t sub_len) {
    if (rel_off < 0 || sub_len < 0 || (size_t)(rel_off + sub_len) > s.len) {
        jn_contract_fail("slice_bounds", "jn_str_sub", "0 <= rel_off && 0 <= sub_len && rel_off + sub_len <= s.len");
    }
    jn_str r = { s.ptr + rel_off, (size_t)sub_len };
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
 * 5c. 24-Byte SSO Immutable Value String (`String` / `JnString`)
 *     - Mode 0 (SSO Inline, len <= 22): 100% stack-inline inside 24 bytes (0 heap alloc)
 *     - Mode 1 (Static .rodata literal): Zero-alloc pointer + length to .rodata
 *     - Mode 2 (Immix Shared Heap, len > 22): Shared immutable UTF-8 buffer on Immix block
 * ========================================================================= */
#define JN_SSO_MAX_LEN 22

typedef union JnString {
    struct {
        uint8_t mode_tag;       /* 0 = SSO inline (<=22 bytes) */
        uint8_t sso_len;        /* 0..22 */
        char    inline_bytes[JN_SSO_MAX_LEN];
    } sso;
    struct {
        uint8_t     mode_tag;   /* 1 = Static .rodata, 2 = Immix GC shared */
        uint8_t     _pad[7];
        size_t      len;
        const char* ptr;
    } ext;
} JnString;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(JnString) == 24, "JnString must be strictly 24 bytes (SSO 3x 64-bit registers)");
#else
typedef char jn_static_assert_string_24_bytes[(sizeof(JnString) == 24) ? 1 : -1];
#endif

static inline JnString JnString_from_str(jn_str s) {
    JnString out;
    memset(&out, 0, sizeof(JnString));
    if (s.len <= JN_SSO_MAX_LEN) {
        out.sso.mode_tag = 0;
        out.sso.sso_len = (uint8_t)s.len;
        if (s.len > 0 && s.ptr) {
            memcpy(out.sso.inline_bytes, s.ptr, s.len);
        }
    } else {
        char* gc_buf = (char*)jn_gc_alloc(s.len + 1);
        memcpy(gc_buf, s.ptr, s.len);
        gc_buf[s.len] = '\0';
        out.ext.mode_tag = 2;
        out.ext.len = s.len;
        out.ext.ptr = gc_buf;
    }
    return out;
}

static inline JnString JnString_from_static(jn_str s) {
    JnString out;
    memset(&out, 0, sizeof(JnString));
    out.ext.mode_tag = 1;
    out.ext.len = s.len;
    out.ext.ptr = s.ptr;
    return out;
}

static inline int64_t jn_string_len(JnString s) {
    return (s.sso.mode_tag == 0) ? (int64_t)s.sso.sso_len : (int64_t)s.ext.len;
}

static inline bool jn_string_is_sso(JnString s) {
    return s.sso.mode_tag == 0;
}

static inline jn_str jn_string_as_str(const JnString* s) {
    if (s->sso.mode_tag == 0) {
        return (jn_str){ .ptr = s->sso.inline_bytes, .len = (size_t)s->sso.sso_len };
    }
    return (jn_str){ .ptr = s->ext.ptr, .len = s->ext.len };
}

static inline jn_str jn_bool_to_str(bool b) {
    return b ? jn_mk_str("true") : jn_mk_str("false");
}

static inline int64_t jn_string_byte_at(JnString s, int64_t idx) {
    int64_t n = jn_string_len(s);
    if (idx < 0 || idx >= n) {
        jn_contract_fail("index_bounds", "jn_string_byte_at", "0 <= idx < s.len");
    }
    const char* p = (s.sso.mode_tag == 0) ? s.sso.inline_bytes : s.ext.ptr;
    return (int64_t)(uint8_t)p[idx];
}

static inline bool jn_string_eq_str(JnString s, jn_str target) {
    size_t n = (s.sso.mode_tag == 0) ? (size_t)s.sso.sso_len : s.ext.len;
    if (n != target.len) return false;
    if (n == 0) return true;
    const char* p = (s.sso.mode_tag == 0) ? s.sso.inline_bytes : s.ext.ptr;
    return memcmp(p, target.ptr, n) == 0;
}

/* =========================================================================
 * 5d. Zero-Parse Typed Formatting, Scratch Arena & RawBuf-to-String Primitives
 * ========================================================================= */
#define JN_SCRATCH_ARENA_WORDS 16384
static int64_t g_jn_scratch_arena_buf[JN_SCRATCH_ARENA_WORDS];
static int64_t g_jn_scratch_arena_used = 0;

static inline int64_t jn_scratch_arena_mark(void) {
    return g_jn_scratch_arena_used;
}

static inline int64_t jn_scratch_arena_alloc(int64_t cap) {
    if (cap <= 0) return 0;
    if (g_jn_scratch_arena_used + cap > JN_SCRATCH_ARENA_WORDS) {
        g_jn_scratch_arena_used = 0;
    }
    if (cap > JN_SCRATCH_ARENA_WORDS) {
        jn_contract_fail("scratch_arena_overflow", "jn_scratch_arena_alloc", "cap <= JN_SCRATCH_ARENA_WORDS");
    }
    int64_t* base = &g_jn_scratch_arena_buf[g_jn_scratch_arena_used];
    g_jn_scratch_arena_used += cap;
    return (int64_t)(intptr_t)base;
}

static inline int64_t jn_scratch_arena_release(int64_t mark) {
    if (mark >= 0 && mark <= g_jn_scratch_arena_used) {
        g_jn_scratch_arena_used = mark;
    }
    return 0;
}

static inline int64_t jn_raw_put_str(int64_t raw_ptr, int64_t write_off, jn_str s) {
    if (s.len == 0) return write_off;
    if (raw_ptr == 0 || write_off < 0) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_put_str", "raw_ptr != 0 && write_off >= 0");
    }
    int64_t* dst = (int64_t*)(intptr_t)raw_ptr;
    for (size_t i = 0; i < s.len; i++) {
        dst[write_off + (int64_t)i] = (int64_t)(uint8_t)s.ptr[i];
    }
    return write_off + (int64_t)s.len;
}

static inline int64_t jn_raw_put_string(int64_t raw_ptr, int64_t write_off, JnString s) {
    return jn_raw_put_str(raw_ptr, write_off, jn_string_as_str(&s));
}

static inline int64_t jn_raw_put_i64(int64_t raw_ptr, int64_t write_off, int64_t val) {
    if (raw_ptr == 0 || write_off < 0) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_put_i64", "raw_ptr != 0 && write_off >= 0");
    }
    int64_t* dst = (int64_t*)(intptr_t)raw_ptr;
    int64_t cur = write_off;
    uint64_t uval;
    if (val < 0) {
        dst[cur++] = (int64_t)'-';
        uval = (uint64_t)(-(val + 1)) + 1ULL;
    } else {
        uval = (uint64_t)val;
    }
    if (uval == 0) {
        dst[cur++] = (int64_t)'0';
        return cur;
    }
    uint8_t rev_digits[24];
    int d_cnt = 0;
    while (uval > 0) {
        rev_digits[d_cnt++] = (uint8_t)('0' + (uval % 10ULL));
        uval /= 10ULL;
    }
    for (int i = d_cnt - 1; i >= 0; i--) {
        dst[cur++] = (int64_t)rev_digits[i];
    }
    return cur;
}

static inline int64_t jn_raw_put_hex_u32(int64_t raw_ptr, int64_t write_off, int64_t val, int64_t digits) {
    if (raw_ptr == 0 || write_off < 0 || digits < 1 || digits > 8) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_put_hex_u32", "raw_ptr != 0 && write_off >= 0 && digits in 1..8");
    }
    static const char hex_lut[16] = "0123456789abcdef";
    int64_t* dst = (int64_t*)(intptr_t)raw_ptr;
    uint32_t u = (uint32_t)val;
    for (int64_t i = 0; i < digits; i++) {
        uint32_t shift = (uint32_t)((digits - 1 - i) * 4);
        uint32_t nib = (u >> shift) & 0xFu;
        dst[write_off + i] = (int64_t)(uint8_t)hex_lut[nib];
    }
    return write_off + digits;
}

static inline int64_t jn_raw_put_hex_upper_u32(int64_t raw_ptr, int64_t write_off, int64_t val, int64_t digits) {
    if (raw_ptr == 0 || write_off < 0 || digits < 1 || digits > 8) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_put_hex_upper_u32", "raw_ptr != 0 && write_off >= 0 && digits in 1..8");
    }
    static const char hex_lut[16] = "0123456789ABCDEF";
    int64_t* dst = (int64_t*)(intptr_t)raw_ptr;
    uint32_t u = (uint32_t)val;
    for (int64_t i = 0; i < digits; i++) {
        uint32_t shift = (uint32_t)((digits - 1 - i) * 4);
        uint32_t nib = (u >> shift) & 0xFu;
        dst[write_off + i] = (int64_t)(uint8_t)hex_lut[nib];
    }
    return write_off + digits;
}

static inline int64_t jn_raw_put_pad_zero(int64_t raw_ptr, int64_t write_off, int64_t val, int64_t width) {
    if (raw_ptr == 0 || write_off < 0 || width < 1 || width > 20) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_put_pad_zero", "raw_ptr != 0 && write_off >= 0 && width in 1..20");
    }
    int64_t* dst = (int64_t*)(intptr_t)raw_ptr;
    int64_t cur = write_off;
    uint64_t uval;
    int sign_len = 0;
    if (val < 0) {
        dst[cur++] = (int64_t)'-';
        uval = (uint64_t)(-(val + 1)) + 1ULL;
        sign_len = 1;
    } else {
        uval = (uint64_t)val;
    }
    uint8_t rev_digits[24];
    int d_cnt = 0;
    if (uval == 0) {
        rev_digits[d_cnt++] = (uint8_t)'0';
    } else {
        while (uval > 0) {
            rev_digits[d_cnt++] = (uint8_t)('0' + (uval % 10ULL));
            uval /= 10ULL;
        }
    }
    int pad = (int)width - sign_len - d_cnt;
    while (pad > 0) {
        dst[cur++] = (int64_t)'0';
        pad--;
    }
    for (int i = d_cnt - 1; i >= 0; i--) {
        dst[cur++] = (int64_t)rev_digits[i];
    }
    return cur;
}

static inline int64_t jn_raw_put_bin_u32(int64_t raw_ptr, int64_t write_off, int64_t val, int64_t bits) {
    if (raw_ptr == 0 || write_off < 0 || bits < 1 || bits > 32) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_put_bin_u32", "raw_ptr != 0 && write_off >= 0 && bits in 1..32");
    }
    int64_t* dst = (int64_t*)(intptr_t)raw_ptr;
    uint32_t u = (uint32_t)val;
    for (int64_t i = 0; i < bits; i++) {
        uint32_t shift = (uint32_t)(bits - 1 - i);
        uint32_t bit = (u >> shift) & 1u;
        dst[write_off + i] = (int64_t)(bit ? '1' : '0');
    }
    return write_off + bits;
}

static inline int64_t jn_raw_put_grouped_i64(int64_t raw_ptr, int64_t write_off, int64_t val, int64_t sep_byte) {
    if (raw_ptr == 0 || write_off < 0) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_put_grouped_i64", "raw_ptr != 0 && write_off >= 0");
    }
    if (sep_byte <= 0) {
        return jn_raw_put_i64(raw_ptr, write_off, val);
    }
    int64_t* dst = (int64_t*)(intptr_t)raw_ptr;
    int64_t cur = write_off;
    uint64_t uval;
    if (val < 0) {
        dst[cur++] = (int64_t)'-';
        uval = (uint64_t)(-(val + 1)) + 1ULL;
    } else {
        uval = (uint64_t)val;
    }
    if (uval == 0) {
        dst[cur++] = (int64_t)'0';
        return cur;
    }
    uint8_t rev_digits[24];
    int d_cnt = 0;
    while (uval > 0) {
        rev_digits[d_cnt++] = (uint8_t)('0' + (uval % 10ULL));
        uval /= 10ULL;
    }
    for (int i = d_cnt - 1; i >= 0; i--) {
        dst[cur++] = (int64_t)rev_digits[i];
        if (i > 0 && (i % 3) == 0) {
            dst[cur++] = (int64_t)(uint8_t)sep_byte;
        }
    }
    return cur;
}

static inline int64_t jn_raw_put_bool(int64_t raw_ptr, int64_t write_off, bool flag) {
    return jn_raw_put_str(raw_ptr, write_off, flag ? jn_mk_str("true") : jn_mk_str("false"));
}

static inline bool jn_raw_eq_str(int64_t raw_ptr, int64_t len, jn_str target) {
    if (len < 0 || (size_t)len != target.len) return false;
    if (len == 0) return true;
    if (raw_ptr == 0) return false;
    const int64_t* src = (const int64_t*)(intptr_t)raw_ptr;
    for (size_t i = 0; i < target.len; i++) {
        if ((uint8_t)src[i] != (uint8_t)target.ptr[i]) return false;
    }
    return true;
}

static inline JnString jn_raw_to_sso_string(int64_t raw_ptr, int64_t start_off, int64_t sub_len) {
    JnString out;
    memset(&out, 0, sizeof(JnString));
    if (sub_len <= 0) {
        out.sso.mode_tag = 0;
        out.sso.sso_len = 0;
        return out;
    }
    if (raw_ptr == 0 || start_off < 0) {
        jn_contract_fail("raw_buf_bounds", "jn_raw_to_sso_string", "raw_ptr != 0 && start_off >= 0");
    }
    const int64_t* src = ((const int64_t*)(intptr_t)raw_ptr) + start_off;
    if (sub_len <= JN_SSO_MAX_LEN) {
        out.sso.mode_tag = 0;
        out.sso.sso_len = (uint8_t)sub_len;
        for (int64_t i = 0; i < sub_len; i++) {
            out.sso.inline_bytes[i] = (char)(uint8_t)src[i];
        }
    } else {
        char* gc_buf = (char*)jn_gc_alloc((size_t)sub_len + 1u);
        for (int64_t i = 0; i < sub_len; i++) {
            gc_buf[i] = (char)(uint8_t)src[i];
        }
        gc_buf[sub_len] = '\0';
        out.ext.mode_tag = 2;
        out.ext.len = (size_t)sub_len;
        out.ext.ptr = gc_buf;
    }
    return out;
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

#include "../../library/std/ffi/c_frame_abi.h"

#define jenny_c_sizeof_frame(hdr) ((int64_t)sizeof(hdr))
#define jenny_c_sizeof_union(u)   ((int64_t)sizeof(u))
#define jenny_c_frame_word0(hdr)  jenny_c_abi_frame_word0(&(hdr), sizeof(hdr))


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

typedef struct JnFn_i64_i64_to_i64 {
    const void* env;
    int64_t (*call)(const void* env, int64_t a, int64_t b);
} JnFn_i64_i64_to_i64;

typedef struct JnFn_i64_to_bool {
    const void* env;
    bool (*call)(const void* env, int64_t arg);
} JnFn_i64_to_bool;

typedef struct JnFn_void_to_i64 {
    const void* env;
    int64_t (*call)(const void* env);
} JnFn_void_to_i64;

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

#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#define abs jn_usr_abs

#endif /* JENNY_RT_H */

