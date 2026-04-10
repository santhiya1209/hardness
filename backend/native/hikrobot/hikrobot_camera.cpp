// backend/native/hikrobot/hikrobot_camera.cpp
// HikRobot camera N-API addon + Express-compatible HTTP server
// Serves on port 8765 — matches shared.ts CAM_BASE
//
// Routes (all match CameraPage.tsx cam.post/cam.get calls):
//   POST /stream/start  → open device, start grabbing
//   POST /stream/stop   → stop grabbing
//   GET  /frame         → latest frame as base64 JPEG + width/height
//   POST /settings      → exposure_us, gain_db, gamma, contrast, black_level, resolution, res_mode
//   POST /capture       → measure Vickers HV, return d1_mm, d2_mm, hv, confidence
//   GET  /status        → camera status info
#define _USE_MATH_DEFINES
#include <cmath>
#include <napi.h>
#include <string>
#include <vector>
#include <atomic>
#include <thread>
#include <mutex>
#include <sstream>
#include <cmath>
#include <chrono>
#include <iostream>
#include <algorithm>
#include <numeric>
#include <cstring>
#include <cstdint>
#include <limits>
#include <utility>
#include <cstdio>
#include <deque>
#include <direct.h>   // _mkdir on Windows

#include "MvCameraControl.h"
#include "PixelType.h"

// ─────────────────────────────────────────────────
//  Data structures
// ─────────────────────────────────────────────────
struct FrameData {
    std::vector<unsigned char> jpeg;
    std::string  format="jpeg"; // "jpeg" or "bmp"
    unsigned int width=0, height=0, frameNum=0;
    long long    timestamp=0;
};

struct DeviceInfo {
    std::string  model, serial, ipAddress;
    unsigned int deviceType=0, index=0;
};

struct CameraParams {
    float        exposureUs=10000.f, gainDb=0.f;
    float        gamma=1.0f, contrast=100.f, blackLevel=0.f;
    unsigned int width=0, height=0;   // 0 = use camera maximum (set in openDevice)
    std::string  resMode="Normal";  // Normal, Bin2, Sum2, Skip2
};

struct MeasureResult {
    bool   success=false;
    double hv=0, d1_mm=0, d2_mm=0, d_mean_mm=0, confidence=0, px_per_mm=0;
    std::string error;
    // Overlay coords normalised to [0,1] of original image dimensions
    double cx_frac=.5, cy_frac=.5;
    double lx_frac=.4, ly_frac=.5;   // left  tip
    double rx_frac=.6, ry_frac=.5;   // right tip
    double tx_frac=.5, ty_frac=.4;   // top   tip
    double bx_frac=.5, by_frac=.6;   // bottom tip
    int    img_w=0,    img_h=0;
};

struct CalibResult {
    bool   success=false;
    double px_per_mm=0, offset_hv=0, measured_hv=0, error_pct=0;
    std::string message;
};

// ═══════════════════════════════════════════════════════════════════
//  TINY JPEG DECODER — Y-channel only, baseline DCT
//  No libjpeg needed. Decodes MV_CC_SaveImageEx2 output.
// ═══════════════════════════════════════════════════════════════════
namespace TinyJpeg {

static int u16be(const uint8_t* p){ return (p[0]<<8)|p[1]; }
static uint8_t clamp8(int v){ return v<0?0:v>255?255:(uint8_t)v; }

static const uint8_t ZZ[64]={
  0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,
  12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,
  35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,
  58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63};

struct HuffTable {
    uint8_t  bits[17]={}, vals[256]={};
    uint16_t codes[256]={};
    int      lengths[256]={}, count=0;
    void build(){
        count=0;
        for(int i=1;i<=16;i++) count+=bits[i];
        int code=0,idx=0;
        for(int len=1;len<=16;len++){
            for(int k=0;k<bits[len];k++,idx++){
                codes[idx]=(uint16_t)code;
                lengths[idx]=len; code++;
            }
            code<<=1;
        }
    }
    int decode(const uint8_t* d,size_t sz,size_t& bp,int& bb,int& bl) const {
        auto nb=[&]()->int{
            if(bl==0){if(bp>=sz)return -1;bb=d[bp++];
                if(bb==0xFF&&bp<sz&&d[bp]==0x00)bp++;bl=8;}
            return(bb>>(--bl))&1;};
        int code=0,len=0;
        for(int i=0;i<count;){
            int bit=nb(); if(bit<0)return -1;
            code=(code<<1)|bit; len++;
            for(;i<count&&lengths[i]==len;i++)
                if(codes[i]==(uint16_t)code)return vals[i];}
        return -1;}
};
struct QuantTable{ uint16_t q[64]={}; };

static int recvBits(int n,const uint8_t* d,size_t sz,size_t& bp,int& bb,int& bl){
    if(!n)return 0;
    int v=0;
    auto nb=[&]()->int{
        if(!bl){if(bp>=sz)return 0;bb=d[bp++];
            if(bb==0xFF&&bp<sz&&d[bp]==0x00)bp++;bl=8;}
        return(bb>>(--bl))&1;};
    for(int i=0;i<n;i++)v=(v<<1)|nb();
    if(v<(1<<(n-1)))v-=(1<<n)-1;
    return v;}

static void idct8(int coeff[64],const QuantTable& qt,uint8_t out[64]){
    float s[64]={};
    for(int i=0;i<64;i++) s[ZZ[i]]=coeff[i]*(float)qt.q[i];
    float t[64];
    for(int r=0;r<8;r++){
        float* row=s+r*8, v[8]={};
        for(int x=0;x<8;x++)
            for(int u=0;u<8;u++)
                v[x]+=(u?1.f:.70710678f)*row[u]*std::cos((2*x+1)*u*(float)M_PI/16.f);
        for(int x=0;x<8;x++) t[r*8+x]=v[x]*.5f;}
    for(int c=0;c<8;c++){
        float v[8]={};
        for(int y=0;y<8;y++)
            for(int u=0;u<8;u++)
                v[y]+=(u?1.f:.70710678f)*t[u*8+c]*std::cos((2*y+1)*u*(float)M_PI/16.f);
        for(int y=0;y<8;y++)
            out[y*8+c]=clamp8((int)(v[y]*.5f+128.5f));}}

static std::vector<uint8_t> decodeGray(const uint8_t* jpg,size_t sz,int& W,int& H){
    W=H=0;
    if(sz<4||jpg[0]!=0xFF||jpg[1]!=0xD8)return{};
    QuantTable qt[4]; HuffTable htDC[2],htAC[2];
    bool hasQT[4]={},hasDC[2]={},hasAC[2]={};
    int nComp=0;
    struct CI{int qtId=0,dcId=0,acId=0;} comp[5];
    size_t pos=2;
    while(pos+2<=sz){
        if(jpg[pos]!=0xFF)break;
        uint8_t mk=jpg[pos+1]; pos+=2;
        if(mk==0xD9)break; if(mk==0xD8)continue;
        if(pos+2>sz)break;
        int segLen=u16be(jpg+pos);
        const uint8_t* seg=jpg+pos+2; size_t sd=segLen-2;
        if(mk==0xDB){
            size_t o=0;
            while(o<sd){int info=seg[o++];int pr=(info>>4)&0xF,id=info&0xF;
                if(id>=4)break;
                for(int i=0;i<64;i++){qt[id].q[i]=pr?u16be(seg+o):seg[o];o+=pr?2:1;}
                hasQT[id]=true;}
        }else if(mk==0xC0){
            H=u16be(seg+1);W=u16be(seg+3);nComp=seg[5];
            for(int i=0;i<nComp&&i<4;i++) comp[seg[6+i*3]].qtId=seg[6+i*3+2];
        }else if(mk==0xC4){
            size_t o=0;
            while(o<sd){int info=seg[o++],cls=(info>>4)&1,id=info&0xF;
                if(id>=2)break;
                HuffTable& ht=cls?htAC[id]:htDC[id];
                memset(&ht,0,sizeof(ht));
                int tot=0; for(int i=1;i<=16;i++){ht.bits[i]=seg[o++];tot+=ht.bits[i];}
                for(int i=0;i<tot;i++)ht.vals[i]=seg[o++];
                ht.build(); if(cls)hasAC[id]=true; else hasDC[id]=true;}
        }else if(mk==0xDA){
            int sc=seg[0];
            for(int i=0;i<sc;i++){int cid=seg[1+i*2],hid=seg[2+i*2];
                comp[cid].dcId=(hid>>4)&0xF;comp[cid].acId=hid&0xF;}
            size_t ds=pos+segLen;
            std::vector<uint8_t> raw; raw.reserve(sz-ds);
            for(size_t i=ds;i<sz-1;){
                if(jpg[i]==0xFF){
                    if(jpg[i+1]==0x00){raw.push_back(0xFF);i+=2;continue;}
                    else if(jpg[i+1]>=0xD0&&jpg[i+1]<=0xD7){i+=2;continue;}
                    else break;}
                raw.push_back(jpg[i++]);}
            if(W<=0||H<=0)break;
            std::vector<uint8_t> gray(W*H,128);
            int mcuW=(W+7)/8,mcuH=(H+7)/8;
            size_t bp=0; int bb=0,bl=0;
            const uint8_t* rd=raw.data(); size_t rs=raw.size();
            int dcP[5]={};
            for(int my=0;my<mcuH;my++) for(int mx=0;mx<mcuW;mx++){
                for(int ci=1;ci<=nComp;ci++){
                    int di=comp[ci].dcId,ai=comp[ci].acId,qi=comp[ci].qtId;
                    if(!hasDC[di]||!hasAC[ai]||!hasQT[qi])continue;
                    int cf[64]={};
                    int dcS=htDC[di].decode(rd,rs,bp,bb,bl);
                    if(dcS<0)goto done;
                    dcP[ci]+=recvBits(dcS,rd,rs,bp,bb,bl); cf[0]=dcP[ci];
                    for(int k=1;k<64;){
                        int acS=htAC[ai].decode(rd,rs,bp,bb,bl);
                        if(acS<0)goto done; if(!acS)break;
                        if(acS==0xF0){k+=16;continue;}
                        int run=(acS>>4)&0xF,cat=acS&0xF;
                        k+=run; if(k>=64)break;
                        cf[k++]=recvBits(cat,rd,rs,bp,bb,bl);}
                    if(ci==1){
                        uint8_t blk[64]; idct8(cf,qt[qi],blk);
                        int bx=mx*8,by=my*8;
                        for(int r=0;r<8;r++){int y=by+r;if(y>=H)break;
                            for(int c=0;c<8;c++){int x=bx+c;if(x>=W)break;
                                gray[y*W+x]=blk[r*8+c];}}}}}
            done: return gray;}
        pos+=segLen;}
    return{};}
} // TinyJpeg

// ═══════════════════════════════════════════════════════════════════
//  PURE C++ IMAGE PROCESSING
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
//  BMP → grayscale float decoder
//
//  Handles 24-bit BGR BMP (produced by makeBmpFromBgr / Bayer path)
//  and 8-bit indexed BMP (produced by makeBmpFromRaw mono fallback).
//  Both are bottom-up (positive height), standard Windows BMP.
//  Luminance: Y = 0.114*B + 0.587*G + 0.299*R
// ─────────────────────────────────────────────────────────────────
// Returns uint8_t grayscale (same type as TinyJpeg::decodeGray) so it can
// be used interchangeably — both feed into gblur5/gblur11 which take uint8_t*.
static std::vector<uint8_t> decodeGrayBmp(const uint8_t* data, size_t len, int& W, int& H) {
    std::vector<uint8_t> out;
    if (len < 54) return out;                          // need file header + BITMAPINFOHEADER
    if (data[0] != 'B' || data[1] != 'M') return out; // not BMP magic

    // Read key fields from BITMAPFILEHEADER + BITMAPINFOHEADER
    auto rd32 = [&](size_t off) -> uint32_t {
        if (off+3 >= len) return 0;
        return data[off]|(uint32_t)(data[off+1]<<8)|(uint32_t)(data[off+2]<<16)|(uint32_t)(data[off+3]<<24);
    };
    auto rd16 = [&](size_t off) -> uint16_t {
        if (off+1 >= len) return 0;
        return (uint16_t)(data[off]|(data[off+1]<<8));
    };

    uint32_t pixelOffset = rd32(10);
    int      bmpW        = (int)rd32(18);
    int      bmpH        = (int)rd32(22);    // positive = bottom-up
    uint16_t bpp         = rd16(28);

    bool flipY = (bmpH > 0);    // bottom-up storage: flip when reading
    if (bmpH < 0) bmpH = -bmpH; // top-down BMP
    if (bmpW <= 0 || bmpH <= 0 || pixelOffset >= len) return out;
    W = bmpW; H = bmpH;
    out.resize((size_t)W * H, 0);

    if (bpp == 24) {
        // BGR24 — produced by makeBmpFromBgr after Bayer conversion
        uint32_t rowStride = ((uint32_t)(bmpW * 3) + 3u) & ~3u;
        for (int y = 0; y < bmpH; y++) {
            int srcY = flipY ? (bmpH - 1 - y) : y;
            size_t rowOff = pixelOffset + (size_t)srcY * rowStride;
            if (rowOff + (size_t)bmpW*3 > len) break;
            for (int x = 0; x < bmpW; x++) {
                float b = data[rowOff + x*3 + 0];
                float g = data[rowOff + x*3 + 1];
                float r = data[rowOff + x*3 + 2];
                float lum = 0.114f*b + 0.587f*g + 0.299f*r;
                out[(size_t)y*bmpW + x] = (uint8_t)std::min(255.f, std::max(0.f, lum));
            }
        }
    } else if (bpp == 8) {
        // 8-bit indexed (grayscale palette) — mono fallback path
        uint32_t rowStride = ((uint32_t)bmpW + 3u) & ~3u;
        for (int y = 0; y < bmpH; y++) {
            int srcY = flipY ? (bmpH - 1 - y) : y;
            size_t rowOff = pixelOffset + (size_t)srcY * rowStride;
            if (rowOff + (size_t)bmpW > len) break;
            for (int x = 0; x < bmpW; x++) {
                out[(size_t)y*bmpW + x] = data[rowOff + x];
            }
        }
    } else {
        out.clear(); // unsupported bpp — caller will catch empty result
    }
    return out;
}

static std::vector<float> gblur5(const uint8_t* s,int W,int H){
    static const float K[]={.0625f,.25f,.375f,.25f,.0625f};
    std::vector<float> t(W*H),o(W*H);
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        float v=0; for(int k=-2;k<=2;k++){int xx=std::max(0,std::min(W-1,x+k));v+=K[k+2]*s[y*W+xx];}
        t[y*W+x]=v;}
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        float v=0; for(int k=-2;k<=2;k++){int yy=std::max(0,std::min(H-1,y+k));v+=K[k+2]*t[yy*W+x];}
        o[y*W+x]=v;}
    return o;}

static std::vector<float> gblur11(const uint8_t* s,int W,int H){
    const float K11[]={.0002f,.0026f,.0175f,.0700f,.1755f,.2684f,.2684f,.1755f,.0700f,.0175f,.0026f};
    float sum=0; for(float k:K11)sum+=k;
    float K[11]; for(int i=0;i<11;i++)K[i]=K11[i]/sum;
    std::vector<float> t(W*H),o(W*H);
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        float v=0; for(int k=-5;k<=5;k++){int xx=std::max(0,std::min(W-1,x+k));v+=K[k+5]*s[y*W+xx];}
        t[y*W+x]=v;}
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        float v=0; for(int k=-5;k<=5;k++){int yy=std::max(0,std::min(H-1,y+k));v+=K[k+5]*t[yy*W+x];}
        o[y*W+x]=v;}
    return o;}


// ── Illumination normalisation ─────────────────────────────────────────────
// Normalises local contrast by dividing each pixel by its neighbourhood mean,
// then rescaling to the global mean.  Uses an integral image for O(N) speed.
//   R  – half-width of the local-mean box.
//        Use R≈50 to normalise scratch/texture contrast (local scale).
// Returns a uint8_t image with flattened local illumination.
static std::vector<uint8_t> normalizeIllum(const std::vector<uint8_t>& src, int W, int H, int R)
{
    const int N = W * H;
    // Build integral image (int64 to handle large R without overflow)
    std::vector<int64_t> ii(N, 0);
    for(int y = 0; y < H; y++){
        int64_t rowSum = 0;
        for(int x = 0; x < W; x++){
            rowSum += src[y*W+x];
            ii[y*W+x] = rowSum + (y > 0 ? ii[(y-1)*W+x] : 0);
        }
    }
    // Compute global mean so that the output retains the overall brightness
    double globalMean = (double)ii[(H-1)*W+(W-1)] / N;
    if(globalMean < 1.0) globalMean = 1.0;

    std::vector<uint8_t> out(N);
    for(int y = 0; y < H; y++){
        for(int x = 0; x < W; x++){
            int x0 = std::max(0, x-R), x1 = std::min(W-1, x+R);
            int y0 = std::max(0, y-R), y1 = std::min(H-1, y+R);
            int64_t s = ii[y1*W+x1]
                      - (x0 > 0       ? ii[y1*W+x0-1]     : 0)
                      - (y0 > 0       ? ii[(y0-1)*W+x1]   : 0)
                      + (x0>0 && y0>0 ? ii[(y0-1)*W+x0-1] : 0);
            int cnt = (x1-x0+1) * (y1-y0+1);
            double localMean = (double)s / cnt;
            if(localMean < 1.0) localMean = 1.0;
            double v = src[y*W+x] * globalMean / localMean;
            out[y*W+x] = (uint8_t)std::min(255.0, std::max(0.0, v));
        }
    }
    return out;
}

// ── Grayscale morphological closing ────────────────────────────────────────
// Closing = grayscale dilation (sliding max) then erosion (sliding min).
// Uses separable 1-D passes with a monotone deque → O(N) per axis.
// Fills narrow dark troughs (scratch valleys) while keeping large dark blobs
// (diamond faces) intact.  R≈21 suppresses 15-30 px grinding marks.
static std::vector<uint8_t> grayMorphCloseR(const std::vector<uint8_t>& src, int W, int H, int R)
{
    if(R <= 0) return src;

    // Separable sliding-window max (grayscale dilation)
    auto slidingMax = [&](const std::vector<uint8_t>& in) {
        std::vector<uint8_t> hd(W*H, 0), out(W*H, 0);
        // horizontal pass
        for(int y = 0; y < H; y++){
            std::deque<int> q;
            for(int x = 0; x < W; x++){
                while(!q.empty() && in[y*W+q.back()] <= in[y*W+x]) q.pop_back();
                q.push_back(x);
                if(q.front() < x - R) q.pop_front();
                // window covers [max(0,x-R)..x]; output at x is valid once x>=0
                hd[y*W+x] = in[y*W+q.front()];
            }
            // right-boundary: extend with border clamping
            for(int x = W; x < W+R; x++){
                int xi = W-1;
                while(!q.empty() && in[y*W+q.back()] <= in[y*W+xi]) q.pop_back();
                // don't re-push clamp; already at border: just trim left
                if(!q.empty() && q.front() < x - R) q.pop_front();
            }
        }
        // vertical pass
        for(int x = 0; x < W; x++){
            std::deque<int> q;
            for(int y = 0; y < H; y++){
                while(!q.empty() && hd[q.back()*W+x] <= hd[y*W+x]) q.pop_back();
                q.push_back(y);
                if(q.front() < y - R) q.pop_front();
                out[y*W+x] = hd[q.front()*W+x];
            }
        }
        return out;
    };

    // Separable sliding-window min (grayscale erosion)
    auto slidingMin = [&](const std::vector<uint8_t>& in) {
        std::vector<uint8_t> hd(W*H, 255), out(W*H, 255);
        for(int y = 0; y < H; y++){
            std::deque<int> q;
            for(int x = 0; x < W; x++){
                while(!q.empty() && in[y*W+q.back()] >= in[y*W+x]) q.pop_back();
                q.push_back(x);
                if(q.front() < x - R) q.pop_front();
                hd[y*W+x] = in[y*W+q.front()];
            }
        }
        for(int x = 0; x < W; x++){
            std::deque<int> q;
            for(int y = 0; y < H; y++){
                while(!q.empty() && hd[q.back()*W+x] >= hd[y*W+x]) q.pop_back();
                q.push_back(y);
                if(q.front() < y - R) q.pop_front();
                out[y*W+x] = hd[q.front()*W+x];
            }
        }
        return out;
    };

    return slidingMin(slidingMax(src));
}

// ── Integral-image adaptive threshold ──────────────────────────────────────
// Marks pixel as 1 (foreground/dark) if its value is more than (k*100)% below
// the mean of a (2R+1)×(2R+1) neighbourhood.
// Params: R = H/8 (~256 for 2048p),  k = 0.18
static std::vector<uint8_t> adaptiveThreshBox(
        const std::vector<float>& gray, int W, int H, int R, float k)
{
    // Build integral image (int64 to avoid overflow for large R)
    std::vector<int64_t> ii(W*H, 0);
    for(int y=0;y<H;y++){
        int64_t rowSum=0;
        for(int x=0;x<W;x++){
            rowSum += (int64_t)gray[y*W+x];
            ii[y*W+x] = rowSum + (y>0 ? ii[(y-1)*W+x] : 0);
        }
    }
    std::vector<uint8_t> bin(W*H, 0);
    for(int y=0;y<H;y++){
        for(int x=0;x<W;x++){
            int x0=std::max(0,x-R), x1=std::min(W-1,x+R);
            int y0=std::max(0,y-R), y1=std::min(H-1,y+R);
            int64_t s = ii[y1*W+x1]
                      - (x0>0 ? ii[y1*W+x0-1] : 0)
                      - (y0>0 ? ii[(y0-1)*W+x1] : 0)
                      + (x0>0&&y0>0 ? ii[(y0-1)*W+x0-1] : 0);
            int cnt = (x1-x0+1)*(y1-y0+1);
            float localMean = (float)s / cnt;
            bin[y*W+x] = (gray[y*W+x] < localMean*(1.0f - k)) ? 1 : 0;
        }
    }
    return bin;
}

// Fill enclosed black holes (0-valued regions not connected to the image border)
// inside a binary image.  Uses a BFS flood-fill from every border pixel; all
// background (0) pixels reachable from the border stay background; any 0 pixels
// that are completely surrounded by foreground (1) pixels are set to 1.
static std::vector<uint8_t> fillHoles(const std::vector<uint8_t>& src, int W, int H){
    // visited[i] = 1 means the pixel is confirmed background (connected to border)
    std::vector<uint8_t> bg(W*H, 0);
    std::vector<int> queue;
    queue.reserve(W*2 + H*2);
    auto push = [&](int x, int y){
        int idx = y*W+x;
        if(!bg[idx] && !src[idx]){ bg[idx]=1; queue.push_back(idx); }
    };
    // Seed from all border pixels that are background (0)
    for(int x=0;x<W;x++){ push(x,0); push(x,H-1); }
    for(int y=1;y<H-1;y++){ push(0,y); push(W-1,y); }
    // BFS
    for(int qi=0;qi<(int)queue.size();qi++){
        int idx=queue[qi], x=idx%W, y=idx/W;
        if(x>0)   push(x-1,y);
        if(x<W-1) push(x+1,y);
        if(y>0)   push(x,y-1);
        if(y<H-1) push(x,y+1);
    }
    // Pixels not in src and not reachable from border → fill them white (1)
    std::vector<uint8_t> out(src);
    for(int i=0;i<W*H;i++) if(!src[i] && !bg[i]) out[i]=1;
    return out;
}

static std::vector<uint8_t> close15(const std::vector<uint8_t>& src,int W,int H){
    int R=7;
    std::vector<uint8_t> dil(W*H,0);
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        uint8_t v=0;
        for(int dy=-R;dy<=R&&!v;dy++){int yy=y+dy;if(yy<0||yy>=H)continue;
            for(int dx=-R;dx<=R&&!v;dx++){int xx=x+dx;if(xx<0||xx>=W)continue;
                if(dy*dy+dx*dx<=R*R) v=src[yy*W+xx];}}
        dil[y*W+x]=v;}
    std::vector<uint8_t> ero(W*H,0);
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        uint8_t all=1;
        for(int dy=-R;dy<=R&&all;dy++){int yy=y+dy;if(yy<0||yy>=H){all=0;break;}
            for(int dx=-R;dx<=R&&all;dx++){int xx=x+dx;if(xx<0||xx>=W){all=0;break;}
                if(dy*dy+dx*dx<=R*R&&!dil[yy*W+xx])all=0;}}
        ero[y*W+x]=all;}
    return ero;}

// Morphological closing with arbitrary square SE half-width R.
// Uses separable horizontal+vertical sliding-window for O(N) performance
// regardless of R.  Closing = NOT( dilate( NOT( dilate(X) ) ) ).
static std::vector<uint8_t> morphCloseR(const std::vector<uint8_t>& src,int W,int H,int R){
    if(R<=0) return src;
    auto binaryDilate=[&](const std::vector<uint8_t>& in)->std::vector<uint8_t>{
        std::vector<uint8_t> hd(W*H,0);
        // horizontal pass
        for(int y=0;y<H;y++){
            int cnt=0;
            for(int xx=0;xx<=std::min(R,W-1);xx++) cnt+=in[y*W+xx];
            for(int x=0;x<W;x++){
                if(cnt>0) hd[y*W+x]=1;
                if(x+R+1<W) cnt+=in[y*W+x+R+1];
                if(x-R>=0)  cnt-=in[y*W+x-R];
            }
        }
        // vertical pass
        std::vector<uint8_t> out(W*H,0);
        for(int x=0;x<W;x++){
            int cnt=0;
            for(int yy=0;yy<=std::min(R,H-1);yy++) cnt+=hd[yy*W+x];
            for(int y=0;y<H;y++){
                if(cnt>0) out[y*W+x]=1;
                if(y+R+1<H) cnt+=hd[(y+R+1)*W+x];
                if(y-R>=0)  cnt-=hd[(y-R)*W+x];
            }
        }
        return out;
    };
    auto d=binaryDilate(src);
    for(auto& v:d) v^=1;
    d=binaryDilate(d);
    for(auto& v:d) v^=1;
    return d;
}

struct Blob{double cx,cy;int area,bw,bh;};
static std::vector<Blob> findBlobs(const std::vector<uint8_t>& bin,int W,int H,int mn,int mx){
    std::vector<int> lbl(W*H,0); std::vector<Blob> out; int nl=1;
    for(int sy=0;sy<H;sy++) for(int sx=0;sx<W;sx++){
        if(!bin[sy*W+sx]||lbl[sy*W+sx])continue;
        std::vector<int> stk; stk.push_back(sy*W+sx); lbl[sy*W+sx]=nl;
        long long sx2=0,sy2=0,cnt=0; int x0=W,x1=0,y0=H,y1=0;
        while(!stk.empty()){
            int p=stk.back();stk.pop_back();
            int py=p/W,px=p%W; sx2+=px;sy2+=py;cnt++;
            if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;
            int dx[]={-1,1,0,0},dy[]={0,0,-1,1};
            for(int d=0;d<4;d++){int nx=px+dx[d],ny=py+dy[d];
                if(nx<0||nx>=W||ny<0||ny>=H)continue;
                int np=ny*W+nx;
                if(bin[np]&&!lbl[np]){lbl[np]=nl;stk.push_back(np);}}}
        if(cnt>=mn&&cnt<=mx){
            Blob b; b.cx=(double)sx2/cnt; b.cy=(double)sy2/cnt;
            b.area=(int)cnt; b.bw=x1-x0+1; b.bh=y1-y0+1;
            out.push_back(b);}
        nl++;}
    return out;}

static std::vector<uint8_t> canny(const std::vector<float>& g,int W,int H,float lo,float hi){
    std::vector<float> mag(W*H,0); std::vector<int> dir(W*H,0);
    for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++){
        float gx=-g[(y-1)*W+x-1]+g[(y-1)*W+x+1]-2*g[y*W+x-1]+2*g[y*W+x+1]-g[(y+1)*W+x-1]+g[(y+1)*W+x+1];
        float gy=-g[(y-1)*W+x-1]-2*g[(y-1)*W+x]-g[(y-1)*W+x+1]+g[(y+1)*W+x-1]+2*g[(y+1)*W+x]+g[(y+1)*W+x+1];
        mag[y*W+x]=std::sqrt(gx*gx+gy*gy);
        float a=std::atan2(std::abs(gy),std::abs(gx))*180.f/(float)M_PI;
        dir[y*W+x]=a<22.5f?0:a<67.5f?(gx*gy>0?1:3):2;}
    std::vector<uint8_t> nms(W*H,0);
    for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++){
        float m=mag[y*W+x]; if(!m)continue;
        float a,b;
        switch(dir[y*W+x]){
            case 0:a=mag[y*W+x-1];b=mag[y*W+x+1];break;
            case 1:a=mag[(y-1)*W+x-1];b=mag[(y+1)*W+x+1];break;
            case 2:a=mag[(y-1)*W+x];b=mag[(y+1)*W+x];break;
            default:a=mag[(y-1)*W+x+1];b=mag[(y+1)*W+x-1];}
        nms[y*W+x]=(m>=a&&m>=b)?1:0;}
    std::vector<uint8_t> e(W*H,0);
    for(int i=0;i<W*H;i++) if(nms[i]&&mag[i]>=hi) e[i]=2;
    bool ch=true;
    while(ch){ch=false;
        for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++)
            if(nms[y*W+x]&&mag[y*W+x]>=lo&&!e[y*W+x])
                for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++)
                    if(e[(y+dy)*W+x+dx]==2){e[y*W+x]=2;ch=true;}}
    std::vector<uint8_t> out(W*H,0);
    for(int i=0;i<W*H;i++) out[i]=(e[i]==2)?255:0;
    return out;}

static std::vector<uint8_t> dil3(const std::vector<uint8_t>& s,int W,int H){
    std::vector<uint8_t> d(W*H,0);
    for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++){
        uint8_t v=0;
        for(int dy=-1;dy<=1&&!v;dy++) for(int dx=-1;dx<=1&&!v;dx++)
            v=s[(y+dy)*W+x+dx];
        d[y*W+x]=v;}
    return d;}

static double robExt(std::vector<double>& a,bool mn){
    if(a.empty())return 0;
    std::sort(a.begin(),a.end());
    double q1=a[(int)(a.size()*.25)],q3=a[(int)(a.size()*.75)];
    double iqr=q3-q1,lo2=q1-1.5*iqr,hi2=q3+1.5*iqr;
    std::vector<double> f; for(double x:a)if(x>=lo2&&x<=hi2)f.push_back(x);
    auto& s2=f.size()>=2?f:a;
    return mn?s2.front():s2.back();}

struct CornerPt{
    double x=0, y=0, score=0;
};

static double angDiff(double a,double b){
    double d = std::fmod(a-b, 2.0*M_PI);
    if(d >  M_PI) d -= 2.0*M_PI;
    if(d < -M_PI) d += 2.0*M_PI;
    return std::abs(d);
}

// ─────────────────────────────────────────────────────────────────
//  Sub-pixel corner refinement (iterative gradient orthogonality)
//
//  Solves: Σ [∇I(q) · (q - p)] = 0  for all q in a local window.
//  This is OpenCV cornerSubPix math, implemented from scratch.
//  Converges in 5 iterations for typical corner sharpness.
//  Returns refined (x,y); falls back to integer input if singular.
// ─────────────────────────────────────────────────────────────────
static void subpixelRefine(const std::vector<float>& img, int W, int H,
                            double& px, double& py, int winR=5){
    const int maxIter=10;
    const double epsilon=0.01; // convergence threshold in pixels
    double cx=px, cy=py;
    for(int iter=0; iter<maxIter; iter++){
        double a11=0,a12=0,a21=0,a22=0, b1=0, b2=0;
        int x0c=std::max(1,(int)(cx)-winR), y0c=std::max(1,(int)(cy)-winR);
        int x1c=std::min(W-2,(int)(cx)+winR), y1c=std::min(H-2,(int)(cy)+winR);
        for(int y=y0c; y<=y1c; y++){
            for(int x=x0c; x<=x1c; x++){
                // Gaussian weight centered on current estimate
                double wx=x-cx, wy=y-cy;
                double w=std::exp(-(wx*wx+wy*wy)/(2.0*winR*winR*0.25));
                // Sobel gradients at this pixel
                double gx=(-img[(y-1)*W+x-1]+img[(y-1)*W+x+1]
                           -2.f*img[y*W+x-1]+2.f*img[y*W+x+1]
                           -img[(y+1)*W+x-1]+img[(y+1)*W+x+1])*0.125;
                double gy=(-img[(y-1)*W+x-1]-2.f*img[(y-1)*W+x]-img[(y-1)*W+x+1]
                           +img[(y+1)*W+x-1]+2.f*img[(y+1)*W+x]+img[(y+1)*W+x+1])*0.125;
                double wgx2=w*gx*gx, wgy2=w*gy*gy, wgxy=w*gx*gy;
                // accumulate A = Σ w * [gx gx, gx gy; gy gx, gy gy]
                a11+=wgx2; a12+=wgxy; a21+=wgxy; a22+=wgy2;
                // b = Σ w * [gx gy] * (q · [gx gy]^T)  where q = pixel position
                double qgx=w*(gx*x+gy*y)*gx, qgy=w*(gx*x+gy*y)*gy;
                b1+=qgx; b2+=qgy;
            }
        }
        double det=a11*a22-a12*a21;
        if(std::abs(det)<1e-10) break; // singular — keep current estimate
        double nx=(a22*b1-a12*b2)/det;
        double ny=(a11*b2-a21*b1)/det;
        // Clamp movement to stay within window
        nx=std::clamp(nx, cx-(double)winR, cx+(double)winR);
        ny=std::clamp(ny, cy-(double)winR, cy+(double)winR);
        double move=std::hypot(nx-cx, ny-cy);
        cx=nx; cy=ny;
        if(move<epsilon) break;
    }
    // Accept only if we didn't drift far from integer seed (>winR means diverged)
    if(std::hypot(cx-px, cy-py) < (double)winR){
        px=cx; py=cy;
    }
}

// ─────────────────────────────────────────────────────────────────
//  Geometric rhombus fitting: least-squares fit of an ideal
//  Vickers diamond (cx, cy, hD1, hD2, rotation θ) to 4 raw tips.
//
//  Vickers tips in rotated frame:
//    left  = (cx - hD1*cosθ, cy - hD1*sinθ)
//    right = (cx + hD1*cosθ, cy + hD1*sinθ)
//    top   = (cx + hD2*sinθ, cy - hD2*cosθ)  [perpendicular to D1]
//    bottom= (cx - hD2*sinθ, cy + hD2*cosθ)
//
//  Solves 3 iterations of gradient descent on the 5-parameter model.
//  Only applied when all 4 tips are present and D1/D2 ratio ≥ 0.28.
// ─────────────────────────────────────────────────────────────────
struct RhombusResult{
    bool ok=false;
    double cx=0,cy=0,hD1=0,hD2=0,theta=0;
    double lx=0,ly=0, rx=0,ry=0, tx=0,ty=0, bx=0,by=0;
    double residual=0;
};

static RhombusResult fitRhombus(double lx,double ly,double rx,double ry,
                                 double tx,double ty,double bx,double by){
    RhombusResult res;
    // Initial parameter estimates from raw tips
    double cx0=(lx+rx+tx+bx)*0.25;
    double cy0=(ly+ry+ty+by)*0.25;
    // D1 axis: average of (right-left) direction
    double d1ax=(rx-lx), d1ay=(ry-ly);
    double d1len=std::hypot(d1ax,d1ay);
    if(d1len<2) return res;
    double theta0=std::atan2(d1ay,d1ax);
    double hD10=d1len*0.5;
    // D2 from top-bottom pair
    double d2len=std::hypot(bx-tx, by-ty);
    double hD20=d2len*0.5;
    if(hD20<2) return res;

    // Iterative gradient descent (fixed-step, 40 iterations)
    double cx_=cx0, cy_=cy0, hD1_=hD10, hD2_=hD20, th_=theta0;
    const int ITER=40;
    double lr=0.5; // learning rate (pixels)
    for(int it=0; it<ITER; it++){
        double cosT=std::cos(th_), sinT=std::sin(th_);
        // Predicted tip positions
        double plx=cx_-hD1_*cosT, ply=cy_-hD1_*sinT;
        double prx=cx_+hD1_*cosT, pry=cy_+hD1_*sinT;
        double ptx=cx_+hD2_*sinT, pty=cy_-hD2_*cosT;
        double pbx=cx_-hD2_*sinT, pby=cy_+hD2_*cosT;
        // Residuals
        double elx=plx-lx, ely=ply-ly;
        double erx=prx-rx, ery=pry-ry;
        double etx=ptx-tx, ety=pty-ty;
        double ebx=pbx-bx, eby=pby-by;
        // Gradients w.r.t. each parameter
        double gcx=elx+erx+etx+ebx;
        double gcy=ely+ery+ety+eby;
        double ghD1=(-elx*cosT-ely*sinT)+(erx*cosT+ery*sinT);
        double ghD2=(etx*sinT-ety*cosT)+(-ebx*sinT+eby*cosT);
        double gth=hD1_*(elx*sinT-ely*cosT-erx*sinT+ery*cosT)
                  +hD2_*(etx*cosT+ety*sinT-ebx*cosT-eby*sinT);
        // Decay learning rate
        double a=lr/(1.0+it*0.1);
        cx_ -= a*gcx*0.25;
        cy_ -= a*gcy*0.25;
        hD1_-= a*ghD1*0.25;
        hD2_-= a*ghD2*0.25;
        th_  -= a*gth*0.01;
    }

    if(hD1_<2 || hD2_<2) return res;
    double ratio=std::min(hD1_,hD2_)/std::max(hD1_,hD2_);
    if(ratio<0.20) return res;

    double cosT=std::cos(th_), sinT=std::sin(th_);
    res.ok=true;
    res.cx=cx_; res.cy=cy_; res.hD1=hD1_; res.hD2=hD2_; res.theta=th_;
    res.lx=cx_-hD1_*cosT; res.ly=cy_-hD1_*sinT;
    res.rx=cx_+hD1_*cosT; res.ry=cy_+hD1_*sinT;
    res.tx=cx_+hD2_*sinT; res.ty=cy_-hD2_*cosT;
    res.bx=cx_-hD2_*sinT; res.by=cy_+hD2_*cosT;
    // RMS residual
    double sumSq=(std::pow(res.lx-lx,2)+std::pow(res.ly-ly,2)
                 +std::pow(res.rx-rx,2)+std::pow(res.ry-ry,2)
                 +std::pow(res.tx-tx,2)+std::pow(res.ty-ty,2)
                 +std::pow(res.bx-bx,2)+std::pow(res.by-by,2));
    res.residual=std::sqrt(sumSq/8.0);
    return res;
}

static std::vector<CornerPt> shiTomasiCornersRoi(const std::vector<float>& img,int W,int H,
                                                 int x0,int y0,int x1,int y1,
                                                 double blobR=0.0){
    std::vector<CornerPt> corners;
    x0=std::max(1, std::min(W-3, x0));
    y0=std::max(1, std::min(H-3, y0));
    x1=std::max(2, std::min(W-2, x1));
    y1=std::max(2, std::min(H-2, y1));
    if(x1-x0<8 || y1-y0<8) return corners;

    int rw=x1-x0+1, rh=y1-y0+1;
    std::vector<float> gx(rw*rh,0.f), gy(rw*rh,0.f), resp(rw*rh,0.f);

    for(int y=1;y<rh-1;y++) for(int x=1;x<rw-1;x++){
        int xx=x0+x, yy=y0+y;
        float ix=-img[(yy-1)*W+xx-1]+img[(yy-1)*W+xx+1]
                -2.f*img[yy*W+xx-1]  +2.f*img[yy*W+xx+1]
                -img[(yy+1)*W+xx-1]+img[(yy+1)*W+xx+1];
        float iy=-img[(yy-1)*W+xx-1]-2.f*img[(yy-1)*W+xx]-img[(yy-1)*W+xx+1]
                +img[(yy+1)*W+xx-1]+2.f*img[(yy+1)*W+xx]+img[(yy+1)*W+xx+1];
        gx[y*rw+x]=ix;
        gy[y*rw+x]=iy;
    }

    // Adaptive window half-size: scale with blob size (~8% of blob radius).
    // Clamped to [1, 6] so it never exceeds ROI bounds.
    int hw = (blobR > 0) ? std::clamp((int)(blobR * 0.08), 1, 6) : 1;

    float maxResp=0.f;
    int margin = hw + 1;
    for(int y=margin;y<rh-margin;y++) for(int x=margin;x<rw-margin;x++){
        double sxx=0, sxy=0, syy=0;
        for(int ky=-hw;ky<=hw;ky++) for(int kx=-hw;kx<=hw;kx++){
            int p=(y+ky)*rw+(x+kx);
            double ix=gx[p], iy=gy[p];
            sxx+=ix*ix; sxy+=ix*iy; syy+=iy*iy;
        }
        double tr=sxx+syy;
        double det=sxx*syy-sxy*sxy;
        if(det<=0) continue;
        double disc=tr*tr-4.0*det;
        if(disc<0) disc=0;
        float lm=(float)(0.5*(tr-std::sqrt(disc))); // Shi-Tomasi = min eigenvalue
        if(lm<=0) continue;
        resp[y*rw+x]=lm;
        if(lm>maxResp) maxResp=lm;
    }
    if(maxResp<=0) return corners;

    float thr=maxResp*0.05f;
    const int nmsR=std::max(2, hw);
    for(int y=margin+nmsR;y<rh-margin-nmsR;y++) for(int x=margin+nmsR;x<rw-margin-nmsR;x++){
        float v=resp[y*rw+x];
        if(v<thr) continue;
        bool isMax=true;
        for(int ky=-nmsR;ky<=nmsR&&isMax;ky++) for(int kx=-nmsR;kx<=nmsR;kx++){
            if(kx==0&&ky==0) continue;
            if(resp[(y+ky)*rw+(x+kx)]>=v){ isMax=false; break; }
        }
        if(isMax){
            CornerPt c;
            c.x=x0+x; c.y=y0+y; c.score=v;
            corners.push_back(c);
        }
    }

    std::sort(corners.begin(), corners.end(),
              [](const CornerPt& a,const CornerPt& b){ return a.score>b.score; });
    if(corners.size()>800) corners.resize(800);
    return corners;
}

static bool pickCornerNearSeed(const std::vector<CornerPt>& corners,std::vector<uint8_t>& used,double maxScore,
                               double cx,double cy,double dirAngle,double seedX,double seedY,
                               double minDist,double maxDist,double seedRadius,CornerPt& out){
    if(corners.empty() || maxScore<=0) return false;
    const double cone=40.0*M_PI/180.0;
    double best=-1;
    int bestIdx=-1;
    for(size_t i=0;i<corners.size();i++){
        if(used[i]) continue;
        const CornerPt& c=corners[i];
        double dx=c.x-cx, dy=c.y-cy;
        double dc=std::hypot(dx,dy);
        if(dc<minDist || dc>maxDist) continue;
        if(angDiff(std::atan2(dy,dx), dirAngle)>cone) continue;
        double ds=std::hypot(c.x-seedX, c.y-seedY);
        if(ds>seedRadius) continue;
        double respN=std::clamp(c.score/maxScore,0.0,1.0);
        double seedN=std::clamp(1.0-ds/seedRadius,0.0,1.0);
        double dirN =std::clamp(1.0-angDiff(std::atan2(dy,dx),dirAngle)/cone,0.0,1.0);
        double sc=respN*0.50 + seedN*0.35 + dirN*0.15;
        if(sc>best){ best=sc; bestIdx=(int)i; }
    }
    if(bestIdx<0) return false;
    out=corners[(size_t)bestIdx];
    used[(size_t)bestIdx]=1;
    return true;
}

static bool pickCornerByDirection(const std::vector<CornerPt>& corners,std::vector<uint8_t>& used,double maxScore,
                                  double cx,double cy,double dirAngle,double minDist,double maxDist,CornerPt& out){
    if(corners.empty() || maxScore<=0) return false;
    const double cone=34.0*M_PI/180.0;
    double best=-1;
    int bestIdx=-1;
    for(size_t i=0;i<corners.size();i++){
        if(used[i]) continue;
        const CornerPt& c=corners[i];
        double dx=c.x-cx, dy=c.y-cy;
        double dc=std::hypot(dx,dy);
        if(dc<minDist || dc>maxDist) continue;
        double da=angDiff(std::atan2(dy,dx), dirAngle);
        if(da>cone) continue;
        double respN=std::clamp(c.score/maxScore,0.0,1.0);
        double distN=std::clamp((dc-minDist)/std::max(1.0,maxDist-minDist),0.0,1.0);
        double dirN =std::clamp(1.0-da/cone,0.0,1.0);
        double sc=respN*0.62 + distN*0.23 + dirN*0.15;
        if(sc>best){ best=sc; bestIdx=(int)i; }
    }
    if(bestIdx<0) return false;
    out=corners[(size_t)bestIdx];
    used[(size_t)bestIdx]=1;
    return true;
}

struct ContourTips{
    bool ok=false;
    double lx=0,ly=0,rx=0,ry=0,tx=0,ty=0,bx=0,by=0;
    double score=0;
};

static int bitCount4(int v){
    int c=0;
    if(v&1) c++;
    if(v&2) c++;
    if(v&4) c++;
    if(v&8) c++;
    return c;
}

static ContourTips detectDiamondContourTips(const std::vector<uint8_t>& edge,int W,int H,
                                            double cx,double cy,double searchR,double minPx){
    ContourTips out;
    if(edge.empty() || W<=0 || H<=0) return out;

    const int roiR=(int)std::max(24.0, std::min(searchR*1.45, std::min(W,H)*0.48));
    const int x0=(int)std::max(1.0, cx-roiR), y0=(int)std::max(1.0, cy-roiR);
    const int x1=(int)std::min((double)W-2, cx+roiR), y1=(int)std::min((double)H-2, cy+roiR);
    const int rw=x1-x0+1, rh=y1-y0+1;
    if(rw<12 || rh<12) return out;

    std::vector<uint8_t> roi((size_t)rw*rh,0), vis((size_t)rw*rh,0);
    for(int y=y0;y<=y1;y++) for(int x=x0;x<=x1;x++){
        if(edge[y*W+x]) roi[(size_t)(y-y0)*rw + (size_t)(x-x0)] = 1;
    }

    double bestScore=-1e18;
    std::vector<std::pair<int,int>> bestPts;
    int bestMinX=0,bestMaxX=0,bestMinY=0,bestMaxY=0;

    std::vector<int> stk;
    stk.reserve((size_t)rw*rh/8 + 64);

    for(int sy=0;sy<rh;sy++) for(int sx=0;sx<rw;sx++){
        size_t sidx=(size_t)sy*rw + (size_t)sx;
        if(!roi[sidx] || vis[sidx]) continue;
        vis[sidx]=1;
        stk.clear();
        stk.push_back((int)sidx);

        std::vector<std::pair<int,int>> pts;
        pts.reserve(512);
        long long sumX=0,sumY=0;
        int mnx=std::numeric_limits<int>::max(), mxx=std::numeric_limits<int>::min();
        int mny=std::numeric_limits<int>::max(), mxy=std::numeric_limits<int>::min();
        int qMask=0;

        while(!stk.empty()){
            int p=stk.back(); stk.pop_back();
            int py=p/rw, px=p%rw;
            int gx=x0+px, gy=y0+py;
            pts.push_back({gx,gy});
            sumX+=gx; sumY+=gy;
            if(gx<mnx) mnx=gx; if(gx>mxx) mxx=gx;
            if(gy<mny) mny=gy; if(gy>mxy) mxy=gy;
            int q=(gx>=cx ? 1:0) + (gy>=cy ? 2:0);
            qMask |= (1<<q);

            for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){
                if(dx==0&&dy==0) continue;
                int nx=px+dx, ny=py+dy;
                if(nx<0||nx>=rw||ny<0||ny>=rh) continue;
                size_t ni=(size_t)ny*rw + (size_t)nx;
                if(!roi[ni] || vis[ni]) continue;
                vis[ni]=1;
                stk.push_back((int)ni);
            }
        }

        const int area=(int)pts.size();
        if(area < (int)(rw*rh*0.0025) || area > (int)(rw*rh*0.70)) continue;

        const double spanX=(double)(mxx-mnx+1);
        const double spanY=(double)(mxy-mny+1);
        if(spanX<minPx*1.6 || spanY<minPx*1.6) continue;
        double ratio=std::min(spanX,spanY)/std::max(spanX,spanY);
        if(ratio<0.20) continue;

        double mx=(double)sumX/area, my=(double)sumY/area;
        double centDist=std::hypot(mx-cx,my-cy)/std::max(1.0,std::hypot((double)W,(double)H));
        int qCnt=bitCount4(qMask);
        if(qCnt<3) continue;

        bool centerInside=(cx>=mnx && cx<=mxx && cy>=mny && cy<=mxy);
        double spanNorm=std::clamp(std::max(spanX,spanY)/std::max(1.0,searchR*2.0),0.0,1.0);
        double sc=ratio*0.46 + (qCnt/4.0)*0.22 + spanNorm*0.20 + (centerInside?0.12:0.0) - centDist*0.22;
        if(sc>bestScore){
            bestScore=sc;
            bestPts=std::move(pts);
            bestMinX=mnx; bestMaxX=mxx; bestMinY=mny; bestMaxY=mxy;
        }
    }

    if(bestPts.size()<16) return out;

    auto pickTip = [&](double dirX,double dirY,double orthoW)->std::pair<double,double>{
        double best=-1e18,bx=cx,by=cy;
        for(const auto& p:bestPts){
            double dx=p.first-cx, dy=p.second-cy;
            double along=dx*dirX + dy*dirY;
            double ortho=std::abs(dx*(-dirY) + dy*dirX);
            double s=along - orthoW*ortho;
            if(s>best){ best=s; bx=p.first; by=p.second; }
        }
        return {bx,by};
    };

    auto [lx,ly]=pickTip(-1.0, 0.0, 0.40);
    auto [rx,ry]=pickTip( 1.0, 0.0, 0.40);
    auto [tx,ty]=pickTip( 0.0,-1.0, 0.40);
    auto [bx,by]=pickTip( 0.0, 1.0, 0.40);

    double dL=std::hypot(lx-cx,ly-cy), dR=std::hypot(rx-cx,ry-cy);
    double dT=std::hypot(tx-cx,ty-cy), dB=std::hypot(bx-cx,by-cy);
    double maxPx=std::min(W,H)*0.90;
    bool sizeOK=(dL>minPx&&dR>minPx&&dT>minPx&&dB>minPx&&
                 dL<maxPx&&dR<maxPx&&dT<maxPx&&dB<maxPx);
    if(!sizeOK) return out;

    double hd1=(rx-lx)*0.5, hd2=(by-ty)*0.5;
    if(hd1<minPx || hd2<minPx) return out;
    double ratio=std::min(hd1,hd2)/std::max(hd1,hd2);
    if(ratio<0.20) return out;

    out.ok=true;
    out.lx=lx; out.ly=ly; out.rx=rx; out.ry=ry;
    out.tx=tx; out.ty=ty; out.bx=bx; out.by=by;
    double bboxRatio = std::min((double)(bestMaxX-bestMinX+1),(double)(bestMaxY-bestMinY+1))/
                       std::max((double)(bestMaxX-bestMinX+1),(double)(bestMaxY-bestMinY+1));
    out.score=std::clamp((ratio*0.72 + std::max(0.0,bestScore)*0.18 + bboxRatio*0.10),0.0,1.0);
    return out;
}

static std::vector<uint8_t> maskBoundaryEdge(const std::vector<uint8_t>& mask,int W,int H){
    std::vector<uint8_t> out((size_t)W*H,0);
    if(mask.empty() || W<3 || H<3) return out;
    for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++){
        size_t idx=(size_t)y*W + (size_t)x;
        if(!mask[idx]) continue;
        bool boundary=false;
        for(int dy=-1;dy<=1 && !boundary;dy++) for(int dx=-1;dx<=1;dx++){
            if(!mask[(size_t)(y+dy)*W + (size_t)(x+dx)]){ boundary=true; break; }
        }
        if(boundary) out[idx]=255;
    }
    return out;
}

static std::vector<uint8_t> buildLocalDarkMask(const std::vector<float>& img,int W,int H,
                                               double cx,double cy,double rad){
    std::vector<uint8_t> mask((size_t)W*H,0);
    if(img.empty() || W<=0 || H<=0) return mask;
    int r=(int)std::max(10.0, std::min(rad, std::min(W,H)*0.48));
    int x0=std::max(1,(int)(cx-r)), y0=std::max(1,(int)(cy-r));
    int x1=std::min(W-2,(int)(cx+r)), y1=std::min(H-2,(int)(cy+r));
    if(x1-x0<10 || y1-y0<10) return mask;

    std::vector<float> vals;
    vals.reserve((size_t)(x1-x0+1)*(y1-y0+1));
    for(int y=y0;y<=y1;y++) for(int x=x0;x<=x1;x++){
        double dx=x-cx, dy=y-cy;
        if(dx*dx+dy*dy <= (double)r*r) vals.push_back(img[(size_t)y*W + (size_t)x]);
    }
    if(vals.size()<64) return mask;

    auto vLow=vals, vHigh=vals;
    size_t iLow = vals.size()*15/100;
    size_t iHigh= vals.size()*85/100;
    std::nth_element(vLow.begin(),  vLow.begin()+iLow,  vLow.end());
    std::nth_element(vHigh.begin(), vHigh.begin()+iHigh, vHigh.end());
    float p15=vLow[iLow], p85=vHigh[iHigh];
    if(p85-p15 < 8.0f) return mask;

    // Bias threshold toward dark region; tuned for Vickers dark indentation with bright center glare.
    float thr = p15 + 0.52f*(p85-p15);

    for(int y=y0;y<=y1;y++) for(int x=x0;x<=x1;x++){
        double dx=x-cx, dy=y-cy;
        if(dx*dx+dy*dy > (double)r*r) continue;
        if(img[(size_t)y*W + (size_t)x] < thr) mask[(size_t)y*W + (size_t)x]=1;
    }
    return mask;
}

// ═══════════════════════════════════════════════════════════════════
//  DEBUG IMAGE HELPERS — saves intermediate BMP images to C:\temp\hv_debug\
// ═══════════════════════════════════════════════════════════════════
static const char* DBG_DIR = "C:\\temp\\hv_debug";

static void dbgInit(){
    static bool done=false;
    if(done) return; done=true;
    _mkdir("C:\\temp");
    _mkdir(DBG_DIR);
    fprintf(stderr,"[HV-DBG] debug dir: %s\n", DBG_DIR);
}

// Save uint8 grayscale or binary (isBinary: 0→0, nonzero→255) as 8-bit BMP (top-down)
static void dbgSaveBmp(const char* name, const uint8_t* px, int W, int H, bool isBinary=false){
    dbgInit();
    char path[512]; snprintf(path,sizeof(path),"%s\\%s",DBG_DIR,name);
    FILE* f=fopen(path,"wb"); if(!f){ fprintf(stderr,"[HV-DBG] cannot open %s\n",path); return; }
    const int rowStride=(W+3)&~3;
    const int palSize=256*4;
    const int pixOff=14+40+palSize;
    const int fileSize=pixOff+rowStride*H;
    // BITMAPFILEHEADER
    uint8_t fh[14]={};
    fh[0]='B';fh[1]='M';
    fh[2]= fileSize     &0xFF; fh[3]=(fileSize>>8) &0xFF;
    fh[4]=(fileSize>>16)&0xFF; fh[5]=(fileSize>>24)&0xFF;
    fh[10]=pixOff&0xFF; fh[11]=(pixOff>>8)&0xFF;
    fh[12]=(pixOff>>16)&0xFF; fh[13]=(pixOff>>24)&0xFF;
    fwrite(fh,1,14,f);
    // BITMAPINFOHEADER (top-down: negative height)
    int negH=-H;
    uint8_t ih[40]={};
    ih[0]=40;
    ih[4]=W&0xFF;  ih[5]=(W>>8)&0xFF;  ih[6]=(W>>16)&0xFF;  ih[7]=(W>>24)&0xFF;
    ih[8]=negH&0xFF;ih[9]=(negH>>8)&0xFF;ih[10]=(negH>>16)&0xFF;ih[11]=(negH>>24)&0xFF;
    ih[12]=1; ih[14]=8; // planes=1, bpp=8
    fwrite(ih,1,40,f);
    // Grayscale palette
    for(int i=0;i<256;i++){ uint8_t e[4]={(uint8_t)i,(uint8_t)i,(uint8_t)i,0}; fwrite(e,1,4,f); }
    // Pixels
    std::vector<uint8_t> row(rowStride,0);
    for(int y=0;y<H;y++){
        for(int x=0;x<W;x++) row[x]=isBinary?(px[y*W+x]?255:0):px[y*W+x];
        fwrite(row.data(),1,rowStride,f);
    }
    fclose(f);
    fprintf(stderr,"[HV-DBG] saved %s\n",path);
}

// Save float image (normalised to 0-255)
static void dbgSaveFloat(const char* name, const std::vector<float>& d, int W, int H){
    if(d.empty()) return;
    float mn=*std::min_element(d.begin(),d.end());
    float mx=*std::max_element(d.begin(),d.end());
    float rng=std::max(mx-mn,1e-9f);
    std::vector<uint8_t> u8(W*H);
    for(int i=0;i<W*H;i++) u8[i]=(uint8_t)std::clamp((int)((d[i]-mn)/rng*255.f),0,255);
    dbgSaveBmp(name,u8.data(),W,H,false);
}

// Save binary mask with coloured tip crosshairs (4 corners drawn in white/black)
static void dbgSaveResult(const char* name, const uint8_t* boundary, int W, int H,
                           double tTx,double tTy,double tRx,double tRy,
                           double tBx,double tBy,double tLx,double tLy,
                           double bcx,double bcy){
    dbgInit();
    char path[512]; snprintf(path,sizeof(path),"%s\\%s",DBG_DIR,name);
    FILE* f=fopen(path,"wb"); if(!f) return;
    // Build pixel buffer: boundary=128, background=0
    std::vector<uint8_t> px(W*H,0);
    for(int i=0;i<W*H;i++) if(boundary[i]) px[i]=128;
    // Draw 9-pixel cross at each tip
    auto drawCross=[&](double tx,double ty,uint8_t col){
        int ix=(int)(tx+0.5),iy=(int)(ty+0.5);
        for(int d=-5;d<=5;d++){
            if(ix+d>=0&&ix+d<W&&iy>=0&&iy<H) px[iy*W+ix+d]=col;
            if(iy+d>=0&&iy+d<H&&ix>=0&&ix<W) px[(iy+d)*W+ix]=col;
        }
    };
    drawCross(tTx,tTy,255); drawCross(tRx,tRy,255);
    drawCross(tBx,tBy,255); drawCross(tLx,tLy,255);
    drawCross(bcx,bcy,200);
    dbgSaveBmp(name,px.data(),W,H,false);
    fclose(f);
    fprintf(stderr,"[HV-DBG] saved result %s\n",path);
}

// ─────────────────────────────────────────────────────────────────
//  VICKERS DIAMOND DETECTOR  (single-path, line-fitting algorithm)
//
//  Algorithm:
//  1a. Grayscale decode
//  1b. Local illumination normalisation (box R=50) — flattens scratch contrast
//  1c. Grayscale morphological closing (R=21) — suppresses narrow scratch troughs
//  2.  Gaussian blur 11×11 of scratch-free image
//  3.  Adaptive threshold (R=H/8, k=0.18) → binary dark mask
//  4.  Morphological closing (R = min(blobR*0.15, H/10)) + fillHoles
//      fills the specular-reflection hole at the indentation centre
//  5.  Blob detection → select best blob (closest to image centre, good aspect)
//  6.  Outer boundary of filled blob
//  7.  Quadrant line fitting: divide boundary into 4 diagonal quadrants
//      (UL/UR/LR/LL relative to centroid), fit LSQ line per quadrant,
//      intersect adjacent lines → 4 tips (T, R, B, L)
//      Fallback: farthest boundary pixel in ±38° cone if fitting fails
//  8.  Sub-pixel gradient refinement at each tip (uses fine 5×5 blur)
//  9.  Aspect-ratio validation (min ratio 0.45)
//  Returns 4 corner pixel coords + image dims for frontend overlay.
// ─────────────────────────────────────────────────────────────────
struct DetectResult{
    bool   ok=false;
    double cx=0,cy=0,hD1=0,hD2=0,conf=0;
    // 4 diamond corner tips (pixels in original image)
    double tipLx=0,tipLy=0;  // left  tip (min-x)
    double tipRx=0,tipRy=0;  // right tip (max-x)
    double tipTx=0,tipTy=0;  // top   tip (min-y)
    double tipBx=0,tipBy=0;  // bottom tip (max-y)
    int    imgW=0,imgH=0;
};

static DetectResult detectVickers(const std::vector<uint8_t>& jpg,
                                   double /*t1*/=0, double /*t2*/=0){
    DetectResult res;
    if(jpg.empty()) return res;

    int W=0, H=0;
    std::vector<uint8_t> gray;

    // Detect frame format from magic bytes and decode to grayscale.
    // Camera may output JPEG (FF D8) or BMP (42 4D "BM") depending on sensor type.
    {
        uint8_t b0=jpg.size()>0?jpg[0]:0, b1=jpg.size()>1?jpg[1]:0;
        uint8_t b2=jpg.size()>2?jpg[2]:0, b3=jpg.size()>3?jpg[3]:0;
        fprintf(stderr,"[HV] input: %zu bytes  magic=%02X %02X %02X %02X\n",
                (size_t)jpg.size(), b0,b1,b2,b3);
        // Save raw bytes for offline inspection
        dbgInit();
        char rawPath[512]; snprintf(rawPath,sizeof(rawPath),"%s\\00_raw_frame.bin",DBG_DIR);
        if(FILE* rf=fopen(rawPath,"wb")){
            fwrite(jpg.data(),1,jpg.size(),rf); // full frame
            fclose(rf);
            fprintf(stderr,"[HV] raw frame (%zu bytes) saved to %s\n",jpg.size(),rawPath);
        }
    }

    if(jpg.size()>=2 && jpg[0]==0x42 && jpg[1]==0x4D){
        fprintf(stderr,"[HV] format: BMP\n");
        gray = decodeGrayBmp(jpg.data(), jpg.size(), W, H);
    } else if(jpg.size()>=2 && jpg[0]==0xFF && jpg[1]==0xD8){
        fprintf(stderr,"[HV] format: JPEG\n");
        gray = TinyJpeg::decodeGray(jpg.data(), jpg.size(), W, H);
    } else {
        fprintf(stderr,"[HV] FAIL: unknown format (magic=%02X %02X)\n",
                jpg.size()>0?jpg[0]:0, jpg.size()>1?jpg[1]:0);
        return res;
    }
    fprintf(stderr,"[HV] decode: W=%d H=%d empty=%d\n", W, H, (int)gray.empty());
    if(gray.empty() || W<=0 || H<=0){ fprintf(stderr,"[HV] FAIL: decode returned empty\n"); return res; }
    res.imgW=W; res.imgH=H;
    dbgSaveBmp("01_gray.bmp", gray.data(), W, H, false);

    const int N = W*H;
    const double fcx=W*.5, fcy=H*.5, dg=std::hypot(W,H);

    // ── Step 1a: Local illumination normalisation (R=50) ─────────────
    // Divide each pixel by its 101×101 neighbourhood mean.  This radius is
    // chosen to span several scratch periods (~20 px) so scratch-trough/peak
    // contrast is flattened without smearing the diamond (hundreds of px wide).
    gray = normalizeIllum(gray, W, H, 50);
    dbgSaveBmp("01b_illum_norm.bmp", gray.data(), W, H, false);

    // ── Step 1b: Scratch suppression (grayscale closing, R=21) ───────
    // Grinding/polishing marks produce narrow dark troughs (~15-30 px).
    // A grayscale morphological closing with R=21 fills those troughs while
    // preserving larger dark regions such as the diamond faces.
    auto scratchFree = grayMorphCloseR(gray, W, H, 21);
    dbgSaveBmp("02_scratch_free.bmp", scratchFree.data(), W, H, false);
    fprintf(stderr,"[HV] scratchFree done\n");

    // ── Step 1c: Fine blur for sub-pixel refinement (uses norm gray) ─
    auto b5  = gblur5(gray.data(), W, H);   // kept for subpixelRefine only

    // ── Step 2: Smooth scratch-free image for threshold ───────────────
    auto b11 = gblur11(scratchFree.data(), W, H);
    dbgSaveFloat("03_b11.bmp", b11, W, H);

    // ── Step 3: Adaptive threshold ────────────────────────────────────
    // With scratches suppressed the surface is nearly uniform; R=H/8 provides
    // a neighbourhood large enough to capture gradual vignette variation while
    // k=0.18 targets only genuinely dark regions (diamond faces, not residual
    // noise).
    const int adaptR = std::max(60, H/8);   // ~256 px for 2048p
    const float adaptK = 0.18f;             // 18% darker than local mean
    auto binCoarse = adaptiveThreshBox(b11, W, H, adaptR, adaptK);
    fprintf(stderr,"[HV] adaptiveThresh: R=%d k=%.2f  white=%d (%.1f%%)\n",
            adaptR, adaptK,
            (int)std::count(binCoarse.begin(),binCoarse.end(),(uint8_t)1),
            100.0*std::count(binCoarse.begin(),binCoarse.end(),(uint8_t)1)/N);
    dbgSaveBmp("04_bin_coarse.bmp", binCoarse.data(), W, H, true);

    auto clCoarse = fillHoles(close15(binCoarse, W, H), W, H);
    dbgSaveBmp("05_cl_coarse.bmp", clCoarse.data(), W, H, true);

    auto bls = findBlobs(clCoarse, W, H, (int)(N*.0005), (int)(N*.35));
    fprintf(stderr,"[HV] blobs found=%d  (min=%d max=%d)\n",
            (int)bls.size(), (int)(N*.0005), (int)(N*.35));
    for(int i=0;i<(int)bls.size()&&i<8;i++){
        double asp_i=(double)std::min(bls[i].bw,bls[i].bh)/std::max(bls[i].bw,bls[i].bh);
        fprintf(stderr,"[HV]   blob[%d] cx=%.0f cy=%.0f area=%d bw=%d bh=%d asp=%.3f\n",
                i,bls[i].cx,bls[i].cy,bls[i].area,bls[i].bw,bls[i].bh,asp_i);
    }

    double cx=fcx, cy=fcy, blobR=std::min(W,H)*0.10, bst=-1;
    for(auto& b : bls){
        if(b.bw<3||b.bh<3) continue;
        double asp = (double)std::min(b.bw,b.bh)/std::max(b.bw,b.bh);
        // Reject blobs that are clearly not a diamond indentation:
        //   • Too elongated (horizontal band / vignette border): asp < 0.15
        //   • At the image edge (cy within 8% of top or bottom): camera border artefact
        //   • At the image edge in X
        if(asp < 0.15) continue;
        if(b.cy < H*0.08 || b.cy > H*0.92) continue;
        if(b.cx < W*0.04 || b.cx > W*0.96) continue;
        double dist = std::hypot(b.cx-fcx, b.cy-fcy)/dg;
        double sc   = b.area*asp*asp*std::exp(-dist*3.0);
        if(sc>bst){ bst=sc; cx=b.cx; cy=b.cy;
                    blobR=std::hypot((double)b.bw,(double)b.bh)*0.55; }
    }
    // If no acceptable blob found, log and return — don't proceed with nonsense centre
    if(bst < 0){
        fprintf(stderr,"[HV] FAIL: no valid blob passed quality filters "
                       "(all blobs too elongated or at image edge)\n");
        return res;
    }
    // Cap blobR to a reasonable fraction of the image so closeR stays sane
    blobR = std::min(blobR, std::min(W,H)*0.30);
    fprintf(stderr,"[HV] centre: cx=%.1f cy=%.1f blobR=%.1f (score=%.1f)\n", cx, cy, blobR, bst);

    const double minPx = std::min(W,H) * 0.015;
    const double maxPx = std::min(W,H) * 0.85;

    // ── Step 4: Morphological closing of coarse binary mask ───────────
    // closeR fills the specular-reflection hole at the diamond centre.
    // Capped at H/10 to prevent the large-R all-white collapse when the
    // binary image still has background noise.
    int closeR = std::max(9, std::min((int)(blobR*0.15), H/10));
    fprintf(stderr,"[HV] morphCloseR: R=%d\n", closeR);
    auto filled = morphCloseR(binCoarse, W, H, closeR);
    dbgSaveBmp("06_filled.bmp", filled.data(), W, H, true);

    // ── Step 4: Pick best filled blob (closest to coarse centre) ────
    auto fillBlobs = findBlobs(filled, W, H, (int)(N*0.0003), (int)(N*0.40));
    fprintf(stderr,"[HV] fillBlobs=%d  (min=%d max=%d)\n",
            (int)fillBlobs.size(), (int)(N*0.0003), (int)(N*0.40));
    if(fillBlobs.empty()){ fprintf(stderr,"[HV] FAIL: no fill blobs\n"); return res; }
    Blob bestB = fillBlobs[0];
    double bestBD = std::hypot(bestB.cx-cx, bestB.cy-cy);
    for(auto& b : fillBlobs){
        double d=std::hypot(b.cx-cx,b.cy-cy); if(d<bestBD){ bestBD=d; bestB=b; }
    }
    double bcx=bestB.cx, bcy=bestB.cy;
    fprintf(stderr,"[HV] bestFillBlob: cx=%.1f cy=%.1f area=%d bw=%d bh=%d dist=%.1f\n",
            bcx,bcy,bestB.area,bestB.bw,bestB.bh,bestBD);

    // ── Step 5: Outer boundary pixels of filled blob ─────────────────
    auto boundary = maskBoundaryEdge(filled, W, H);
    dbgSaveBmp("07_boundary.bmp", boundary.data(), W, H, true);

    double searchR2 = std::max(minPx*1.5, std::min(blobR*1.9, (double)std::min(W,H)*0.47));
    fprintf(stderr,"[HV] searchR2=%.1f minPx=%.1f maxPx=%.1f\n", searchR2, minPx, maxPx);
    struct Pt{ int x,y; };
    std::vector<Pt> bndPts;
    bndPts.reserve(8192);
    for(int y=std::max(1,(int)(bcy-searchR2)); y<std::min(H-1,(int)(bcy+searchR2)); y++)
        for(int x=std::max(1,(int)(bcx-searchR2)); x<std::min(W-1,(int)(bcx+searchR2)); x++){
            if(!boundary[y*W+x]) continue;
            double ddx=x-bcx, ddy=y-bcy;
            if(ddx*ddx+ddy*ddy <= searchR2*searchR2) bndPts.push_back({x,y});
        }
    fprintf(stderr,"[HV] bndPts=%d\n", (int)bndPts.size());
    if((int)bndPts.size() < 16){ fprintf(stderr,"[HV] FAIL: too few boundary pts\n"); return res; }

    // ── Step 7a: Quadrant line fitting → tip intersection ────────────
    // Divide boundary into 4 diagonal quadrants relative to blob centroid.
    // Each quadrant holds one side of the Vickers diamond.
    // Fit PCA line per quadrant, intersect adjacent lines = 4 tips.
    std::vector<Pt> qUL,qUR,qLR,qLL;
    for(auto& p : bndPts){
        double ddx=p.x-bcx, ddy=p.y-bcy;
        if(ddx<=0&&ddy<=0) qUL.push_back(p);
        else if(ddx>=0&&ddy<=0) qUR.push_back(p);
        else if(ddx>=0&&ddy>=0) qLR.push_back(p);
        else                    qLL.push_back(p);
    }
    struct LineFit{ double a=0,b=0,c=0; bool ok=false; };
    auto fitLine=[](const std::vector<Pt>& q)->LineFit{
        LineFit lf; if((int)q.size()<4) return lf;
        double mx=0,my=0;
        for(auto& p:q){ mx+=p.x; my+=p.y; } mx/=q.size(); my/=q.size();
        double sxx=0,sxy=0,syy=0;
        for(auto& p:q){ double dx=p.x-mx,dy=p.y-my; sxx+=dx*dx; sxy+=dx*dy; syy+=dy*dy; }
        // PCA line fit: find eigenvector for the MINIMUM eigenvalue of the
        // 2×2 covariance matrix — this is the line NORMAL (perpendicular to the
        // principal axis / line direction).
        // For eigenvalue λ_min the eigenvector satisfies (M - λI)v = 0:
        //   (sxx-λ)*nx + sxy*ny = 0  →  [nx,ny] = [-sxy, sxx-λ]
        double tr=sxx+syy, det=sxx*syy-sxy*sxy;
        double disc=std::sqrt(std::max(0.0,tr*tr*0.25-det));
        double lam=tr*0.5-disc;              // smaller (minimum) eigenvalue
        double nx=-sxy, ny=sxx-lam;          // line normal (⊥ to line direction)
        double nlen=std::hypot(nx,ny);
        if(nlen<1e-9) return lf;
        nx/=nlen; ny/=nlen;
        lf.a=nx; lf.b=ny; lf.c=nx*mx+ny*my; lf.ok=true; return lf;
    };
    auto intersect=[](const LineFit& l1,const LineFit& l2,double& xi,double& yi)->bool{
        double det=l1.a*l2.b-l2.a*l1.b;
        if(std::abs(det)<1e-9) return false;
        xi=(l1.c*l2.b-l2.c*l1.b)/det; yi=(l1.a*l2.c-l2.a*l1.c)/det; return true;
    };
    fprintf(stderr,"[HV] quadrants: UL=%d UR=%d LR=%d LL=%d\n",
            (int)qUL.size(),(int)qUR.size(),(int)qLR.size(),(int)qLL.size());

    auto lUL=fitLine(qUL), lUR=fitLine(qUR), lLR=fitLine(qLR), lLL=fitLine(qLL);
    fprintf(stderr,"[HV] lineFit: UL=%d UR=%d LR=%d LL=%d\n",
            lUL.ok,lUR.ok,lLR.ok,lLL.ok);
    if(lUL.ok) fprintf(stderr,"[HV]   lUL: a=%.4f b=%.4f c=%.2f\n",lUL.a,lUL.b,lUL.c);
    if(lUR.ok) fprintf(stderr,"[HV]   lUR: a=%.4f b=%.4f c=%.2f\n",lUR.a,lUR.b,lUR.c);
    if(lLR.ok) fprintf(stderr,"[HV]   lLR: a=%.4f b=%.4f c=%.2f\n",lLR.a,lLR.b,lLR.c);
    if(lLL.ok) fprintf(stderr,"[HV]   lLL: a=%.4f b=%.4f c=%.2f\n",lLL.a,lLL.b,lLL.c);

    double tTx=0,tTy=0,tRx=0,tRy=0,tBx=0,tBy=0,tLx=0,tLy=0;
    bool intOk[4]={false,false,false,false};
    if(lUL.ok&&lUR.ok) intOk[0]=intersect(lUL,lUR,tTx,tTy);
    if(lUR.ok&&lLR.ok) intOk[1]=intersect(lUR,lLR,tRx,tRy);
    if(lLR.ok&&lLL.ok) intOk[2]=intersect(lLR,lLL,tBx,tBy);
    if(lLL.ok&&lUL.ok) intOk[3]=intersect(lLL,lUL,tLx,tLy);
    bool lineFitOk=lUL.ok&&lUR.ok&&lLR.ok&&lLL.ok&&intOk[0]&&intOk[1]&&intOk[2]&&intOk[3];
    fprintf(stderr,"[HV] intersect: T=(%.1f,%.1f)ok=%d  R=(%.1f,%.1f)ok=%d  "
                   "B=(%.1f,%.1f)ok=%d  L=(%.1f,%.1f)ok=%d\n",
            tTx,tTy,intOk[0], tRx,tRy,intOk[1], tBx,tBy,intOk[2], tLx,tLy,intOk[3]);

    // ── Step 7b: Cone fallback ────────────────────────────────────────
    auto inRange=[&](double x,double y)->bool{
        double d=std::hypot(x-bcx,y-bcy);
        return x>=1&&x<W-1&&y>=1&&y<H-1 && d>minPx && d<maxPx
            && std::abs(x-bcx)<searchR2 && std::abs(y-bcy)<searchR2;
    };
    if(!lineFitOk||!inRange(tTx,tTy)||!inRange(tRx,tRy)||!inRange(tBx,tBy)||!inRange(tLx,tLy)){
        fprintf(stderr,"[HV] lineFit failed/OOB — using cone fallback\n");
        const double cosLim=std::cos(38.0*M_PI/180.0);
        auto coneTip=[&](double dX,double dY)->std::pair<double,double>{
            double bestD=-1; double bpx=bcx,bpy=bcy;
            for(auto& p:bndPts){
                double dx=p.x-bcx,dy=p.y-bcy,len=std::hypot(dx,dy);
                if(len<1) continue;
                if((dx*dX+dy*dY)/len < cosLim) continue;
                if(len>bestD){ bestD=len; bpx=p.x; bpy=p.y; }
            }
            return {bpx,bpy};
        };
        auto [ax,ay]=coneTip( 0,-1); tTx=ax; tTy=ay;
        auto [bx,by]=coneTip( 1, 0); tRx=bx; tRy=by;
        auto [cx2,cy2]=coneTip( 0, 1); tBx=cx2; tBy=cy2;
        auto [dx2,dy2]=coneTip(-1, 0); tLx=dx2; tLy=dy2;
        fprintf(stderr,"[HV] cone: T=(%.1f,%.1f) R=(%.1f,%.1f) B=(%.1f,%.1f) L=(%.1f,%.1f)\n",
                tTx,tTy,tRx,tRy,tBx,tBy,tLx,tLy);
    }

    fprintf(stderr,"[HV] inRange: T=%d R=%d B=%d L=%d\n",
            inRange(tTx,tTy),inRange(tRx,tRy),inRange(tBx,tBy),inRange(tLx,tLy));
    fprintf(stderr,"[HV] direction: tTy<bcy=%d tBy>bcy=%d tLx<bcx=%d tRx>bcx=%d\n",
            tTy<bcy,tBy>bcy,tLx<bcx,tRx>bcx);

    if(!inRange(tTx,tTy)||!inRange(tRx,tRy)||!inRange(tBx,tBy)||!inRange(tLx,tLy)){
        fprintf(stderr,"[HV] FAIL: tips out of range\n"); return res;
    }
    if(tTy>=bcy||tBy<=bcy||tLx>=bcx||tRx<=bcx){
        fprintf(stderr,"[HV] FAIL: tips in wrong direction\n"); return res;
    }

    // ── Step 8: Sub-pixel gradient refinement at each tip ────────────
    {
        int spWin=std::clamp((int)(blobR*0.08),3,8);
        subpixelRefine(b5,W,H,tLx,tLy,spWin);
        subpixelRefine(b5,W,H,tRx,tRy,spWin);
        subpixelRefine(b5,W,H,tTx,tTy,spWin);
        subpixelRefine(b5,W,H,tBx,tBy,spWin);
    }

    // ── Step 9: Validate and fill result ────────────────────────────
    double hD1=std::hypot(tRx-tLx,tRy-tLy)*0.5;
    double hD2=std::hypot(tBx-tTx,tBy-tTy)*0.5;
    fprintf(stderr,"[HV] hD1=%.1f hD2=%.1f minPx=%.1f\n",hD1,hD2,minPx);
    if(hD1<minPx||hD2<minPx){ fprintf(stderr,"[HV] FAIL: diagonals too small\n"); return res; }
    double ratio=std::min(hD1,hD2)/std::max(hD1,hD2);
    fprintf(stderr,"[HV] ratio=%.3f (need>=0.45)\n",ratio);
    if(ratio<0.45){ fprintf(stderr,"[HV] FAIL: ratio too low\n"); return res; }

    // Save debug result overlay
    dbgSaveResult("08_result.bmp",boundary.data(),W,H,
                  tTx,tTy,tRx,tRy,tBx,tBy,tLx,tLy,bcx,bcy);

    res.cx  =(tLx+tRx+tTx+tBx)*0.25;
    res.cy  =(tLy+tRy+tTy+tBy)*0.25;
    res.hD1 =hD1; res.hD2=hD2;
    res.tipLx=tLx; res.tipLy=tLy;
    res.tipRx=tRx; res.tipRy=tRy;
    res.tipTx=tTx; res.tipTy=tTy;
    res.tipBx=tBx; res.tipBy=tBy;
    res.conf =std::clamp(ratio*0.95,0.0,1.0);
    res.ok   =true;
    fprintf(stderr,"[HV] SUCCESS: hD1=%.1f hD2=%.1f conf=%.3f\n",hD1,hD2,res.conf);
    return res;
}
// ─────────────────────────────────────────────────
//  Base64 encoder
// ─────────────────────────────────────────────────
static const char B64C[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static std::string b64enc(const unsigned char* buf,size_t len){
    std::string r; r.reserve(((len+2)/3)*4);
    for(size_t i=0;i<len;i+=3){
        unsigned b=(buf[i]<<16)|(i+1<len?buf[i+1]<<8:0)|(i+2<len?buf[i+2]:0);
        r+=B64C[(b>>18)&0x3F]; r+=B64C[(b>>12)&0x3F];
        r+=(i+1<len)?B64C[(b>>6)&0x3F]:'=';
        r+=(i+2<len)?B64C[b&0x3F]:'=';}
    return r;}

// ─────────────────────────────────────────────────
//  HikRobot Camera class
// ─────────────────────────────────────────────────
class HikrobotCamera {
public:
    HikrobotCamera()
        :m_handle(nullptr),m_isOpen(false),m_isGrabbing(false),
         m_grabRunning(false),m_hasFrame(false),m_lastGrabRet(MV_OK),m_lastSaveRet(MV_OK),m_lastPixelType(0)
    { MV_CC_Initialize(); }

    ~HikrobotCamera(){ stopGrabbing(); closeDevice(); MV_CC_Finalize(); }

    // ── Device management ─────────────────────────────────────────
    std::vector<DeviceInfo> enumDevices(){
        std::vector<DeviceInfo> out;
        MV_CC_DEVICE_INFO_LIST list; memset(&list,0,sizeof(list));
        std::string err;
        if(!fetchDeviceList(list, err)) { if(!err.empty()) setErr(err); return out; }
        for(unsigned i=0;i<list.nDeviceNum;i++){
            MV_CC_DEVICE_INFO* p=list.pDeviceInfo[i];
            DeviceInfo d; d.index=i;
            if(!p) continue;
            unsigned int tl = p->nTLayerType;
            if(tl==MV_USB_DEVICE || tl==MV_VIR_USB_DEVICE){
                d.deviceType=1;
                d.model=(char*)p->SpecialInfo.stUsb3VInfo.chModelName;
                d.serial=(char*)p->SpecialInfo.stUsb3VInfo.chSerialNumber;
            }else{
                d.deviceType=2;
                d.model=(char*)p->SpecialInfo.stGigEInfo.chModelName;
                d.serial=(char*)p->SpecialInfo.stGigEInfo.chSerialNumber;
                unsigned ip=p->SpecialInfo.stGigEInfo.nCurrentIp;
                std::ostringstream ss;
                ss<<((ip>>24)&0xFF)<<"."<<((ip>>16)&0xFF)<<"."<<((ip>>8)&0xFF)<<"."<<(ip&0xFF);
                d.ipAddress=ss.str();}
            if(d.model.empty()) d.model = "Hikrobot Camera";
            out.push_back(d);}
        return out;}

    bool openDevice(unsigned index=0){
        if(m_isOpen)closeDevice();
        MV_CC_DEVICE_INFO_LIST list; memset(&list,0,sizeof(list));
        std::string enumErr;
        if(!fetchDeviceList(list, enumErr)){setErr(enumErr.empty() ? "No cameras found" : enumErr);return false;}
        if(index>=list.nDeviceNum){setErr("Camera index out of range");return false;}
        int ret=MV_OK;
        ret=MV_CC_CreateHandle(&m_handle,list.pDeviceInfo[index]);
        if(ret!=MV_OK){
            std::ostringstream ss; ss<<"CreateHandle failed (ret=0x"<<std::hex<<ret<<")";
            setErr(ss.str()); return false;
        }
        // Prefer exclusive open; if denied/busy, retry control mode.
        ret=MV_CC_OpenDevice(m_handle, MV_ACCESS_Exclusive, 0);
        if(ret==MV_E_ACCESS_DENIED || ret==MV_E_BUSY){
            ret=MV_CC_OpenDevice(m_handle, MV_ACCESS_Control, 0);
        }
        if(ret!=MV_OK){
            MV_CC_DestroyHandle(m_handle);m_handle=nullptr;
            std::ostringstream ss; ss<<"OpenDevice failed (ret=0x"<<std::hex<<ret<<")";
            setErr(ss.str()); return false;
        }
        // GigE: set optimal packet size
        if(list.pDeviceInfo[index]->nTLayerType==MV_GIGE_DEVICE){
            int pkt=MV_CC_GetOptimalPacketSize(m_handle);
            if(pkt>0) MV_CC_SetIntValueEx(m_handle,"GevSCPSPacketSize",pkt);}
        // Force free-run acquisition. If TriggerMode stays ON, grabbing can be true while /frame stays empty.
        // Keep these best-effort to support cameras that do not expose every node.
        MV_CC_SetEnumValueByString(m_handle,"TriggerMode","Off");
        MV_CC_SetEnumValue(m_handle,"TriggerMode",0);
        MV_CC_SetEnumValueByString(m_handle,"AcquisitionMode","Continuous");
        MV_CC_SetEnumValueByString(m_handle,"TriggerSource","Software");
        // Keep camera-native pixel format so PC preview matches machine color rendering.
        // Forced pixel format conversion can shift colors on some models/capture paths.
        MV_CC_DEVICE_INFO* p=list.pDeviceInfo[index];
        m_device.index=index;
        if(p->nTLayerType==MV_USB_DEVICE){
            m_device.deviceType=1;
            m_device.model=(char*)p->SpecialInfo.stUsb3VInfo.chModelName;
            m_device.serial=(char*)p->SpecialInfo.stUsb3VInfo.chSerialNumber;
        }else{
            m_device.deviceType=2;
            m_device.model=(char*)p->SpecialInfo.stGigEInfo.chModelName;
            m_device.serial=(char*)p->SpecialInfo.stGigEInfo.chSerialNumber;}

        // Set ROI to maximum sensor size so we use the full imaging area.
        // WidthMax / HeightMax are read-only registers that report the sensor
        // size regardless of current binning.  We apply them via Width/Height.
        {
            MVCC_INTVALUE_EX iv;
            unsigned wMax=0, hMax=0;
            if(MV_CC_GetIntValueEx(m_handle,"WidthMax",&iv)==MV_OK)  wMax=(unsigned)iv.nCurValue;
            if(MV_CC_GetIntValueEx(m_handle,"HeightMax",&iv)==MV_OK) hMax=(unsigned)iv.nCurValue;
            if(wMax>0 && hMax>0){
                MV_CC_SetIntValueEx(m_handle,"Width",wMax);
                MV_CC_SetIntValueEx(m_handle,"Height",hMax);
                m_params.width=wMax; m_params.height=hMax;
                fprintf(stderr,"[cam] max ROI: %u x %u\n", wMax, hMax);
            } else {
                // Fallback: read actual current Width/Height
                if(MV_CC_GetIntValueEx(m_handle,"Width",&iv)==MV_OK)  m_params.width=(unsigned)iv.nCurValue;
                if(MV_CC_GetIntValueEx(m_handle,"Height",&iv)==MV_OK) m_params.height=(unsigned)iv.nCurValue;
                fprintf(stderr,"[cam] ROI (fallback): %u x %u\n", m_params.width, m_params.height);
            }
        }
        m_isOpen=true; return true;}

    bool closeDevice(){
        if(!m_isOpen)return true;
        stopGrabbing();
        if(m_handle){MV_CC_CloseDevice(m_handle);MV_CC_DestroyHandle(m_handle);m_handle=nullptr;}
        m_isOpen=false; return true;}

    bool isOpen()  const{return m_isOpen;}
    bool isGrabbing()const{return m_isGrabbing;}

    // ── Stream control ────────────────────────────────────────────
    bool startGrabbing(){
        if(!m_isOpen){setErr("Camera not open");return false;}
        if(m_isGrabbing)return true;
        if(MV_CC_StartGrabbing(m_handle)!=MV_OK){setErr("StartGrabbing failed");return false;}
        m_frameConsumed.store(true, std::memory_order_relaxed); // ensure first frame is processed
        m_isGrabbing=m_grabRunning=true;
        m_grabThread=std::thread(&HikrobotCamera::grabLoop,this);
        return true;}

    bool stopGrabbing(){
        if(!m_isGrabbing)return true;
        m_grabRunning=false;
        if(m_grabThread.joinable())m_grabThread.join();
        if(m_handle)MV_CC_StopGrabbing(m_handle);
        m_frameConsumed.store(true, std::memory_order_relaxed); // reset for next start
        m_isGrabbing=false; return true;}

    bool getLatestFrame(FrameData& out){
        if(!m_hasFrame)return false;
        std::lock_guard<std::mutex> lk(m_mutex);
        out=m_latestFrame;
        m_frameConsumed.store(true, std::memory_order_relaxed);
        return true;}

    bool hasFrame() const { return m_hasFrame; }
    int  getLastGrabRet() const { return m_lastGrabRet.load(); }
    int  getLastSaveRet() const { return m_lastSaveRet.load(); }
    unsigned int getLastPixelType() const { return m_lastPixelType.load(); }

    // ── Settings — matches CameraPage POST /settings ──────────────
    // Accepts: exposure_us, gain_db, gamma, contrast, black_level,
    //          resolution ("2592×1944","1920×1080","User"),
    //          res_mode   ("Normal","Bin2","Sum2","Skip2")
    bool applySettings(const CameraParams& p){
        if(!m_isOpen)return false;
        // Exposure
        MV_CC_SetEnumValue(m_handle,"ExposureAuto",0);
        MV_CC_SetFloatValue(m_handle,"ExposureTime",p.exposureUs);
        // Gain
        MV_CC_SetEnumValue(m_handle,"GainAuto",0);
        MV_CC_SetFloatValue(m_handle,"Gain",p.gainDb);
        // Gamma
        MV_CC_SetBoolValue(m_handle,"GammaEnable",true);
        MV_CC_SetFloatValue(m_handle,"Gamma",p.gamma);
        // Contrast / brightness mapped to BlackLevel
        MV_CC_SetFloatValue(m_handle,"BlackLevel",p.blackLevel);
        // Resolution
        if(p.width>0&&p.height>0){
            // Stop grabbing briefly to change resolution
            bool wasGrabbing=m_isGrabbing;
            if(wasGrabbing){MV_CC_StopGrabbing(m_handle);m_isGrabbing=false;}
            MV_CC_SetIntValueEx(m_handle,"Width",p.width);
            MV_CC_SetIntValueEx(m_handle,"Height",p.height);
            // Resolution mode (binning/decimation)
            if(p.resMode=="Bin2"){
                MV_CC_SetEnumValueByString(m_handle,"BinningHorizontal","2");
                MV_CC_SetEnumValueByString(m_handle,"BinningVertical","2");
            }else if(p.resMode=="Sum2"){
                MV_CC_SetEnumValueByString(m_handle,"DecimationHorizontal","2");
                MV_CC_SetEnumValueByString(m_handle,"DecimationVertical","2");
            }else{
                MV_CC_SetEnumValueByString(m_handle,"BinningHorizontal","1");
                MV_CC_SetEnumValueByString(m_handle,"BinningVertical","1");}
            if(wasGrabbing){MV_CC_StartGrabbing(m_handle);m_isGrabbing=true;}}
        m_params=p;
        return true;}

    bool getParams(CameraParams& p){
        if(!m_isOpen)return false;
        MVCC_FLOATVALUE fv; MVCC_INTVALUE_EX iv;
        if(MV_CC_GetFloatValue(m_handle,"ExposureTime",&fv)==MV_OK) p.exposureUs=fv.fCurValue;
        if(MV_CC_GetFloatValue(m_handle,"Gain",&fv)==MV_OK)         p.gainDb=fv.fCurValue;
        if(MV_CC_GetFloatValue(m_handle,"Gamma",&fv)==MV_OK)        p.gamma=fv.fCurValue;
        if(MV_CC_GetFloatValue(m_handle,"BlackLevel",&fv)==MV_OK)   p.blackLevel=fv.fCurValue;
        if(MV_CC_GetIntValueEx(m_handle,"Width",&iv)==MV_OK)        p.width=(unsigned)iv.nCurValue;
        if(MV_CC_GetIntValueEx(m_handle,"Height",&iv)==MV_OK)       p.height=(unsigned)iv.nCurValue;
        return true;}

    // ── Measure HV — called from POST /capture ────────────────────
    // Returns d1_mm, d2_mm, hv, confidence matching CameraPage expectations
    MeasureResult measureHV(double pxPerMm,double loadKgf,double t1=0,double t2=0){
        MeasureResult r; r.px_per_mm=pxPerMm;
        if(!m_isGrabbing){r.error="Camera not streaming";return r;}
        if(pxPerMm<=0){r.error="Invalid px/mm — calibrate first";return r;}
        if(loadKgf<=0){r.error="Invalid load (kgf)";return r;}
        // Wait up to 2 seconds for a fresh frame
        FrameData fr;
        for(int i=0;i<20&&!getLatestFrame(fr);i++)
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        if(fr.jpeg.empty()){r.error="No frame available";return r;}
        DetectResult det=detectVickers(fr.jpeg,t1,t2);
        if(!det.ok){r.error="Edge detection failed — check focus and exposure";return r;}
        // Convert pixels → mm
        r.d1_mm  = (det.hD1*2.)/pxPerMm;
        r.d2_mm  = (det.hD2*2.)/pxPerMm;
        r.d_mean_mm = (r.d1_mm+r.d2_mm)*.5;
        // HV formula: HV = 1.8544 × F(kgf) / d²(mm²)
        if(r.d_mean_mm>0)
            r.hv=1.8544*loadKgf/(r.d_mean_mm*r.d_mean_mm);
        r.confidence=det.conf;
        // Normalised overlay coordinates (0-1 of original image)
        if(det.imgW>0 && det.imgH>0){
            r.img_w  = det.imgW; r.img_h = det.imgH;
            double iW=det.imgW, iH=det.imgH;
            r.cx_frac = det.cx   / iW;  r.cy_frac = det.cy   / iH;
            r.lx_frac = det.tipLx/ iW;  r.ly_frac = det.tipLy/ iH;
            r.rx_frac = det.tipRx/ iW;  r.ry_frac = det.tipRy/ iH;
            r.tx_frac = det.tipTx/ iW;  r.ty_frac = det.tipTy/ iH;
            r.bx_frac = det.tipBx/ iW;  r.by_frac = det.tipBy/ iH;
        }
        r.success=true;
        return r;}

    // ── Calibrate ─────────────────────────────────────────────────
    CalibResult calibrate(double refHV,double loadKgf){
        CalibResult r;
        MeasureResult m=measureHV(100.,loadKgf);
        if(!m.success){r.message=m.error;return r;}
        double d_um=std::sqrt(1854.4*loadKgf/refHV);
        double pxPerMm=(m.d_mean_mm*100.)/(d_um/1000.);
        double measHV=1.8544*loadKgf/(m.d_mean_mm*m.d_mean_mm);
        r.success=true; r.px_per_mm=pxPerMm;
        r.offset_hv=refHV-measHV;
        r.measured_hv=measHV;
        r.error_pct=(measHV-refHV)/refHV*100.;
        r.message="OK";
        return r;}

    std::string getLastError()  const{return m_lastError;}
    DeviceInfo  getCurrentDevice()const{return m_device;}
    std::string getSDKVersion() const{
        unsigned v=MV_CC_GetSDKVersion();
        std::ostringstream ss;
        ss<<((v>>24)&0xFF)<<"."<<((v>>16)&0xFF)<<"."<<((v>>8)&0xFF)<<"."<<(v&0xFF);
        return ss.str();}

    // Resolution string → width/height (matches CameraPage RESOLUTIONS array)
    static void parseResolution(const std::string& res,unsigned& w,unsigned& h){
        // Format: "WIDTHxHEIGHT" or "WIDTH×HEIGHT"
        w=0;h=0;
        size_t sep=res.find('×');
        if(sep==std::string::npos) sep=res.find('x');
        if(sep==std::string::npos) return;
        try{w=(unsigned)std::stoul(res.substr(0,sep));
            h=(unsigned)std::stoul(res.substr(sep+sizeof(char)));}
        catch(...){w=0;h=0;}}

private:
    bool fetchDeviceList(MV_CC_DEVICE_INFO_LIST& list, std::string& err){
        struct EnumTry { unsigned int mask; const char* name; };
        const EnumTry tries[] = {
            { MV_USB_DEVICE | MV_GIGE_DEVICE, "USB|GigE" },
            { MV_USB_DEVICE, "USB" },
            { MV_GIGE_DEVICE, "GigE" },
            { MV_GIGE_DEVICE | MV_USB_DEVICE | MV_CAMERALINK_DEVICE |
              MV_VIR_GIGE_DEVICE | MV_VIR_USB_DEVICE |
              MV_GENTL_GIGE_DEVICE | MV_GENTL_CAMERALINK_DEVICE |
              MV_GENTL_CXP_DEVICE | MV_GENTL_XOF_DEVICE | MV_GENTL_VIR_DEVICE, "All" },
        };

        int lastRet = MV_OK;
        unsigned int usedMask = 0;
        for(const auto& t : tries){
            memset(&list,0,sizeof(list));
            int ret = MV_CC_EnumDevices(t.mask, &list);
            lastRet = ret;
            usedMask = t.mask;
            if(ret==MV_OK && list.nDeviceNum>0) return true;
        }
        std::ostringstream ss;
        ss<<"No cameras found (Enum ret=0x"<<std::hex<<lastRet<<", mask=0x"<<usedMask<<")";
        err = ss.str();
        return false;
    }

    void* m_handle;
    std::atomic<bool> m_isOpen,m_isGrabbing,m_grabRunning,m_hasFrame;
    std::string  m_lastError;
    DeviceInfo   m_device;
    CameraParams m_params;
    std::mutex   m_mutex;
    FrameData    m_latestFrame;
    std::thread  m_grabThread;
    std::atomic<int> m_lastGrabRet, m_lastSaveRet;
    std::atomic<unsigned int> m_lastPixelType;
    // Pre-allocated conversion buffers — reused across frames to avoid per-frame heap churn.
    // Only accessed from the grab thread (no locking needed).
    std::vector<unsigned char> m_bmpBuf;
    std::vector<unsigned char> m_bgrBuf;
    // Set to true by getLatestFrame after the caller reads a frame.
    // The grab loop skips the expensive BMP conversion until the previous frame is consumed,
    // but always calls MV_CC_FreeImageBuffer to keep the camera's internal ring buffer drained.
    std::atomic<bool> m_frameConsumed{true};

    void grabLoop(){
        MV_FRAME_OUT fr;
        int missCount = 0;
        while(m_grabRunning){
            memset(&fr,0,sizeof(fr));
            int gret = MV_CC_GetImageBuffer(m_handle,&fr,100);
            m_lastGrabRet = gret;
            if(gret==MV_OK){
                m_lastPixelType = (unsigned int)fr.stFrameInfo.enPixelType;
                // Only run the expensive BMP conversion when the consumer has read the
                // previous frame. The camera's internal ring buffer is always drained by
                // MV_CC_FreeImageBuffer regardless, so the camera never stalls.
                if(m_frameConsumed.load(std::memory_order_relaxed)){
                    FrameData fd;
                    if(toJpeg(fr,fd)){
                        std::lock_guard<std::mutex> lk(m_mutex);
                        m_latestFrame=std::move(fd);
                        m_hasFrame=true;
                        m_frameConsumed.store(false, std::memory_order_relaxed);
                    }
                }
                MV_CC_FreeImageBuffer(m_handle,&fr);
                missCount = 0;
            } else {
                // Some cameras remain in trigger workflow; software trigger nudges frame delivery.
                if(++missCount >= 3){
                    MV_CC_SetCommandValue(m_handle,"TriggerSoftware");
                    missCount = 0;
                }
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(8));}}

    static bool isBayerPixelType(unsigned int t){
        switch(t){
            case PixelType_Gvsp_BayerGR8:
            case PixelType_Gvsp_BayerRG8:
            case PixelType_Gvsp_BayerGB8:
            case PixelType_Gvsp_BayerBG8:
            case PixelType_Gvsp_BayerGR10:
            case PixelType_Gvsp_BayerRG10:
            case PixelType_Gvsp_BayerGB10:
            case PixelType_Gvsp_BayerBG10:
            case PixelType_Gvsp_BayerGR12:
            case PixelType_Gvsp_BayerRG12:
            case PixelType_Gvsp_BayerGB12:
            case PixelType_Gvsp_BayerBG12:
            case PixelType_Gvsp_BayerGR10_Packed:
            case PixelType_Gvsp_BayerRG10_Packed:
            case PixelType_Gvsp_BayerGB10_Packed:
            case PixelType_Gvsp_BayerBG10_Packed:
            case PixelType_Gvsp_BayerGR12_Packed:
            case PixelType_Gvsp_BayerRG12_Packed:
            case PixelType_Gvsp_BayerGB12_Packed:
            case PixelType_Gvsp_BayerBG12_Packed:
            case PixelType_Gvsp_BayerGR16:
            case PixelType_Gvsp_BayerRG16:
            case PixelType_Gvsp_BayerGB16:
            case PixelType_Gvsp_BayerBG16:
                return true;
            default:
                return false;
        }
    }

    bool toJpeg(MV_FRAME_OUT& src,FrameData& dst){
        unsigned w=src.stFrameInfo.nWidth, h=src.stFrameInfo.nHeight;

        // Use BMP output from SDK — avoids TinyJpeg subsampling issues.
        // Reuse m_bmpBuf to avoid a ~19MB heap allocation on every grab iteration.
        unsigned bsz = 54u + ((w*3u+3u)&~3u)*h + 4096u;
        if(m_bmpBuf.size() < bsz) m_bmpBuf.resize(bsz);
        MV_SAVE_IMAGE_PARAM_EX sp; memset(&sp,0,sizeof(sp));
        sp.enImageType  = MV_Image_Bmp;
        sp.enPixelType  = src.stFrameInfo.enPixelType;
        sp.nWidth       = w; sp.nHeight=h;
        sp.nDataLen     = src.stFrameInfo.nFrameLen;
        sp.pData        = src.pBufAddr;
        sp.nJpgQuality  = 90;   // unused for BMP, kept for API compat
        sp.pImageBuffer = m_bmpBuf.data();
        sp.nBufferSize  = (unsigned int)m_bmpBuf.size();
        int sret = MV_CC_SaveImageEx2(m_handle,&sp);
        m_lastSaveRet = sret;
        if(sret==MV_OK){
            dst.jpeg.resize(sp.nImageLen);
            memcpy(dst.jpeg.data(),m_bmpBuf.data(),sp.nImageLen);
            dst.format="bmp";
        }else{
            // Fallback: assemble BMP from raw Bayer buffer
            if(!makeBmpFromRaw(src,dst)) return false;
        }
        dst.width=w; dst.height=h;
        dst.frameNum  =src.stFrameInfo.nFrameNum;
        dst.timestamp =std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        return true;}

    static void wr16(std::vector<unsigned char>& v,size_t off,unsigned short x){
        v[off+0]=(unsigned char)(x&0xFF); v[off+1]=(unsigned char)((x>>8)&0xFF);
    }
    static void wr32(std::vector<unsigned char>& v,size_t off,unsigned int x){
        v[off+0]=(unsigned char)(x&0xFF); v[off+1]=(unsigned char)((x>>8)&0xFF);
        v[off+2]=(unsigned char)((x>>16)&0xFF); v[off+3]=(unsigned char)((x>>24)&0xFF);
    }
    bool makeBmpFromBgr(const unsigned char* bgr, unsigned w, unsigned h, FrameData& dst){
        if(!bgr || w==0 || h==0) return false;
        const unsigned rowStride = ((w * 3u) + 3u) & ~3u;
        const unsigned pixelBytes = rowStride * h;
        const unsigned headerBytes = 14u + 40u;
        const unsigned fileSize = headerBytes + pixelBytes;

        // Reuse m_bmpBuf — already reserved in toJpeg, so this is a no-op resize most of the time.
        if(m_bmpBuf.size() < fileSize) m_bmpBuf.resize(fileSize);
        unsigned char* bmp = m_bmpBuf.data();
        memset(bmp, 0, headerBytes); // zero only the header bytes
        // BITMAPFILEHEADER
        bmp[0]='B'; bmp[1]='M';
        wr32(m_bmpBuf,2,fileSize);
        wr32(m_bmpBuf,10,headerBytes);
        // BITMAPINFOHEADER
        wr32(m_bmpBuf,14,40);
        wr32(m_bmpBuf,18,w);
        wr32(m_bmpBuf,22,h); // bottom-up
        wr16(m_bmpBuf,26,1);
        wr16(m_bmpBuf,28,24); // BGR24
        wr32(m_bmpBuf,34,pixelBytes);

        size_t pixOff = headerBytes;
        for(unsigned y=0;y<h;y++){
            const unsigned srcY = h - 1u - y; // BMP bottom-up
            const unsigned char* srow = bgr + (size_t)srcY * w * 3u;
            unsigned char* drow = bmp + pixOff + (size_t)y * rowStride;
            memcpy(drow, srow, (size_t)w * 3u);
        }

        dst.jpeg.resize(fileSize);
        memcpy(dst.jpeg.data(), bmp, fileSize);
        dst.format = "bmp";
        return true;
    }

    bool makeBmpFromRaw(const MV_FRAME_OUT& src, FrameData& dst){
        const unsigned w = src.stFrameInfo.nWidth;
        const unsigned h = src.stFrameInfo.nHeight;
        if(!src.pBufAddr || w==0 || h==0) return false;

        // First try SDK pixel conversion to BGR24.
        // Reuse m_bgrBuf to avoid a ~19MB heap allocation on every fallback conversion.
        const size_t bgrNeeded = (size_t)w * h * 3u;
        if(m_bgrBuf.size() < bgrNeeded) m_bgrBuf.resize(bgrNeeded);
        MV_CC_PIXEL_CONVERT_PARAM cv; memset(&cv, 0, sizeof(cv));
        cv.nWidth        = w;
        cv.nHeight       = h;
        cv.pSrcData      = src.pBufAddr;
        cv.nSrcDataLen   = src.stFrameInfo.nFrameLen;
        cv.enSrcPixelType= src.stFrameInfo.enPixelType;
        cv.enDstPixelType= PixelType_Gvsp_BGR8_Packed;
        cv.pDstBuffer    = m_bgrBuf.data();
        cv.nDstBufferSize= (unsigned int)m_bgrBuf.size();
        int cvRet = MV_CC_ConvertPixelType(m_handle, &cv);
        if(cvRet == MV_OK && cv.nDstLen >= w * h * 3u){
            return makeBmpFromBgr(m_bgrBuf.data(), w, h, dst);
        }

        // Final fallback for Mono8-like paths.
        const unsigned need = w*h;
        if(src.stFrameInfo.nFrameLen < need) return false;

        const unsigned rowStride = (w + 3u) & ~3u;
        const unsigned pixelBytes = rowStride * h;
        const unsigned paletteBytes = 256u * 4u;
        const unsigned headerBytes = 14u + 40u;
        const unsigned fileSize = headerBytes + paletteBytes + pixelBytes;

        // Reuse m_bmpBuf for the grayscale BMP.
        if(m_bmpBuf.size() < fileSize) m_bmpBuf.resize(fileSize);
        unsigned char* bmp = m_bmpBuf.data();
        memset(bmp, 0, headerBytes + paletteBytes); // zero header + palette only
        // BITMAPFILEHEADER
        bmp[0]='B'; bmp[1]='M';
        wr32(m_bmpBuf,2,fileSize);
        wr32(m_bmpBuf,10,headerBytes + paletteBytes);
        // BITMAPINFOHEADER
        wr32(m_bmpBuf,14,40);
        wr32(m_bmpBuf,18,w);
        wr32(m_bmpBuf,22,h); // bottom-up
        wr16(m_bmpBuf,26,1);
        wr16(m_bmpBuf,28,8); // 8-bit indexed
        wr32(m_bmpBuf,34,pixelBytes);
        wr32(m_bmpBuf,46,256); // color table
        wr32(m_bmpBuf,50,256); // important colors
        // grayscale palette
        size_t palOff = 14u + 40u;
        for(unsigned i=0;i<256;i++){
            bmp[palOff + i*4 + 0] = (unsigned char)i; // B
            bmp[palOff + i*4 + 1] = (unsigned char)i; // G
            bmp[palOff + i*4 + 2] = (unsigned char)i; // R
            bmp[palOff + i*4 + 3] = 0;
        }
        // pixel data (assume first byte-per-pixel plane; works for Mono8/Bayer8 streams)
        const unsigned char* raw = (const unsigned char*)src.pBufAddr;
        size_t pixOff = headerBytes + paletteBytes;
        for(unsigned y=0;y<h;y++){
            unsigned srcY = h - 1u - y; // BMP bottom-up
            const unsigned char* srow = raw + srcY*w;
            unsigned char* drow = bmp + pixOff + y*rowStride;
            memcpy(drow, srow, w);
        }
        dst.jpeg.resize(fileSize);
        memcpy(dst.jpeg.data(), bmp, fileSize);
        dst.format = "bmp";
        return true;
    }

    void setErr(const std::string& m){
        m_lastError=m;
        std::cerr<<"[HikRobot] "<<m<<"\n";}
};

// ─────────────────────────────────────────────────
//  Global camera instance
// ─────────────────────────────────────────────────
static HikrobotCamera g_cam;

// ─────────────────────────────────────────────────
//  N-API bindings
//  These are called from the Express server layer
//  which maps HTTP routes to these functions.
//  Port 8765 = shared.ts CAM_BASE
// ─────────────────────────────────────────────────

// GET /status
Napi::Value NGetStatus(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    Napi::Object r=Napi::Object::New(e);
    r.Set("ok",          Napi::Boolean::New(e,true));
    r.Set("sdkVersion",  Napi::String::New(e,g_cam.getSDKVersion()));
    r.Set("cameraOpen",  Napi::Boolean::New(e,g_cam.isOpen()));
    r.Set("grabbing",    Napi::Boolean::New(e,g_cam.isGrabbing()));
    r.Set("hasFrame",    Napi::Boolean::New(e,g_cam.hasFrame()));
    r.Set("lastError",   Napi::String::New(e,g_cam.getLastError()));
    r.Set("lastGrabRet", Napi::Number::New(e,g_cam.getLastGrabRet()));
    r.Set("lastSaveRet", Napi::Number::New(e,g_cam.getLastSaveRet()));
    r.Set("lastPixelType", Napi::Number::New(e,g_cam.getLastPixelType()));
    DeviceInfo d=g_cam.getCurrentDevice();
    Napi::Object dev=Napi::Object::New(e);
    dev.Set("model",  Napi::String::New(e,d.model));
    dev.Set("serial", Napi::String::New(e,d.serial));
    dev.Set("type",   Napi::String::New(e,d.deviceType==1?"USB3":"GigE"));
    r.Set("device",dev);
    CameraParams p;
    if(g_cam.isOpen()&&g_cam.getParams(p)){
        Napi::Object po=Napi::Object::New(e);
        po.Set("exposure_us", Napi::Number::New(e,p.exposureUs));
        po.Set("gain_db",     Napi::Number::New(e,p.gainDb));
        po.Set("gamma",       Napi::Number::New(e,p.gamma));
        po.Set("width",       Napi::Number::New(e,p.width));
        po.Set("height",      Napi::Number::New(e,p.height));
        // resolution string for CameraPage cam_info
        std::ostringstream ss; ss<<p.width<<"×"<<p.height;
        po.Set("resolution",  Napi::String::New(e,ss.str()));
        r.Set("params",po);
        // cam_info — returned by /stream/start for CameraPage
        Napi::Object ci=Napi::Object::New(e);
        ci.Set("resolution", Napi::String::New(e,ss.str()));
        r.Set("cam_info",ci);}
    return r;}

// POST /stream/start  — opens device 0 and starts grabbing
// Response: {ok, data: {cam_info: {resolution}}}
Napi::Value NStreamStart(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    Napi::Object r=Napi::Object::New(e);
    bool ok=false;
    if(!g_cam.isOpen()) ok=g_cam.openDevice(0);
    else ok=true;
    if(ok&&!g_cam.isGrabbing()) ok=g_cam.startGrabbing();
    r.Set("ok",Napi::Boolean::New(e,ok));
    r.Set("error",Napi::String::New(e,g_cam.getLastError()));
    if(ok){
        CameraParams p; g_cam.getParams(p);
        std::ostringstream ss; ss<<p.width<<"×"<<p.height;
        Napi::Object ci=Napi::Object::New(e);
        ci.Set("resolution",Napi::String::New(e,ss.str()));
        r.Set("cam_info",ci);}
    return r;}

// POST /stream/stop
Napi::Value NStreamStop(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    bool ok=g_cam.stopGrabbing();
    Napi::Object r=Napi::Object::New(e);
    r.Set("ok",Napi::Boolean::New(e,ok));
    return r;}

// GET /frame  — returns {ok, frame:base64, width, height}
// Called every 80ms by CameraPage poll loop
Napi::Value NGetFrame(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    FrameData f; bool ok=g_cam.getLatestFrame(f);
    Napi::Object r=Napi::Object::New(e);
    r.Set("ok",Napi::Boolean::New(e,ok&&!f.jpeg.empty()));
    if(ok&&!f.jpeg.empty()){
        r.Set("frame",    Napi::String::New(e,b64enc(f.jpeg.data(),f.jpeg.size())));
        r.Set("format",   Napi::String::New(e,f.format));
        r.Set("width",    Napi::Number::New(e,f.width));
        r.Set("height",   Napi::Number::New(e,f.height));
        r.Set("frameNum", Napi::Number::New(e,f.frameNum));
        r.Set("timestamp",Napi::Number::New(e,(double)f.timestamp));
    }else{
        r.Set("error",Napi::String::New(e,g_cam.getLastError()));}
    return r;}

// POST /settings — applies exposure_us, gain_db, gamma, contrast,
//                  black_level, resolution, res_mode
// Matches CameraPage applySettingsLive() call exactly
Napi::Value NSetSettings(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    Napi::Object r=Napi::Object::New(e);
    if(info.Length()<1||!info[0].IsObject()){
        r.Set("ok",Napi::Boolean::New(e,false));
        r.Set("error",Napi::String::New(e,"No settings object provided"));
        return r;}
    Napi::Object opts=info[0].As<Napi::Object>();
    CameraParams p; g_cam.getParams(p);
    // Map CameraPage field names → CameraParams
    if(opts.Has("exposure_us"))  p.exposureUs  =opts.Get("exposure_us").As<Napi::Number>().FloatValue();
    if(opts.Has("gain_db"))      p.gainDb      =opts.Get("gain_db").As<Napi::Number>().FloatValue();
    if(opts.Has("gamma"))        p.gamma       =opts.Get("gamma").As<Napi::Number>().FloatValue();
    if(opts.Has("contrast"))     p.contrast    =opts.Get("contrast").As<Napi::Number>().FloatValue();
    if(opts.Has("black_level"))  p.blackLevel  =opts.Get("black_level").As<Napi::Number>().FloatValue();
    if(opts.Has("res_mode"))     p.resMode     =opts.Get("res_mode").As<Napi::String>().Utf8Value();
    if(opts.Has("resolution")){
        std::string res=opts.Get("resolution").As<Napi::String>().Utf8Value();
        // "Max" and "User" both mean: keep camera at its current (or max) size
        if(res!="User" && res!="Max") HikrobotCamera::parseResolution(res,p.width,p.height);}
    bool ok=g_cam.applySettings(p);
    r.Set("ok",Napi::Boolean::New(e,ok));
    r.Set("error",Napi::String::New(e,g_cam.getLastError()));
    return r;}

// POST /capture — trigger Vickers measurement
// Request:  {load_kgf, px_per_mm (optional), canny_t1, canny_t2}
// Response: {ok, d1_mm, d2_mm, hv, confidence, d_mean_mm, px_per_mm}
// CameraPage uses: r.data.d1_mm, r.data.d2_mm for line placement
Napi::Value NCapture(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    double pm=100., lk=10., t1=0, t2=0;
    if(info.Length()>0&&info[0].IsObject()){
        Napi::Object o=info[0].As<Napi::Object>();
        if(o.Has("load_kgf"))   lk=o.Get("load_kgf").As<Napi::Number>().DoubleValue();
        if(o.Has("px_per_mm"))  pm=o.Get("px_per_mm").As<Napi::Number>().DoubleValue();
        if(o.Has("canny_t1"))   t1=o.Get("canny_t1").As<Napi::Number>().DoubleValue();
        if(o.Has("canny_t2"))   t2=o.Get("canny_t2").As<Napi::Number>().DoubleValue();}
    MeasureResult m=g_cam.measureHV(pm,lk,t1,t2);
    Napi::Object r=Napi::Object::New(e);
    r.Set("ok",          Napi::Boolean::New(e,m.success));
    r.Set("hv",          Napi::Number::New(e,m.hv));
    r.Set("d1_mm",       Napi::Number::New(e,m.d1_mm));
    r.Set("d2_mm",       Napi::Number::New(e,m.d2_mm));
    r.Set("d_mean_mm",   Napi::Number::New(e,m.d_mean_mm));
    r.Set("confidence",  Napi::Number::New(e,m.confidence));
    r.Set("px_per_mm",   Napi::Number::New(e,m.px_per_mm));
    r.Set("error",       Napi::String::New(e,m.error));
    // Normalised overlay coords — used by frontend canvas drawing
    r.Set("cx_frac",     Napi::Number::New(e,m.cx_frac));
    r.Set("cy_frac",     Napi::Number::New(e,m.cy_frac));
    r.Set("lx_frac",     Napi::Number::New(e,m.lx_frac));
    r.Set("ly_frac",     Napi::Number::New(e,m.ly_frac));
    r.Set("rx_frac",     Napi::Number::New(e,m.rx_frac));
    r.Set("ry_frac",     Napi::Number::New(e,m.ry_frac));
    r.Set("tx_frac",     Napi::Number::New(e,m.tx_frac));
    r.Set("ty_frac",     Napi::Number::New(e,m.ty_frac));
    r.Set("bx_frac",     Napi::Number::New(e,m.bx_frac));
    r.Set("by_frac",     Napi::Number::New(e,m.by_frac));
    r.Set("img_w",       Napi::Number::New(e,m.img_w));
    r.Set("img_h",       Napi::Number::New(e,m.img_h));
    return r;}

// POST /calibrate
Napi::Value NCalibrate(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    double refHV=200., lk=10.;
    if(info.Length()>0&&info[0].IsObject()){
        Napi::Object o=info[0].As<Napi::Object>();
        if(o.Has("ref_hv"))   refHV=o.Get("ref_hv").As<Napi::Number>().DoubleValue();
        if(o.Has("load_kgf")) lk=o.Get("load_kgf").As<Napi::Number>().DoubleValue();}
    CalibResult c=g_cam.calibrate(refHV,lk);
    Napi::Object r=Napi::Object::New(e);
    r.Set("ok",          Napi::Boolean::New(e,c.success));
    r.Set("px_per_mm",   Napi::Number::New(e,c.px_per_mm));
    r.Set("offset_hv",   Napi::Number::New(e,c.offset_hv));
    r.Set("measured_hv", Napi::Number::New(e,c.measured_hv));
    r.Set("error_pct",   Napi::Number::New(e,c.error_pct));
    r.Set("message",     Napi::String::New(e,c.message));
    return r;}

// Utility: enumerate devices
Napi::Value NEnumDevices(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();
    auto ds=g_cam.enumDevices();
    Napi::Array a=Napi::Array::New(e,ds.size());
    for(size_t k=0;k<ds.size();k++){
        Napi::Object o=Napi::Object::New(e);
        o.Set("model",      Napi::String::New(e,ds[k].model));
        o.Set("serial",     Napi::String::New(e,ds[k].serial));
        o.Set("ipAddress",  Napi::String::New(e,ds[k].ipAddress));
        o.Set("deviceType", Napi::Number::New(e,ds[k].deviceType));
        o.Set("index",      Napi::Number::New(e,ds[k].index));
        a[k]=o;}
    return a;}

// ─────────────────────────────────────────────────
//  Module init — export all functions
//  Used by camera_wrapper.js which creates the
//  Express server on port 8765
// ─────────────────────────────────────────────────
Napi::Object Init(Napi::Env env, Napi::Object exports){
    exports.Set("streamStart",  Napi::Function::New(env,NStreamStart));
    exports.Set("streamStop",   Napi::Function::New(env,NStreamStop));
    exports.Set("getFrame",     Napi::Function::New(env,NGetFrame));
    exports.Set("setSettings",  Napi::Function::New(env,NSetSettings));
    exports.Set("capture",      Napi::Function::New(env,NCapture));
    exports.Set("getStatus",    Napi::Function::New(env,NGetStatus));
    // Extra utilities
    exports.Set("enumDevices",  Napi::Function::New(env,NEnumDevices));
    exports.Set("calibrate",    Napi::Function::New(env,NCalibrate));
    return exports;}

NODE_API_MODULE(hikrobot_camera, Init)








