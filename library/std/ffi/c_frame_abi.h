#ifndef JENNY_C_FRAME_ABI_H
#define JENNY_C_FRAME_ABI_H

#include <stdint.h>
#include <stddef.h>

/* =========================================================================
 * External C Library Reference Header (`c_frame_abi.h`)
 * Distilled into White-Box Jenny Blueprint `std/ffi/c_abi.jni` via `spindle bindgen-c`
 * ========================================================================= */

/* 8-byte C ABI Frame Header with 5 bitfields packed into the first 32-bit word */
typedef struct CFrameHeader_C {
    uint32_t version   : 4;  /* bits 0..3:   protocol version (0..15) */
    uint32_t ihl       : 4;  /* bits 4..7:   header length in 32-bit words (5..15) */
    uint32_t dscp      : 6;  /* bits 8..13:  diffserv code point (0..63) */
    uint32_t ecn       : 2;  /* bits 14..15: explicit congestion notification (0..3) */
    uint32_t total_len : 16; /* bits 16..31: total packet bytes (20..65535) */
    uint32_t seq_id;         /* bytes 4..7:  32-bit sequence identifier */
} CFrameHeader_C;

/* 4-byte C ABI Bitfield Pair for 16-bit half-word access */
typedef struct CHalfWords_C {
    uint32_t low16  : 16;
    uint32_t high16 : 16;
} CHalfWords_C;

/* 4-byte C ABI Untagged Union overlaying u32, i32, and two 16-bit bitfield halves */
typedef union CWord32Union_C {
    uint32_t     raw_u32;
    CHalfWords_C halves;
    int32_t      signed_i32;
} CWord32Union_C;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(CFrameHeader_C) == 8, "CFrameHeader_C must be 8 bytes");
_Static_assert(sizeof(CHalfWords_C) == 4, "CHalfWords_C must be 4 bytes");
_Static_assert(sizeof(CWord32Union_C) == 4, "CWord32Union_C must be 4 bytes");
#endif

/* Read first 32-bit packed bitfield word directly from CFrameHeader memory */
static inline int64_t jenny_c_abi_frame_word0(const void* hdr_ptr, size_t hdr_size) {
    if (!hdr_ptr || hdr_size != sizeof(CFrameHeader_C)) return -1;
    uint32_t word0 = 0;
    const uint8_t* b = (const uint8_t*)hdr_ptr;
    word0 = (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
    return (int64_t)word0;
}

/* 32-bit network byte-order swap (endianness conversion) */
static inline int64_t jenny_c_abi_bswap32(int64_t word) {
    uint32_t u = (uint32_t)(word & 0xFFFFFFFFULL);
    uint32_t swapped = ((u & 0x000000FFU) << 24) |
                       ((u & 0x0000FF00U) << 8)  |
                       ((u & 0x00FF0000U) >> 8)  |
                       ((u & 0xFF000000U) >> 24);
    return (int64_t)swapped;
}

/* Adler-32 checksum over a raw 64-bit word buffer allocated via RawBuf */
static inline int64_t jenny_c_abi_adler32_words(int64_t raw_ptr, int64_t count) {
    if (raw_ptr <= 0 || count < 0) return 0;
    const int64_t* buf = (const int64_t*)(intptr_t)raw_ptr;
    uint32_t a = 1;
    uint32_t b = 0;
    for (int64_t i = 0; i < count; i++) {
        uint32_t byte_val = (uint32_t)(buf[i] & 0xFF);
        a = (a + byte_val) % 65521U;
        b = (b + a) % 65521U;
    }
    return (int64_t)((b << 16) | a);
}

/* Zero-Glue C FFI CRC-32 / Byte-Accumulator & Prefix Comparison Primitives */
static inline int64_t jenny_c_crc32(const uint8_t* ptr, int64_t len, int64_t seed) {
    if (!ptr || len < 0) return 0;
    int64_t acc = seed;
    for (int64_t i = 0; i < len; i++) {
        acc += (int64_t)ptr[i];
    }
    return acc;
}

static inline int64_t jenny_c_memcmp_prefix(const uint8_t* a, const uint8_t* b, int64_t n) {
    if (!a || !b || n < 0) return -1;
    for (int64_t i = 0; i < n; i++) {
        if (a[i] != b[i]) return (int64_t)a[i] - (int64_t)b[i];
    }
    return 0;
}

#endif /* JENNY_C_FRAME_ABI_H */
