// backend/hikrobot/napi/stream.cpp
// Hikrobot camera stream acquisition — N-API addon.
//
// Architecture:
//   • Registers MV_CC_RegisterImageCallBackEx on the camera handle.
//   • The SDK fires ImageCB() in an internal SDK thread on every frame.
//   • A Napi::TypedThreadSafeFunction (TSFN) bridges that thread to the
//     Node.js event loop.
//   • The JS-side onFrame(rawPixels: Buffer, width, height, frameNum)
//     callback is invoked on the Node.js main thread for every frame.
//   • The caller (hikrobot/js pipeline) calls memBuffer.write() inside
//     onFrame and then notifies hikrobot/ipc/frameserver.js.
//
// Exported JS API:
//   enumDevices() → [{model,serial,deviceType,index}]
//   start(opts, onFrame)  opts: {exposureUs,gainDb,gamma,blackLevel,width,height}
//   stop()
//   getStatus() → {isOpen,isGrabbing,width,height,lastFrameNum,lastGrabRet}
//   setSettings(opts)     same fields as opts above

#define _USE_MATH_DEFINES
#include <napi.h>
#include <atomic>
#include <thread>
#include <mutex>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>

#include "MvCameraControl.h"

// ── MVS runtime path (must match camera_server.js) ─────────────────────────
static const char* MVS_RUNTIME =
    "C:\\Program Files (x86)\\Common Files\\MVS\\Runtime\\Win64_x64";

// ── Frame payload passed through TSFN ──────────────────────────────────────
struct FramePayload {
    std::vector<uint8_t> pixels;  // raw 8 bpp grayscale row-major copy
    uint32_t width    { 0 };
    uint32_t height   { 0 };
    uint32_t frameNum { 0 };
};

// ── TSFN type alias ─────────────────────────────────────────────────────────
using FrameTSFN = Napi::TypedThreadSafeFunction<
    std::nullptr_t,     // context — unused
    FramePayload,       // item type posted by the SDK callback
    [](Napi::Env env, Napi::Function jsCb, std::nullptr_t*, FramePayload* item) {
        // Called on the Node.js main thread.
        // Wrap pixels as a zero-copy Buffer; the FramePayload vector owns the memory.
        // We transfer ownership to the Buffer via external-memory finalizer.
        size_t sz = item->pixels.size();
        uint8_t* ptr = item->pixels.data();

        // Transfer ownership: Buffer finalizer deletes item (and its vector).
        auto* owned = new FramePayload(std::move(*item));
        delete item;

        Napi::Buffer<uint8_t> buf = Napi::Buffer<uint8_t>::New(
            env, ptr, sz,
            [](Napi::Env, uint8_t*, FramePayload* fp) { delete fp; },
            owned
        );
        jsCb.Call({
            buf,
            Napi::Number::New(env, owned->width),
            Napi::Number::New(env, owned->height),
            Napi::Number::New(env, owned->frameNum)
        });
    }
>;

// ── Singleton camera state ──────────────────────────────────────────────────
static void*              g_handle      { nullptr };
static std::atomic<bool>  g_isOpen      { false };
static std::atomic<bool>  g_isGrabbing  { false };
static std::atomic<uint32_t> g_lastFrameNum { 0 };
static std::atomic<int>   g_lastGrabRet { 0 };
static uint32_t           g_width       { 0 };
static uint32_t           g_height      { 0 };
static std::mutex         g_dimMutex;
static FrameTSFN          g_tsfn;

// ── SDK image callback (fires in SDK thread) ────────────────────────────────
static void __stdcall ImageCB(unsigned char* pData,
                               MV_FRAME_OUT_INFO_EX* pInfo,
                               void* /*pUser*/)
{
    if (!pData || !pInfo || pInfo->nWidth == 0 || pInfo->nHeight == 0) return;

    // Convert to 8 bpp grayscale in-place if the camera delivers Mono8 or
    // a packed format.  For Bayer/colour sources the caller should configure
    // the camera to output Mono8 before calling start().
    const uint32_t W = pInfo->nWidth;
    const uint32_t H = pInfo->nHeight;
    const size_t   N = static_cast<size_t>(W) * H;

    // Allocate payload on the heap; TSFN finalizer frees it.
    auto* payload = new FramePayload();
    payload->width    = W;
    payload->height   = H;
    payload->frameNum = pInfo->nFrameNum;
    payload->pixels.resize(N);

    if (pInfo->enPixelType == PixelType_Gvsp_Mono8
        || pInfo->enPixelType == PixelType_Gvsp_BayerRG8
        || pInfo->enPixelType == PixelType_Gvsp_BayerGB8
        || pInfo->enPixelType == PixelType_Gvsp_BayerGR8
        || pInfo->enPixelType == PixelType_Gvsp_BayerBG8) {
        // First byte of each pixel IS the luminance or luma-proximate value.
        std::memcpy(payload->pixels.data(), pData, N);
    } else {
        // Unknown format — zero-fill; JS will see a dark frame and skip.
        std::memset(payload->pixels.data(), 0, N);
    }

    g_lastFrameNum.store(pInfo->nFrameNum, std::memory_order_relaxed);

    {
        std::lock_guard<std::mutex> lk(g_dimMutex);
        g_width  = W;
        g_height = H;
    }

    // Non-blocking post: if the JS thread is slow, frames are dropped (not queued).
    // This keeps the pipeline real-time; lagging consumers drop frames, not crash.
    if (g_tsfn.NonBlockingCall(payload) != napi_ok) {
        delete payload;
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
static std::string buildError(const char* prefix, int ret) {
    char buf[128];
    snprintf(buf, sizeof(buf), "%s (MV_CC ret=0x%08X)", prefix, ret);
    return buf;
}

// ── enumDevices() ────────────────────────────────────────────────────────────
static Napi::Value EnumDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MV_CC_DEVICE_INFO_LIST list;
    memset(&list, 0, sizeof(list));

    int ret = MV_CC_EnumDevices(MV_USB_DEVICE | MV_GIGE_DEVICE, &list);
    if (ret != MV_OK) {
        Napi::Array empty = Napi::Array::New(env, 0);
        return empty;
    }

    Napi::Array arr = Napi::Array::New(env, list.nDeviceNum);
    for (uint32_t i = 0; i < list.nDeviceNum; ++i) {
        MV_CC_DEVICE_INFO* p = list.pDeviceInfo[i];
        if (!p) continue;
        Napi::Object d = Napi::Object::New(env);
        d.Set("index", Napi::Number::New(env, i));
        if (p->nTLayerType == MV_USB_DEVICE || p->nTLayerType == MV_VIR_USB_DEVICE) {
            d.Set("deviceType", Napi::String::New(env, "usb3"));
            d.Set("model",  Napi::String::New(env, (char*)p->SpecialInfo.stUsb3VInfo.chModelName));
            d.Set("serial", Napi::String::New(env, (char*)p->SpecialInfo.stUsb3VInfo.chSerialNumber));
        } else {
            d.Set("deviceType", Napi::String::New(env, "gige"));
            d.Set("model",  Napi::String::New(env, (char*)p->SpecialInfo.stGigEInfo.chModelName));
            d.Set("serial", Napi::String::New(env, (char*)p->SpecialInfo.stGigEInfo.chSerialNumber));
        }
        arr.Set(i, d);
    }
    return arr;
}

// ── start(opts, onFrame) ─────────────────────────────────────────────────────
static Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
        Napi::TypeError::New(env, "start(opts:object, onFrame:function)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (g_isGrabbing.load()) return env.Undefined(); // idempotent

    // Enumerate and open first available device.
    MV_CC_DEVICE_INFO_LIST list;
    memset(&list, 0, sizeof(list));
    if (MV_CC_EnumDevices(MV_USB_DEVICE | MV_GIGE_DEVICE, &list) != MV_OK
        || list.nDeviceNum == 0) {
        Napi::Error::New(env, "start: no camera found").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    int ret;
    if ((ret = MV_CC_CreateHandle(&g_handle, list.pDeviceInfo[0])) != MV_OK
        || (ret = MV_CC_OpenDevice(g_handle)) != MV_OK) {
        Napi::Error::New(env, buildError("start: open device failed", ret))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Apply opts (best-effort — camera may not support all fields).
    Napi::Object opts = info[0].As<Napi::Object>();
    MV_CC_SetEnumValue(g_handle, "ExposureAuto", 0);
    MV_CC_SetEnumValue(g_handle, "GainAuto",     0);
    if (opts.Has("exposureUs") && opts.Get("exposureUs").IsNumber())
        MV_CC_SetFloatValue(g_handle, "ExposureTime",
            opts.Get("exposureUs").As<Napi::Number>().FloatValue());
    if (opts.Has("gainDb") && opts.Get("gainDb").IsNumber())
        MV_CC_SetFloatValue(g_handle, "Gain",
            opts.Get("gainDb").As<Napi::Number>().FloatValue());
    if (opts.Has("gamma") && opts.Get("gamma").IsNumber()) {
        MV_CC_SetBoolValue(g_handle, "GammaEnable", true);
        MV_CC_SetFloatValue(g_handle, "Gamma",
            opts.Get("gamma").As<Napi::Number>().FloatValue());
    }
    if (opts.Has("blackLevel") && opts.Get("blackLevel").IsNumber())
        MV_CC_SetFloatValue(g_handle, "BlackLevel",
            opts.Get("blackLevel").As<Napi::Number>().FloatValue());

    // Set camera to output Mono8 so ImageCB receives 8 bpp grayscale directly.
    MV_CC_SetEnumValue(g_handle, "PixelFormat",
        static_cast<unsigned int>(PixelType_Gvsp_Mono8));

    // ROI — use sensor maximum if not specified.
    {
        MVCC_INTVALUE_EX iv;
        uint32_t wMax = 0, hMax = 0;
        if (MV_CC_GetIntValueEx(g_handle, "WidthMax",  &iv) == MV_OK) wMax = (uint32_t)iv.nCurValue;
        if (MV_CC_GetIntValueEx(g_handle, "HeightMax", &iv) == MV_OK) hMax = (uint32_t)iv.nCurValue;
        uint32_t wReq = 0, hReq = 0;
        if (opts.Has("width")  && opts.Get("width").IsNumber())
            wReq = opts.Get("width").As<Napi::Number>().Uint32Value();
        if (opts.Has("height") && opts.Get("height").IsNumber())
            hReq = opts.Get("height").As<Napi::Number>().Uint32Value();
        MV_CC_SetIntValueEx(g_handle, "Width",  wReq > 0 ? wReq : wMax);
        MV_CC_SetIntValueEx(g_handle, "Height", hReq > 0 ? hReq : hMax);
    }

    // Register image callback — fires in SDK thread.
    ret = MV_CC_RegisterImageCallBackEx(g_handle, ImageCB, nullptr);
    if (ret != MV_OK) {
        MV_CC_CloseDevice(g_handle);
        MV_CC_DestroyHandle(g_handle);
        g_handle = nullptr;
        Napi::Error::New(env, buildError("start: RegisterImageCallBackEx failed", ret))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Create TSFN wrapping the JS onFrame callback.
    Napi::Function cb = info[1].As<Napi::Function>();
    g_tsfn = FrameTSFN::New(
        env, cb,
        "hikrobot-frame-tsfn", // resource name (for profiling)
        0,                     // maxQueueSize=0 → unlimited queue
        1,                     // initialThreadCount=1
        static_cast<std::nullptr_t*>(nullptr)
    );

    ret = MV_CC_StartGrabbing(g_handle);
    if (ret != MV_OK) {
        g_tsfn.Release();
        MV_CC_CloseDevice(g_handle);
        MV_CC_DestroyHandle(g_handle);
        g_handle = nullptr;
        Napi::Error::New(env, buildError("start: StartGrabbing failed", ret))
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    g_isOpen.store(true);
    g_isGrabbing.store(true);
    return env.Undefined();
}

// ── stop() ───────────────────────────────────────────────────────────────────
static Napi::Value Stop(const Napi::CallbackInfo& info) {
    if (!g_isGrabbing.load()) return info.Env().Undefined();

    g_isGrabbing.store(false);
    g_isOpen.store(false);

    if (g_handle) {
        MV_CC_StopGrabbing(g_handle);
        MV_CC_CloseDevice(g_handle);
        MV_CC_DestroyHandle(g_handle);
        g_handle = nullptr;
    }

    // Release TSFN — this signals the JS thread that no more callbacks are coming.
    g_tsfn.Release();

    return info.Env().Undefined();
}

// ── setSettings(opts) ────────────────────────────────────────────────────────
static Napi::Value SetSettings(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_isOpen.load()) {
        Napi::Error::New(env, "setSettings: camera not open").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "setSettings(opts:object)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object opts = info[0].As<Napi::Object>();
    if (opts.Has("exposureUs") && opts.Get("exposureUs").IsNumber()) {
        MV_CC_SetEnumValue(g_handle, "ExposureAuto", 0);
        MV_CC_SetFloatValue(g_handle, "ExposureTime",
            opts.Get("exposureUs").As<Napi::Number>().FloatValue());
    }
    if (opts.Has("gainDb") && opts.Get("gainDb").IsNumber()) {
        MV_CC_SetEnumValue(g_handle, "GainAuto", 0);
        MV_CC_SetFloatValue(g_handle, "Gain",
            opts.Get("gainDb").As<Napi::Number>().FloatValue());
    }
    if (opts.Has("gamma") && opts.Get("gamma").IsNumber()) {
        MV_CC_SetBoolValue(g_handle, "GammaEnable", true);
        MV_CC_SetFloatValue(g_handle, "Gamma",
            opts.Get("gamma").As<Napi::Number>().FloatValue());
    }
    if (opts.Has("blackLevel") && opts.Get("blackLevel").IsNumber())
        MV_CC_SetFloatValue(g_handle, "BlackLevel",
            opts.Get("blackLevel").As<Napi::Number>().FloatValue());
    return env.Undefined();
}

// ── getStatus() ──────────────────────────────────────────────────────────────
static Napi::Value GetStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    uint32_t w = 0, h = 0;
    { std::lock_guard<std::mutex> lk(g_dimMutex); w = g_width; h = g_height; }

    Napi::Object s = Napi::Object::New(env);
    s.Set("isOpen",       Napi::Boolean::New(env, g_isOpen.load()));
    s.Set("isGrabbing",   Napi::Boolean::New(env, g_isGrabbing.load()));
    s.Set("width",        Napi::Number::New(env, w));
    s.Set("height",       Napi::Number::New(env, h));
    s.Set("lastFrameNum", Napi::Number::New(env, g_lastFrameNum.load()));
    s.Set("lastGrabRet",  Napi::Number::New(env, g_lastGrabRet.load()));
    return s;
}

// ── Module init ──────────────────────────────────────────────────────────────
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    MV_CC_Initialize();
    exports.Set("enumDevices", Napi::Function::New(env, EnumDevices));
    exports.Set("start",       Napi::Function::New(env, Start));
    exports.Set("stop",        Napi::Function::New(env, Stop));
    exports.Set("setSettings", Napi::Function::New(env, SetSettings));
    exports.Set("getStatus",   Napi::Function::New(env, GetStatus));
    return exports;
}

NODE_API_MODULE(stream, Init)
