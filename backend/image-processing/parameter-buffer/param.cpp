// backend/image-processing/parameter-buffer/param.cpp
// Lock-free atomic parameter store for the image processing pipeline.
// Each parameter occupies its own cache-line-padded slot to eliminate
// false sharing between independent readers and writers.
//
// All reads/writes are std::atomic with IEEE 754 float encoded as uint32_t
// via bit-cast — no locks, no allocations, deterministic latency.
//
// N-API exports:
//   setParam(name: string, value: number): void
//   getParam(name: string): number
//   setAll(params: object): void
//   getAll(): object
//   getRawBuffer(): Buffer   — packed float[PARAM_COUNT] for C-side fast read
//
// Parameter name constants are exported as PARAM_<name> = index integer.

#define _USE_MATH_DEFINES
#include <napi.h>
#include <atomic>
#include <cstring>
#include <cstdint>
#include <string>

// ── Parameter table ─────────────────────────────────────────────────────────
enum ParamId : int {
    PARAM_EXPOSURE_US  = 0,
    PARAM_GAIN_DB      = 1,
    PARAM_GAMMA        = 2,
    PARAM_PX_PER_MM    = 3,
    PARAM_CANNY_T1     = 4,
    PARAM_CANNY_T2     = 5,
    PARAM_LOAD_KGF     = 6,
    PARAM_BLACK_LEVEL  = 7,
    PARAM_CONTRAST     = 8,
    PARAM_COUNT        = 9
};

static const char* PARAM_NAMES[PARAM_COUNT] = {
    "exposureUs",   // 0
    "gainDb",       // 1
    "gamma",        // 2
    "pxPerMm",      // 3
    "cannyT1",      // 4
    "cannyT2",      // 5
    "loadKgf",      // 6
    "blackLevel",   // 7
    "contrast"      // 8
};

// Production defaults — match hikrobot_camera.cpp CameraParams / capture defaults.
static const float PARAM_DEFAULTS[PARAM_COUNT] = {
    10000.f,   // exposureUs
    0.f,       // gainDb
    1.0f,      // gamma
    100.f,     // pxPerMm
    30.f,      // cannyT1
    90.f,      // cannyT2
    10.f,      // loadKgf
    0.f,       // blackLevel
    100.f      // contrast
};

// ── Slot: one cache line per parameter ──────────────────────────────────────
struct alignas(64) ParamSlot {
    std::atomic<uint32_t> bits { 0 };
};

static ParamSlot g_params[PARAM_COUNT];
static bool      g_initialized = false;

// ── Float ↔ uint32_t bit-cast (C++17, strictly defined) ────────────────────
static inline uint32_t f2u(float f) noexcept {
    uint32_t u; std::memcpy(&u, &f, 4); return u;
}
static inline float u2f(uint32_t u) noexcept {
    float f; std::memcpy(&f, &u, 4); return f;
}

static void initDefaults() {
    if (g_initialized) return;
    g_initialized = true;
    for (int i = 0; i < PARAM_COUNT; ++i)
        g_params[i].bits.store(f2u(PARAM_DEFAULTS[i]), std::memory_order_relaxed);
}

// ── Param name → index (O(n) — n=9, negligible) ────────────────────────────
static int findParam(const std::string& name) {
    for (int i = 0; i < PARAM_COUNT; ++i)
        if (name == PARAM_NAMES[i]) return i;
    return -1;
}

// ── setParam ────────────────────────────────────────────────────────────────
static Napi::Value SetParam(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "setParam(name:string, value:number)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    int idx = findParam(info[0].As<Napi::String>().Utf8Value());
    if (idx < 0) {
        Napi::RangeError::New(env, "setParam: unknown parameter name")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    g_params[idx].bits.store(
        f2u(info[1].As<Napi::Number>().FloatValue()),
        std::memory_order_release
    );
    return env.Undefined();
}

// ── getParam ────────────────────────────────────────────────────────────────
static Napi::Value GetParam(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "getParam(name:string)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    int idx = findParam(info[0].As<Napi::String>().Utf8Value());
    if (idx < 0) {
        Napi::RangeError::New(env, "getParam: unknown parameter name")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return Napi::Number::New(env,
        u2f(g_params[idx].bits.load(std::memory_order_acquire))
    );
}

// ── setAll ──────────────────────────────────────────────────────────────────
// Sets every key present in the object; ignores unknown keys.
static Napi::Value SetAll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "setAll(params:object)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object obj = info[0].As<Napi::Object>();
    for (int i = 0; i < PARAM_COUNT; ++i) {
        Napi::Value v = obj.Get(PARAM_NAMES[i]);
        if (v.IsNumber())
            g_params[i].bits.store(
                f2u(v.As<Napi::Number>().FloatValue()),
                std::memory_order_release
            );
    }
    return env.Undefined();
}

// ── getAll ──────────────────────────────────────────────────────────────────
static Napi::Value GetAll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object obj = Napi::Object::New(env);
    for (int i = 0; i < PARAM_COUNT; ++i)
        obj.Set(PARAM_NAMES[i], Napi::Number::New(env,
            u2f(g_params[i].bits.load(std::memory_order_acquire))
        ));
    return obj;
}

// ── getRawBuffer ─────────────────────────────────────────────────────────────
// Returns a packed Buffer<float> of PARAM_COUNT floats in declaration order.
// The C++ processor can also access g_params directly — no IPC overhead.
static Napi::Value GetRawBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Buffer<uint8_t> buf =
        Napi::Buffer<uint8_t>::New(env, static_cast<size_t>(PARAM_COUNT) * sizeof(float));
    for (int i = 0; i < PARAM_COUNT; ++i) {
        uint32_t u = g_params[i].bits.load(std::memory_order_acquire);
        std::memcpy(buf.Data() + i * sizeof(float), &u, sizeof(float));
    }
    return buf;
}

// ── Module init ──────────────────────────────────────────────────────────────
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    initDefaults();

    exports.Set("setParam",    Napi::Function::New(env, SetParam));
    exports.Set("getParam",    Napi::Function::New(env, GetParam));
    exports.Set("setAll",      Napi::Function::New(env, SetAll));
    exports.Set("getAll",      Napi::Function::New(env, GetAll));
    exports.Set("getRawBuffer",Napi::Function::New(env, GetRawBuffer));
    exports.Set("PARAM_COUNT", Napi::Number::New(env, PARAM_COUNT));

    // Export PARAM_<name> = index for use in JS switch statements.
    for (int i = 0; i < PARAM_COUNT; ++i)
        exports.Set(std::string("PARAM_") + PARAM_NAMES[i],
                    Napi::Number::New(env, i));

    return exports;
}

NODE_API_MODULE(parambuffer, Init)
