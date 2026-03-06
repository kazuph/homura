/**
 * Homura mruby Entry Point
 *
 * This provides the C API for JavaScript to interact with mruby.
 * Exported functions:
 * - homura_init(): Initialize mruby VM
 * - homura_eval(): Evaluate Ruby code from input buffer (string)
 * - homura_handle_request(len): Handle MessagePack request -> MessagePack response
 * - homura_close(): Close mruby VM
 */

#include <mruby.h>
#include <mruby/compile.h>
#include <mruby/string.h>
#include <mruby/hash.h>
#include <mruby/array.h>
#include <mruby/variable.h>
#include <mruby/error.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Global mruby state
static mrb_state *mrb = NULL;

// Buffers for input/output
#define HOMURA_BUFFER_SIZE 131072
static uint8_t input_buffer[HOMURA_BUFFER_SIZE];
static uint8_t output_buffer[HOMURA_BUFFER_SIZE];
static int output_length = 0;

// Export marker for wasm
#define WASM_EXPORT __attribute__((visibility("default")))

// MessagePack reader/writer
typedef struct {
    const uint8_t *data;
    size_t len;
    size_t pos;
    int error;
} mp_reader;

typedef struct {
    uint8_t *data;
    size_t len;
    size_t pos;
    int error;
} mp_writer;

static uint8_t mp_read_byte(mp_reader *r) {
    if (r->pos >= r->len) {
        r->error = 1;
        return 0;
    }
    return r->data[r->pos++];
}

static void mp_read_bytes(mp_reader *r, uint8_t *out, size_t n) {
    if (r->pos + n > r->len) {
        r->error = 1;
        return;
    }
    memcpy(out, r->data + r->pos, n);
    r->pos += n;
}

static uint16_t mp_read_u16(mp_reader *r) {
    uint8_t buf[2];
    mp_read_bytes(r, buf, 2);
    return (uint16_t)((buf[0] << 8) | buf[1]);
}

static uint32_t mp_read_u32(mp_reader *r) {
    uint8_t buf[4];
    mp_read_bytes(r, buf, 4);
    return ((uint32_t)buf[0] << 24) | ((uint32_t)buf[1] << 16) | ((uint32_t)buf[2] << 8) | (uint32_t)buf[3];
}

static uint64_t mp_read_u64(mp_reader *r) {
    uint8_t buf[8];
    mp_read_bytes(r, buf, 8);
    return ((uint64_t)buf[0] << 56) | ((uint64_t)buf[1] << 48) | ((uint64_t)buf[2] << 40) | ((uint64_t)buf[3] << 32) |
           ((uint64_t)buf[4] << 24) | ((uint64_t)buf[5] << 16) | ((uint64_t)buf[6] << 8) | (uint64_t)buf[7];
}

static int mp_write_byte(mp_writer *w, uint8_t b) {
    if (w->pos + 1 > w->len) {
        w->error = 1;
        return 0;
    }
    w->data[w->pos++] = b;
    return 1;
}

static int mp_write_bytes(mp_writer *w, const uint8_t *src, size_t n) {
    if (w->pos + n > w->len) {
        w->error = 1;
        return 0;
    }
    memcpy(w->data + w->pos, src, n);
    w->pos += n;
    return 1;
}

static int mp_write_u16(mp_writer *w, uint16_t v) {
    uint8_t buf[2] = { (uint8_t)(v >> 8), (uint8_t)(v & 0xff) };
    return mp_write_bytes(w, buf, 2);
}

static int mp_write_u32(mp_writer *w, uint32_t v) {
    uint8_t buf[4] = { (uint8_t)(v >> 24), (uint8_t)(v >> 16), (uint8_t)(v >> 8), (uint8_t)(v & 0xff) };
    return mp_write_bytes(w, buf, 4);
}

static int mp_write_u64(mp_writer *w, uint64_t v) {
    uint8_t buf[8] = {
        (uint8_t)(v >> 56), (uint8_t)(v >> 48), (uint8_t)(v >> 40), (uint8_t)(v >> 32),
        (uint8_t)(v >> 24), (uint8_t)(v >> 16), (uint8_t)(v >> 8), (uint8_t)(v & 0xff)
    };
    return mp_write_bytes(w, buf, 8);
}

static int mp_encode_map_header(mp_writer *w, uint32_t count) {
    if (count <= 15) {
        return mp_write_byte(w, 0x80 | (uint8_t)count);
    }
    if (count <= 0xffff) {
        return mp_write_byte(w, 0xde) && mp_write_u16(w, (uint16_t)count);
    }
    return mp_write_byte(w, 0xdf) && mp_write_u32(w, count);
}

static int mp_encode_array_header(mp_writer *w, uint32_t count) {
    if (count <= 15) {
        return mp_write_byte(w, 0x90 | (uint8_t)count);
    }
    if (count <= 0xffff) {
        return mp_write_byte(w, 0xdc) && mp_write_u16(w, (uint16_t)count);
    }
    return mp_write_byte(w, 0xdd) && mp_write_u32(w, count);
}

static int mp_encode_str(mp_writer *w, const char *str, size_t len) {
    if (len <= 31) {
        if (!mp_write_byte(w, 0xa0 | (uint8_t)len)) return 0;
    } else if (len <= 0xff) {
        if (!mp_write_byte(w, 0xd9) || !mp_write_byte(w, (uint8_t)len)) return 0;
    } else if (len <= 0xffff) {
        if (!mp_write_byte(w, 0xda) || !mp_write_u16(w, (uint16_t)len)) return 0;
    } else {
        if (!mp_write_byte(w, 0xdb) || !mp_write_u32(w, (uint32_t)len)) return 0;
    }
    return mp_write_bytes(w, (const uint8_t *)str, len);
}

static int mp_encode_int(mp_writer *w, int64_t val) {
    if (val >= 0) {
        if (val <= 0x7f) {
            return mp_write_byte(w, (uint8_t)val);
        }
        if (val <= 0xff) {
            return mp_write_byte(w, 0xcc) && mp_write_byte(w, (uint8_t)val);
        }
        if (val <= 0xffff) {
            return mp_write_byte(w, 0xcd) && mp_write_u16(w, (uint16_t)val);
        }
        if (val <= 0xffffffff) {
            return mp_write_byte(w, 0xce) && mp_write_u32(w, (uint32_t)val);
        }
        return mp_write_byte(w, 0xcf) && mp_write_u64(w, (uint64_t)val);
    }

    if (val >= -32) {
        return mp_write_byte(w, (uint8_t)val);
    }
    if (val >= -128) {
        return mp_write_byte(w, 0xd0) && mp_write_byte(w, (uint8_t)val);
    }
    if (val >= -32768) {
        return mp_write_byte(w, 0xd1) && mp_write_u16(w, (uint16_t)val);
    }
    if (val >= INT32_MIN) {
        return mp_write_byte(w, 0xd2) && mp_write_u32(w, (uint32_t)val);
    }
    return mp_write_byte(w, 0xd3) && mp_write_u64(w, (uint64_t)val);
}

static int mp_encode_value(mrb_state *mrb, mp_writer *w, mrb_value value) {
    int ai = mrb_gc_arena_save(mrb);
    mrb_gc_protect(mrb, value);

    if (mrb_nil_p(value)) {
        int ok = mp_write_byte(w, 0xc0);
        mrb_gc_arena_restore(mrb, ai);
        return ok;
    }
    if (mrb_true_p(value)) {
        int ok = mp_write_byte(w, 0xc3);
        mrb_gc_arena_restore(mrb, ai);
        return ok;
    }
    if (mrb_false_p(value)) {
        int ok = mp_write_byte(w, 0xc2);
        mrb_gc_arena_restore(mrb, ai);
        return ok;
    }
    if (mrb_integer_p(value)) {
        int ok = mp_encode_int(w, (int64_t)mrb_integer(value));
        mrb_gc_arena_restore(mrb, ai);
        return ok;
    }
    if (mrb_float_p(value)) {
        double f = mrb_float(value);
        union {
            double f;
            uint64_t u;
        } conv;
        conv.f = f;
        if (!mp_write_byte(w, 0xcb)) {
            mrb_gc_arena_restore(mrb, ai);
            return 0;
        }
        int ok = mp_write_u64(w, conv.u);
        mrb_gc_arena_restore(mrb, ai);
        return ok;
    }
    if (mrb_string_p(value)) {
        int ok = mp_encode_str(w, RSTRING_PTR(value), RSTRING_LEN(value));
        mrb_gc_arena_restore(mrb, ai);
        return ok;
    }
    if (mrb_symbol_p(value)) {
        mrb_int len = 0;
        const char *name = mrb_sym_name_len(mrb, mrb_symbol(value), &len);
        int ok = mp_encode_str(w, name, (size_t)len);
        mrb_gc_arena_restore(mrb, ai);
        return ok;
    }
    if (mrb_hash_p(value)) {
        mrb_value keys = mrb_hash_keys(mrb, value);
        mrb_gc_protect(mrb, keys);
        mrb_int len = RARRAY_LEN(keys);
        if (!mp_encode_map_header(w, (uint32_t)len)) {
            mrb_gc_arena_restore(mrb, ai);
            return 0;
        }
        for (mrb_int i = 0; i < len; i++) {
            mrb_value key = mrb_ary_ref(mrb, keys, i);
            mrb_value val = mrb_hash_get(mrb, value, key);
            mrb_gc_protect(mrb, key);
            mrb_gc_protect(mrb, val);
            if (mrb_symbol_p(key)) {
                mrb_int klen = 0;
                const char *kname = mrb_sym_name_len(mrb, mrb_symbol(key), &klen);
                if (!mp_encode_str(w, kname, (size_t)klen)) {
                    mrb_gc_arena_restore(mrb, ai);
                    return 0;
                }
            } else if (mrb_string_p(key)) {
                if (!mp_encode_str(w, RSTRING_PTR(key), RSTRING_LEN(key))) {
                    mrb_gc_arena_restore(mrb, ai);
                    return 0;
                }
            } else {
                mrb_value kstr = mrb_any_to_s(mrb, key);
                mrb_gc_protect(mrb, kstr);
                if (!mp_encode_str(w, RSTRING_PTR(kstr), RSTRING_LEN(kstr))) {
                    mrb_gc_arena_restore(mrb, ai);
                    return 0;
                }
            }
            if (!mp_encode_value(mrb, w, val)) {
                mrb_gc_arena_restore(mrb, ai);
                return 0;
            }
        }
        mrb_gc_arena_restore(mrb, ai);
        return 1;
    }
    if (mrb_array_p(value)) {
        mrb_int len = RARRAY_LEN(value);
        if (!mp_encode_array_header(w, (uint32_t)len)) {
            mrb_gc_arena_restore(mrb, ai);
            return 0;
        }
        for (mrb_int i = 0; i < len; i++) {
            mrb_value elem = mrb_ary_ref(mrb, value, i);
            mrb_gc_protect(mrb, elem);
            if (!mp_encode_value(mrb, w, elem)) {
                mrb_gc_arena_restore(mrb, ai);
                return 0;
            }
        }
        mrb_gc_arena_restore(mrb, ai);
        return 1;
    }

    mrb_value str = mrb_any_to_s(mrb, value);
    mrb_gc_protect(mrb, str);
    int ok = mp_encode_str(w, RSTRING_PTR(str), RSTRING_LEN(str));
    mrb_gc_arena_restore(mrb, ai);
    return ok;
}

static mrb_value mp_decode_value(mrb_state *mrb, mp_reader *r);

static mrb_value mp_decode_map(mrb_state *mrb, mp_reader *r, uint32_t count, bool symbol_keys) {
    int ai = mrb_gc_arena_save(mrb);
    mrb_value hash = mrb_hash_new(mrb);
    mrb_gc_protect(mrb, hash);
    for (uint32_t i = 0; i < count; i++) {
        mrb_value key = mp_decode_value(mrb, r);
        if (r->error) {
            mrb_gc_arena_restore(mrb, ai);
            return mrb_nil_value();
        }
        mrb_gc_protect(mrb, key);
        if (!mrb_string_p(key)) {
            key = mrb_any_to_s(mrb, key);
            mrb_gc_protect(mrb, key);
        }
        mrb_value map_key = key;
        if (symbol_keys) {
            mrb_sym sym = mrb_intern(mrb, RSTRING_PTR(key), RSTRING_LEN(key));
            map_key = mrb_symbol_value(sym);
        }
        mrb_value val = mp_decode_value(mrb, r);
        if (r->error) {
            mrb_gc_arena_restore(mrb, ai);
            return mrb_nil_value();
        }
        mrb_gc_protect(mrb, val);
        mrb_hash_set(mrb, hash, map_key, val);
    }
    mrb_gc_arena_restore(mrb, ai);
    return hash;
}

static mrb_value mp_decode_array(mrb_state *mrb, mp_reader *r, uint32_t count) {
    int ai = mrb_gc_arena_save(mrb);
    mrb_value ary = mrb_ary_new_capa(mrb, count);
    mrb_gc_protect(mrb, ary);
    for (uint32_t i = 0; i < count; i++) {
        mrb_value val = mp_decode_value(mrb, r);
        if (r->error) {
            mrb_gc_arena_restore(mrb, ai);
            return mrb_nil_value();
        }
        mrb_gc_protect(mrb, val);
        mrb_ary_push(mrb, ary, val);
    }
    mrb_gc_arena_restore(mrb, ai);
    return ary;
}

static mrb_value mp_decode_value(mrb_state *mrb, mp_reader *r) {
    uint8_t b = mp_read_byte(r);
    if (r->error) return mrb_nil_value();

    if (b <= 0x7f) {
        return mrb_fixnum_value((mrb_int)b);
    }
    if (b >= 0xe0) {
        return mrb_fixnum_value((mrb_int)(int8_t)b);
    }
    if ((b & 0xf0) == 0x80) {
        return mp_decode_map(mrb, r, (uint32_t)(b & 0x0f), false);
    }
    if ((b & 0xf0) == 0x90) {
        return mp_decode_array(mrb, r, (uint32_t)(b & 0x0f));
    }
    if ((b & 0xe0) == 0xa0) {
        uint32_t len = (uint32_t)(b & 0x1f);
        if (r->pos + len > r->len) {
            r->error = 1;
            return mrb_nil_value();
        }
        mrb_value str = mrb_str_new(mrb, (const char *)(r->data + r->pos), len);
        r->pos += len;
        return str;
    }

    switch (b) {
        case 0xc0: return mrb_nil_value();
        case 0xc2: return mrb_false_value();
        case 0xc3: return mrb_true_value();
        case 0xcc: return mrb_fixnum_value((mrb_int)mp_read_byte(r));
        case 0xcd: return mrb_fixnum_value((mrb_int)mp_read_u16(r));
        case 0xce: return mrb_fixnum_value((mrb_int)mp_read_u32(r));
        case 0xcf: return mrb_fixnum_value((mrb_int)mp_read_u64(r));
        case 0xd0: return mrb_fixnum_value((mrb_int)(int8_t)mp_read_byte(r));
        case 0xd1: return mrb_fixnum_value((mrb_int)(int16_t)mp_read_u16(r));
        case 0xd2: return mrb_fixnum_value((mrb_int)(int32_t)mp_read_u32(r));
        case 0xd3: return mrb_fixnum_value((mrb_int)(int64_t)mp_read_u64(r));
        case 0xd9: {
            uint32_t len = mp_read_byte(r);
            if (r->pos + len > r->len) { r->error = 1; return mrb_nil_value(); }
            mrb_value str = mrb_str_new(mrb, (const char *)(r->data + r->pos), len);
            r->pos += len;
            return str;
        }
        case 0xda: {
            uint32_t len = mp_read_u16(r);
            if (r->pos + len > r->len) { r->error = 1; return mrb_nil_value(); }
            mrb_value str = mrb_str_new(mrb, (const char *)(r->data + r->pos), len);
            r->pos += len;
            return str;
        }
        case 0xdb: {
            uint32_t len = mp_read_u32(r);
            if (r->pos + len > r->len) { r->error = 1; return mrb_nil_value(); }
            mrb_value str = mrb_str_new(mrb, (const char *)(r->data + r->pos), len);
            r->pos += len;
            return str;
        }
        case 0xc4: {
            uint32_t len = mp_read_byte(r);
            if (r->pos + len > r->len) { r->error = 1; return mrb_nil_value(); }
            mrb_value str = mrb_str_new(mrb, (const char *)(r->data + r->pos), len);
            r->pos += len;
            return str;
        }
        case 0xc5: {
            uint32_t len = mp_read_u16(r);
            if (r->pos + len > r->len) { r->error = 1; return mrb_nil_value(); }
            mrb_value str = mrb_str_new(mrb, (const char *)(r->data + r->pos), len);
            r->pos += len;
            return str;
        }
        case 0xc6: {
            uint32_t len = mp_read_u32(r);
            if (r->pos + len > r->len) { r->error = 1; return mrb_nil_value(); }
            mrb_value str = mrb_str_new(mrb, (const char *)(r->data + r->pos), len);
            r->pos += len;
            return str;
        }
        case 0xdc: return mp_decode_array(mrb, r, mp_read_u16(r));
        case 0xdd: return mp_decode_array(mrb, r, mp_read_u32(r));
        case 0xde: return mp_decode_map(mrb, r, mp_read_u16(r), false);
        case 0xdf: return mp_decode_map(mrb, r, mp_read_u32(r), false);
        case 0xcb: {
            uint64_t bits = mp_read_u64(r);
            union {
                uint64_t u;
                double f;
            } conv;
            conv.u = bits;
            return mrb_float_value(mrb, conv.f);
        }
        default:
            r->error = 1;
            return mrb_nil_value();
    }
}

static mrb_value mp_decode_env(mrb_state *mrb, mp_reader *r) {
    uint8_t b = mp_read_byte(r);
    if (r->error) return mrb_nil_value();

    uint32_t count = 0;
    if ((b & 0xf0) == 0x80) {
        count = (uint32_t)(b & 0x0f);
    } else if (b == 0xde) {
        count = mp_read_u16(r);
    } else if (b == 0xdf) {
        count = mp_read_u32(r);
    } else {
        r->error = 1;
        return mrb_nil_value();
    }

    return mp_decode_map(mrb, r, count, true);
}

static void homura_write_error_response(const char *message) {
    mp_writer w = { output_buffer, HOMURA_BUFFER_SIZE, 0, 0 };
    mp_encode_map_header(&w, 3);
    mp_encode_str(&w, "status", 6);
    mp_encode_int(&w, 500);
    mp_encode_str(&w, "headers", 7);
    mp_encode_map_header(&w, 1);
    mp_encode_str(&w, "Content-Type", 12);
    mp_encode_str(&w, "text/plain", 10);
    mp_encode_str(&w, "body", 4);
    mp_encode_str(&w, message, strlen(message));
    output_length = w.error ? 0 : (int)w.pos;
}

/**
 * Initialize the mruby VM
 * Returns 1 on success, 0 on failure
 */
WASM_EXPORT
int homura_init(void) {
    if (mrb != NULL) {
        return 1; // Already initialized
    }

    mrb = mrb_open();
    if (mrb == NULL) {
        return 0;
    }

    return 1;
}

/**
 * Get pointer to result buffer for reading results (string)
 */
WASM_EXPORT
const char* homura_get_result(void) {
    return (const char*)output_buffer;
}

/**
 * Get pointer to input buffer for writing request/code
 */
WASM_EXPORT
char* homura_get_input_buffer(void) {
    return (char*)input_buffer;
}

/**
 * Get the size of the input buffer
 */
WASM_EXPORT
int homura_get_buffer_size(void) {
    return HOMURA_BUFFER_SIZE;
}

/**
 * Get pointer to output buffer for MessagePack response
 */
WASM_EXPORT
const char* homura_get_output_buffer(void) {
    return (const char*)output_buffer;
}

/**
 * Get length of output buffer
 */
WASM_EXPORT
int homura_get_output_length(void) {
    return output_length;
}

typedef struct {
    mrb_value app;
    mrb_value env;
} HomuraRequestData;

static HomuraRequestData g_request_data;

static mrb_value homura_call_with_rescue_body(mrb_state *state, mrb_value _unused) {
    (void)_unused;
    return mrb_funcall(state, g_request_data.app, "call_with_rescue", 1, g_request_data.env);
}

static mrb_value homura_eval_body(mrb_state *state, mrb_value _unused) {
    (void)_unused;
    return mrb_load_string(state, (const char*)input_buffer);
}

/**
 * Convert mrb_value to JSON string representation
 */
static void value_to_json(mrb_state *mrb, mrb_value value, char *buf, size_t bufsize) {
    switch (mrb_type(value)) {
        case MRB_TT_FALSE:
            if (mrb_nil_p(value)) {
                snprintf(buf, bufsize, "null");
            } else {
                snprintf(buf, bufsize, "false");
            }
            break;
        case MRB_TT_TRUE:
            snprintf(buf, bufsize, "true");
            break;
        case MRB_TT_INTEGER:
            snprintf(buf, bufsize, "%lld", (long long)mrb_integer(value));
            break;
        case MRB_TT_FLOAT:
            snprintf(buf, bufsize, "%g", mrb_float(value));
            break;
        case MRB_TT_STRING:
            {
                const char *str = RSTRING_PTR(value);
                size_t len = RSTRING_LEN(value);
                char *p = buf;
                *p++ = '"';
                for (size_t i = 0; i < len && (size_t)(p - buf) < bufsize - 3; i++) {
                    unsigned char c = (unsigned char)str[i];
                    if ((size_t)(p - buf) >= bufsize - 6) break;
                    switch (c) {
                        case '"':
                            *p++ = '\\';
                            *p++ = '"';
                            break;
                        case '\\':
                            *p++ = '\\';
                            *p++ = '\\';
                            break;
                        case '\n':
                            *p++ = '\\';
                            *p++ = 'n';
                            break;
                        case '\r':
                            *p++ = '\\';
                            *p++ = 'r';
                            break;
                        case '\t':
                            *p++ = '\\';
                            *p++ = 't';
                            break;
                        case '\b':
                            *p++ = '\\';
                            *p++ = 'b';
                            break;
                        case '\f':
                            *p++ = '\\';
                            *p++ = 'f';
                            break;
                        default:
                            if (c < 0x20) {
                                p += snprintf(p, bufsize - (p - buf), "\\u%04x", c);
                            } else {
                                *p++ = (char)c;
                            }
                            break;
                    }
                }
                *p++ = '"';
                *p = '\0';
            }
            break;
        case MRB_TT_SYMBOL:
            {
                mrb_int len;
                const char *name = mrb_sym_name_len(mrb, mrb_symbol(value), &len);
                snprintf(buf, bufsize, "\"%.*s\"", (int)len, name);
            }
            break;
        case MRB_TT_HASH:
            {
                mrb_value keys = mrb_hash_keys(mrb, value);
                mrb_int len = RARRAY_LEN(keys);
                char *p = buf;
                *p++ = '{';
                for (mrb_int i = 0; i < len && (size_t)(p - buf) < bufsize - 100; i++) {
                    if (i > 0) *p++ = ',';
                    mrb_value key = mrb_ary_ref(mrb, keys, i);
                    mrb_value val = mrb_hash_get(mrb, value, key);
                    char keybuf[256], valbuf[1024];
                    value_to_json(mrb, key, keybuf, sizeof(keybuf));
                    value_to_json(mrb, val, valbuf, sizeof(valbuf));
                    if (keybuf[0] != '"') {
                        p += snprintf(p, bufsize - (p - buf), "\"%s\":%s", keybuf, valbuf);
                    } else {
                        p += snprintf(p, bufsize - (p - buf), "%s:%s", keybuf, valbuf);
                    }
                }
                *p++ = '}';
                *p = '\0';
            }
            break;
        case MRB_TT_ARRAY:
            {
                mrb_int len = RARRAY_LEN(value);
                char *p = buf;
                *p++ = '[';
                for (mrb_int i = 0; i < len && (size_t)(p - buf) < bufsize - 100; i++) {
                    if (i > 0) *p++ = ',';
                    mrb_value elem = mrb_ary_ref(mrb, value, i);
                    char elembuf[1024];
                    value_to_json(mrb, elem, elembuf, sizeof(elembuf));
                    p += snprintf(p, bufsize - (p - buf), "%s", elembuf);
                }
                *p++ = ']';
                *p = '\0';
            }
            break;
        default:
            {
                mrb_value str = mrb_funcall(mrb, value, "to_s", 0);
                if (mrb_string_p(str)) {
                    snprintf(buf, bufsize, "\"%s\"", RSTRING_PTR(str));
                } else {
                    snprintf(buf, bufsize, "\"[Object]\"");
                }
            }
            break;
    }
}

/**
 * Evaluate Ruby code from the input buffer
 * Returns 1 on success, 0 on error
 * Result is written to output_buffer as JSON string
 */
WASM_EXPORT
int homura_eval(void) {
    output_length = 0;
    output_buffer[0] = '\0';

    if (mrb == NULL) {
        snprintf((char*)output_buffer, sizeof(output_buffer),
                 "{\"error\":\"mruby not initialized\"}");
        output_length = (int)strnlen((char*)output_buffer, HOMURA_BUFFER_SIZE);
        return 0;
    }

    int ai = mrb_gc_arena_save(mrb);
    mrb_bool raised = 0;
    mrb_value result = mrb_protect(
        mrb,
        homura_eval_body,
        mrb_nil_value(),
        &raised
    );

    if (raised || mrb->exc) {
        mrb_value exc = mrb_obj_value(mrb->exc);
        mrb_value msg = mrb_funcall(mrb, exc, "message", 0);
        mrb->exc = NULL;

        snprintf((char*)output_buffer, sizeof(output_buffer),
                 "{\"error\":\"%s\"}",
                 mrb_string_p(msg) ? RSTRING_PTR(msg) : "Unknown error");
        output_length = (int)strnlen((char*)output_buffer, HOMURA_BUFFER_SIZE);
        mrb_gc_arena_restore(mrb, ai);
        return 0;
    }

    mrb_gc_protect(mrb, result);
    value_to_json(mrb, result, (char*)output_buffer, sizeof(output_buffer));
    output_length = (int)strnlen((char*)output_buffer, HOMURA_BUFFER_SIZE);
    mrb_gc_arena_restore(mrb, ai);
    return 1;
}

/**
 * Handle a MessagePack request
 */
WASM_EXPORT
int homura_handle_request(int input_len) {
    output_length = 0;
    output_buffer[0] = '\0';

    if (mrb == NULL) {
        homura_write_error_response("mruby not initialized");
        return 0;
    }
    if (input_len <= 0 || input_len > HOMURA_BUFFER_SIZE) {
        homura_write_error_response("invalid input length");
        return 0;
    }

    int ai = mrb_gc_arena_save(mrb);

    mp_reader reader = { input_buffer, (size_t)input_len, 0, 0 };
    mrb_value env = mp_decode_env(mrb, &reader);
    if (reader.error) {
        homura_write_error_response("invalid msgpack");
        mrb_gc_arena_restore(mrb, ai);
        return 0;
    }
    mrb_gc_protect(mrb, env);

    mrb_value app = mrb_gv_get(mrb, mrb_intern_cstr(mrb, "$app"));
    if (mrb_nil_p(app)) {
        homura_write_error_response("$app not defined");
        mrb_gc_arena_restore(mrb, ai);
        return 0;
    }
    mrb_gc_protect(mrb, app);

    mrb_bool raised = 0;
    g_request_data.app = app;
    g_request_data.env = env;
    mrb_value result = mrb_protect(
        mrb,
        homura_call_with_rescue_body,
        mrb_nil_value(),
        &raised
    );

    if (raised || mrb->exc) {
        mrb_value exc = mrb_obj_value(mrb->exc);
        mrb_value msg = mrb_funcall(mrb, exc, "message", 0);
        mrb->exc = NULL;
        homura_write_error_response(mrb_string_p(msg) ? RSTRING_PTR(msg) : "Ruby error");
        mrb_gc_arena_restore(mrb, ai);
        return 0;
    }

    mrb_gc_protect(mrb, result);
    mp_writer writer = { output_buffer, HOMURA_BUFFER_SIZE, 0, 0 };
    if (!mp_encode_value(mrb, &writer, result) || writer.error) {
        homura_write_error_response("response too large");
        mrb_gc_arena_restore(mrb, ai);
        return 0;
    }

    output_length = (int)writer.pos;
    mrb_gc_arena_restore(mrb, ai);
    return 1;
}

/**
 * Close the mruby VM
 */
WASM_EXPORT
void homura_close(void) {
    if (mrb != NULL) {
        mrb_close(mrb);
        mrb = NULL;
    }
}

/**
 * Memory allocation for WASI
 * This is required because we're using -nostartfiles
 */
WASM_EXPORT
void* homura_alloc(int size) {
    return malloc(size);
}

WASM_EXPORT
void homura_free(void* ptr) {
    free(ptr);
}
