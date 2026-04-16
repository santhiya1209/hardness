// backend/hikrobot/memory-buffer/memorybuffer.cpp
// Zero-copy triple-buffer for raw camera frame pixels.
// N-API addon — no fallback, no allocations on the hot write/read path.
//
// Triple-buffer protocol (lock-free):
//   g_slots[g_writeIdx]  — camera thread fills this slot
//   g_slots[g_readIdx]   — latest complete frame; reader queries this
//   g_slots[g_freeIdx]   — "spare" slot; writer grabs this next turn
//
// Write rotates freeIdx → writeIdx, copies pixels, flips to readIdx atomically.
// Read returns a zero-copy Buffer<uint8_t> wrapping the read slot's static array.
// The caller MUST NOT hold the Buffer across any async boundary;
// the backing memory is overwritten on the next Write().

#define _USE_MATH_DEFINES
#include <napi.h>
#include <atomic>
#include <cstring>
#include <cstdint>

// ── Capacity ────────────────────────────────────────────────────────────────
// 8 MB covers 4 K @ 8 bpp (3840 × 2160 = ~8.3 MB when 16 bpp — bump if needed)
static constexpr size_t MAX_FRAME_BYTES = 8'388'608u; // 8 MiB — power of 2

// ── Frame slot ──────────────────────────────────────────────────────────────
// Each slot is in its own 64-byte cache-line prefix to prevent false sharing
// on the metadata fields; the large data array follows naturally.
struct alignas(64) FrameSlot {
    std::atomic<uint64_t> generation { 0 };  // even = ready, odd = being written
    uint32_t width    { 0 };
    uint32_t height   { 0 };
    uint32_t frameNum { 0 };
    uint32_t byteSize { 0 };
    // Raw pixel data: NOT padded — starts at next natural alignment after metadata.
    alignas(64) uint8_t data[MAX_FRAME_BYTES];
};

static FrameSlot g_slots[3];                 // three static slots, never freed

static std::atomic<int> g_writeIdx { 0 };    // slot currently owned by writer
static std::atomic<int> g_readIdx  { 1 };    // most recent complete frame
static std::atomic<int> g_freeIdx  { 2 };    // spare slot; next writer target

// ── Write ────────────────────────────────────────────────────────────────────
// Called from the camera JS callback (Node.js main thread).
// Rotates to the free slot, writes pixels, then publishes atomically.
static Napi::Value Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4
        || !info[0].IsBuffer()
        || !info[1].IsNumber()
        || !info[2].IsNumber()
        || !info[3].IsNumber()) {
        Napi::TypeError::New(env, "write(data:Buffer, width:uint, height:uint, frameNum:uint)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto     src      = info[0].As<Napi::Buffer<uint8_t>>();
    uint32_t width    = info[1].As<Napi::Number>().Uint32Value();
    uint32_t height   = info[2].As<Napi::Number>().Uint32Value();
    uint32_t frameNo  = info[3].As<Napi::Number>().Uint32Value();
    size_t   sz       = src.ByteLength();

    if (sz == 0 || sz > MAX_FRAME_BYTES) {
        Napi::RangeError::New(env, "write: frame size out of range [1, MAX_FRAME_BYTES]")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Step 1 — atomically steal the free slot as the new write target.
    int wi = g_freeIdx.exchange(
        g_writeIdx.load(std::memory_order_relaxed),
        std::memory_order_acq_rel
    );
    g_writeIdx.store(wi, std::memory_order_relaxed);

    FrameSlot& slot = g_slots[wi];

    // Step 2 — mark slot in-progress (odd generation = being written).
    uint64_t gen = slot.generation.load(std::memory_order_relaxed);
    slot.generation.store(gen | 1ULL, std::memory_order_release);

    // Step 3 — write payload (single memcpy — hot path).
    slot.width    = width;
    slot.height   = height;
    slot.frameNum = frameNo;
    slot.byteSize = static_cast<uint32_t>(sz);
    std::memcpy(slot.data, src.Data(), sz);

    // Step 4 — mark slot ready (even generation, advanced by 2).
    slot.generation.store(gen + 2, std::memory_order_release);

    // Step 5 — publish this slot as the new readable frame.
    g_readIdx.store(wi, std::memory_order_release);

    return env.Undefined();
}

// ── Read ─────────────────────────────────────────────────────────────────────
// Returns the most recently completed frame as a zero-copy Buffer.
// If the slot is mid-write (shouldn't happen in triple-buffer — provided for
// safety), returns { ok: false }.
static Napi::Value Read(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    int ri = g_readIdx.load(std::memory_order_acquire);
    FrameSlot& slot = g_slots[ri];

    // Generation check: spin until we observe a stable even value.
    uint64_t gen;
    for (int spin = 0; spin < 8; ++spin) {
        gen = slot.generation.load(std::memory_order_acquire);
        if ((gen & 1ULL) == 0) break;
        // Slot is mid-write — this is unexpected for a triple-buffer but handle it.
        if (spin == 7) {
            Napi::Object fail = Napi::Object::New(env);
            fail.Set("ok", Napi::Boolean::New(env, false));
            fail.Set("error", Napi::String::New(env, "slot mid-write — retry"));
            return fail;
        }
    }

    if (slot.byteSize == 0) {
        Napi::Object empty = Napi::Object::New(env);
        empty.Set("ok", Napi::Boolean::New(env, false));
        empty.Set("error", Napi::String::New(env, "no frame yet"));
        return empty;
    }

    // Wrap static memory as a zero-copy Buffer.
    // Finalizer is a no-op — backing array is static.
    Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::New(
        env,
        slot.data,
        static_cast<size_t>(slot.byteSize),
        [](Napi::Env, uint8_t*) { /* static — do not free */ }
    );

    Napi::Object result = Napi::Object::New(env);
    result.Set("ok",       Napi::Boolean::New(env, true));
    result.Set("data",     buf);
    result.Set("width",    Napi::Number::New(env, slot.width));
    result.Set("height",   Napi::Number::New(env, slot.height));
    result.Set("frameNum", Napi::Number::New(env, slot.frameNum));
    result.Set("size",     Napi::Number::New(env, static_cast<double>(slot.byteSize)));
    result.Set("gen",      Napi::Number::New(env, static_cast<double>(gen)));
    return result;
}

// ── GetGeneration ─────────────────────────────────────────────────────────────
// Lightweight poll: returns the generation counter of the readable slot.
// Callers can detect new frames by comparing against their last observed value
// without touching the pixel data at all.
static Napi::Value GetGeneration(const Napi::CallbackInfo& info) {
    int ri = g_readIdx.load(std::memory_order_acquire);
    uint64_t g = g_slots[ri].generation.load(std::memory_order_acquire);
    return Napi::Number::New(info.Env(), static_cast<double>(g));
}

// ── Module init ──────────────────────────────────────────────────────────────
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("write",          Napi::Function::New(env, Write));
    exports.Set("read",           Napi::Function::New(env, Read));
    exports.Set("getGeneration",  Napi::Function::New(env, GetGeneration));
    exports.Set("MAX_FRAME_BYTES",Napi::Number::New(env, static_cast<double>(MAX_FRAME_BYTES)));
    return exports;
}

NODE_API_MODULE(memorybuffer, Init)
