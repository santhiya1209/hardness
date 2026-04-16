// backend/image-processing/napi/processor.cpp
// Vickers hardness image processing pipeline — N-API addon.
//
// Accepts raw 8 bpp grayscale pixels (row-major, already decoded by the
// camera stream).  No JPEG/BMP decoding here.  No camera SDK dependency.
//
// Exported JS API:
//   process(data:Buffer, width:uint, height:uint, params:object)
//     → { ok:bool, hv?, d1_mm?, d2_mm?, d_mean_mm?, confidence?,
//         px_per_mm?, cx_frac?, cy_frac?,
//         lx_frac?, ly_frac?, rx_frac?, ry_frac?,
//         tx_frac?, ty_frac?, bx_frac?, by_frac?,
//         img_w?, img_h?, error? }
//
// Algorithm (identical to hikrobot_camera.cpp detectVickers — raw-gray path):
//   1. Local illumination normalisation (box R=50)
//   2. Grayscale morphological closing (R=21) — scratch suppression
//   3. Gaussian blur 11×11 on scratch-free image
//   4. Adaptive threshold (R=H/8, k=0.18) → binary dark mask
//   5. Morphological closing + fillHoles → filled blob
//   6. Blob detection → select best blob near image centre
//   7. Outer boundary extraction
//   8. Quadrant LSQ line fitting → 4 diamond tips (T/R/B/L)
//      Fallback: directional cone sweep if fitting fails
//   9. Sub-pixel gradient refinement (cornerSubPix)
//  10. Geometric rhombus fit — removes residual non-rigidity
//  11. HV = 1.8544 × F(kgf) / d²(mm²)

#define _USE_MATH_DEFINES
#include <napi.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <deque>
#include <limits>
#include <numeric>
#include <string>
#include <utility>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ═══════════════════════════════════════════════════════════════════════════
//  IMAGE PROCESSING PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

// ── Gaussian blur 5×5 ───────────────────────────────────────────────────────
static std::vector<float> gblur5(const uint8_t* s, int W, int H) {
    static const float K[] = { .0625f, .25f, .375f, .25f, .0625f };
    std::vector<float> t(W * H), o(W * H);
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
        float v = 0;
        for (int k = -2; k <= 2; k++) { int xx = std::max(0, std::min(W-1, x+k)); v += K[k+2] * s[y*W+xx]; }
        t[y*W+x] = v;
    }
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
        float v = 0;
        for (int k = -2; k <= 2; k++) { int yy = std::max(0, std::min(H-1, y+k)); v += K[k+2] * t[yy*W+x]; }
        o[y*W+x] = v;
    }
    return o;
}

// ── Gaussian blur 11×11 ─────────────────────────────────────────────────────
static std::vector<float> gblur11(const uint8_t* s, int W, int H) {
    const float K11[] = { .0002f,.0026f,.0175f,.0700f,.1755f,.2684f,
                          .2684f,.1755f,.0700f,.0175f,.0026f };
    float K[11]; float sum = 0;
    for (float k : K11) sum += k;
    for (int i = 0; i < 11; i++) K[i] = K11[i] / sum;
    std::vector<float> t(W*H), o(W*H);
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
        float v = 0;
        for (int k = -5; k <= 5; k++) { int xx = std::max(0, std::min(W-1, x+k)); v += K[k+5] * s[y*W+xx]; }
        t[y*W+x] = v;
    }
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
        float v = 0;
        for (int k = -5; k <= 5; k++) { int yy = std::max(0, std::min(H-1, y+k)); v += K[k+5] * t[yy*W+x]; }
        o[y*W+x] = v;
    }
    return o;
}

// ── Local illumination normalisation ────────────────────────────────────────
static std::vector<uint8_t> normalizeIllum(const std::vector<uint8_t>& src, int W, int H, int R) {
    const int N = W * H;
    std::vector<int64_t> ii(N, 0);
    for (int y = 0; y < H; y++) {
        int64_t rs = 0;
        for (int x = 0; x < W; x++) {
            rs += src[y*W+x];
            ii[y*W+x] = rs + (y > 0 ? ii[(y-1)*W+x] : 0);
        }
    }
    double gm = (double)ii[(H-1)*W+(W-1)] / N;
    if (gm < 1.0) gm = 1.0;
    std::vector<uint8_t> out(N);
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
        int x0 = std::max(0, x-R), x1 = std::min(W-1, x+R);
        int y0 = std::max(0, y-R), y1 = std::min(H-1, y+R);
        int64_t s = ii[y1*W+x1]
                  - (x0 > 0       ? ii[y1*W+x0-1]     : 0)
                  - (y0 > 0       ? ii[(y0-1)*W+x1]   : 0)
                  + (x0>0 && y0>0 ? ii[(y0-1)*W+x0-1] : 0);
        double lm = (double)s / ((x1-x0+1)*(y1-y0+1));
        if (lm < 1.0) lm = 1.0;
        double v = src[y*W+x] * gm / lm;
        out[y*W+x] = (uint8_t)std::min(255.0, std::max(0.0, v));
    }
    return out;
}

// ── Grayscale morphological closing ─────────────────────────────────────────
static std::vector<uint8_t> grayMorphCloseR(const std::vector<uint8_t>& src, int W, int H, int R) {
    if (R <= 0) return src;
    auto slidingMax = [&](const std::vector<uint8_t>& in) {
        std::vector<uint8_t> hd(W*H, 0), out(W*H, 0);
        for (int y = 0; y < H; y++) {
            std::deque<int> q;
            for (int x = 0; x < W; x++) {
                while (!q.empty() && in[y*W+q.back()] <= in[y*W+x]) q.pop_back();
                q.push_back(x);
                if (q.front() < x - R) q.pop_front();
                hd[y*W+x] = in[y*W+q.front()];
            }
        }
        for (int x = 0; x < W; x++) {
            std::deque<int> q;
            for (int y = 0; y < H; y++) {
                while (!q.empty() && hd[q.back()*W+x] <= hd[y*W+x]) q.pop_back();
                q.push_back(y);
                if (q.front() < y - R) q.pop_front();
                out[y*W+x] = hd[q.front()*W+x];
            }
        }
        return out;
    };
    auto slidingMin = [&](const std::vector<uint8_t>& in) {
        std::vector<uint8_t> hd(W*H, 255), out(W*H, 255);
        for (int y = 0; y < H; y++) {
            std::deque<int> q;
            for (int x = 0; x < W; x++) {
                while (!q.empty() && in[y*W+q.back()] >= in[y*W+x]) q.pop_back();
                q.push_back(x);
                if (q.front() < x - R) q.pop_front();
                hd[y*W+x] = in[y*W+q.front()];
            }
        }
        for (int x = 0; x < W; x++) {
            std::deque<int> q;
            for (int y = 0; y < H; y++) {
                while (!q.empty() && hd[q.back()*W+x] >= hd[y*W+x]) q.pop_back();
                q.push_back(y);
                if (q.front() < y - R) q.pop_front();
                out[y*W+x] = hd[q.front()*W+x];
            }
        }
        return out;
    };
    return slidingMin(slidingMax(src));
}

// ── Adaptive threshold (integral-image box) ─────────────────────────────────
static std::vector<uint8_t> adaptiveThreshBox(
        const std::vector<float>& gray, int W, int H, int R, float k) {
    std::vector<int64_t> ii(W*H, 0);
    for (int y = 0; y < H; y++) {
        int64_t rs = 0;
        for (int x = 0; x < W; x++) {
            rs += (int64_t)gray[y*W+x];
            ii[y*W+x] = rs + (y > 0 ? ii[(y-1)*W+x] : 0);
        }
    }
    std::vector<uint8_t> bin(W*H, 0);
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
        int x0 = std::max(0,x-R), x1 = std::min(W-1,x+R);
        int y0 = std::max(0,y-R), y1 = std::min(H-1,y+R);
        int64_t s = ii[y1*W+x1]
                  - (x0>0 ? ii[y1*W+x0-1] : 0)
                  - (y0>0 ? ii[(y0-1)*W+x1] : 0)
                  + (x0>0&&y0>0 ? ii[(y0-1)*W+x0-1] : 0);
        float lm = (float)s / ((x1-x0+1)*(y1-y0+1));
        bin[y*W+x] = (gray[y*W+x] < lm*(1.0f - k)) ? 1 : 0;
    }
    return bin;
}

// ── Fill enclosed holes (BFS from border) ───────────────────────────────────
static std::vector<uint8_t> fillHoles(const std::vector<uint8_t>& src, int W, int H) {
    std::vector<uint8_t> bg(W*H, 0);
    std::vector<int> q;
    q.reserve(W*2 + H*2);
    auto push = [&](int x, int y) {
        int i = y*W+x;
        if (!bg[i] && !src[i]) { bg[i] = 1; q.push_back(i); }
    };
    for (int x = 0; x < W; x++) { push(x, 0); push(x, H-1); }
    for (int y = 1; y < H-1; y++) { push(0, y); push(W-1, y); }
    for (int qi = 0; qi < (int)q.size(); qi++) {
        int idx = q[qi], x = idx%W, y = idx/W;
        if (x>0)   push(x-1,y);
        if (x<W-1) push(x+1,y);
        if (y>0)   push(x,y-1);
        if (y<H-1) push(x,y+1);
    }
    std::vector<uint8_t> out(src);
    for (int i = 0; i < W*H; i++) if (!src[i] && !bg[i]) out[i] = 1;
    return out;
}

// ── Binary morphological closing with O(N) separable sliding window ──────────
static std::vector<uint8_t> morphCloseR(const std::vector<uint8_t>& src, int W, int H, int R) {
    if (R <= 0) return src;
    auto binaryDilate = [&](const std::vector<uint8_t>& in) {
        std::vector<uint8_t> hd(W*H, 0);
        for (int y = 0; y < H; y++) {
            int cnt = 0;
            for (int xx = 0; xx <= std::min(R, W-1); xx++) cnt += in[y*W+xx];
            for (int x = 0; x < W; x++) {
                if (cnt > 0) hd[y*W+x] = 1;
                if (x+R+1 < W) cnt += in[y*W+x+R+1];
                if (x-R >= 0)  cnt -= in[y*W+x-R];
            }
        }
        std::vector<uint8_t> out(W*H, 0);
        for (int x = 0; x < W; x++) {
            int cnt = 0;
            for (int yy = 0; yy <= std::min(R, H-1); yy++) cnt += hd[yy*W+x];
            for (int y = 0; y < H; y++) {
                if (cnt > 0) out[y*W+x] = 1;
                if (y+R+1 < H) cnt += hd[(y+R+1)*W+x];
                if (y-R >= 0)  cnt -= hd[(y-R)*W+x];
            }
        }
        return out;
    };
    auto d = binaryDilate(src);
    for (auto& v : d) v ^= 1;
    d = binaryDilate(d);
    for (auto& v : d) v ^= 1;
    return d;
}

// ── Blob detection ──────────────────────────────────────────────────────────
struct Blob { double cx, cy; int area, bw, bh; };
static std::vector<Blob> findBlobs(const std::vector<uint8_t>& bin, int W, int H, int mn, int mx) {
    std::vector<int> lbl(W*H, 0); std::vector<Blob> out; int nl = 1;
    for (int sy = 0; sy < H; sy++) for (int sx = 0; sx < W; sx++) {
        if (!bin[sy*W+sx] || lbl[sy*W+sx]) continue;
        std::vector<int> stk; stk.push_back(sy*W+sx); lbl[sy*W+sx] = nl;
        long long sumX=0, sumY=0, cnt=0; int x0=W,x1=0,y0=H,y1=0;
        while (!stk.empty()) {
            int p = stk.back(); stk.pop_back();
            int py = p/W, px = p%W; sumX+=px; sumY+=py; cnt++;
            if (px<x0) x0=px; if (px>x1) x1=px; if (py<y0) y0=py; if (py>y1) y1=py;
            int dx[]={-1,1,0,0}, dy[]={0,0,-1,1};
            for (int d = 0; d < 4; d++) {
                int nx=px+dx[d], ny=py+dy[d];
                if (nx<0||nx>=W||ny<0||ny>=H) continue;
                int np=ny*W+nx;
                if (bin[np] && !lbl[np]) { lbl[np]=nl; stk.push_back(np); }
            }
        }
        if (cnt >= mn && cnt <= mx) {
            Blob b; b.cx=(double)sumX/cnt; b.cy=(double)sumY/cnt;
            b.area=(int)cnt; b.bw=x1-x0+1; b.bh=y1-y0+1;
            out.push_back(b);
        }
        nl++;
    }
    return out;
}

// ── Sub-pixel corner refinement (cornerSubPix) ──────────────────────────────
static void subpixelRefine(const std::vector<float>& img, int W, int H,
                            double& px, double& py, int winR = 5) {
    double cx = px, cy = py;
    for (int iter = 0; iter < 10; iter++) {
        double a11=0,a12=0,a21=0,a22=0,b1=0,b2=0;
        int x0c=std::max(1,(int)(cx)-winR), y0c=std::max(1,(int)(cy)-winR);
        int x1c=std::min(W-2,(int)(cx)+winR), y1c=std::min(H-2,(int)(cy)+winR);
        for (int y = y0c; y <= y1c; y++) for (int x = x0c; x <= x1c; x++) {
            double wx=x-cx, wy=y-cy;
            double w = std::exp(-(wx*wx+wy*wy)/(2.0*winR*winR*0.25));
            double gx=(-img[(y-1)*W+x-1]+img[(y-1)*W+x+1]
                       -2.f*img[y*W+x-1]+2.f*img[y*W+x+1]
                       -img[(y+1)*W+x-1]+img[(y+1)*W+x+1])*0.125;
            double gy=(-img[(y-1)*W+x-1]-2.f*img[(y-1)*W+x]-img[(y-1)*W+x+1]
                       +img[(y+1)*W+x-1]+2.f*img[(y+1)*W+x]+img[(y+1)*W+x+1])*0.125;
            a11+=w*gx*gx; a12+=w*gx*gy; a21+=w*gx*gy; a22+=w*gy*gy;
            b1 +=w*(gx*x+gy*y)*gx; b2+=w*(gx*x+gy*y)*gy;
        }
        double det = a11*a22 - a12*a21;
        if (std::abs(det) < 1e-10) break;
        double nx=(a22*b1-a12*b2)/det, ny=(a11*b2-a21*b1)/det;
        nx=std::clamp(nx, cx-(double)winR, cx+(double)winR);
        ny=std::clamp(ny, cy-(double)winR, cy+(double)winR);
        double move = std::hypot(nx-cx, ny-cy);
        cx = nx; cy = ny;
        if (move < 0.01) break;
    }
    if (std::hypot(cx-px, cy-py) < (double)winR) { px=cx; py=cy; }
}

// ── Geometric rhombus fit (gradient descent, 40 iterations) ─────────────────
struct RhombusResult {
    bool ok=false;
    double cx=0,cy=0,hD1=0,hD2=0,theta=0;
    double lx=0,ly=0, rx=0,ry=0, tx=0,ty=0, bx=0,by=0;
    double residual=0;
};
static RhombusResult fitRhombus(double lx,double ly,double rx,double ry,
                                 double tx,double ty,double bx,double by) {
    RhombusResult res;
    double d1len=std::hypot(rx-lx,ry-ly), d2len=std::hypot(bx-tx,by-ty);
    if (d1len<2 || d2len<2) return res;
    double cx_=( lx+rx+tx+bx)*0.25, cy_=(ly+ry+ty+by)*0.25;
    double th_=std::atan2(ry-ly,rx-lx);
    double hD1_=d1len*0.5, hD2_=d2len*0.5;
    for (int it = 0; it < 40; it++) {
        double cosT=std::cos(th_), sinT=std::sin(th_);
        double plx=cx_-hD1_*cosT, ply=cy_-hD1_*sinT;
        double prx=cx_+hD1_*cosT, pry=cy_+hD1_*sinT;
        double ptx=cx_+hD2_*sinT, pty=cy_-hD2_*cosT;
        double pbx=cx_-hD2_*sinT, pby=cy_+hD2_*cosT;
        double elx=plx-lx,ely=ply-ly, erx=prx-rx,ery=pry-ry;
        double etx=ptx-tx,ety=pty-ty, ebx=pbx-bx,eby=pby-by;
        double a=0.5/(1.0+it*0.1);
        cx_  -= a*0.25*(elx+erx+etx+ebx);
        cy_  -= a*0.25*(ely+ery+ety+eby);
        hD1_ -= a*0.25*((-elx*cosT-ely*sinT)+(erx*cosT+ery*sinT));
        hD2_ -= a*0.25*((etx*sinT-ety*cosT)+(-ebx*sinT+eby*cosT));
        th_  -= a*0.01*(hD1_*(elx*sinT-ely*cosT-erx*sinT+ery*cosT)
                       +hD2_*(etx*cosT+ety*sinT-ebx*cosT-eby*sinT));
    }
    if (hD1_<2 || hD2_<2) return res;
    if (std::min(hD1_,hD2_)/std::max(hD1_,hD2_) < 0.20) return res;
    double cosT=std::cos(th_), sinT=std::sin(th_);
    res.ok=true; res.cx=cx_; res.cy=cy_; res.hD1=hD1_; res.hD2=hD2_; res.theta=th_;
    res.lx=cx_-hD1_*cosT; res.ly=cy_-hD1_*sinT;
    res.rx=cx_+hD1_*cosT; res.ry=cy_+hD1_*sinT;
    res.tx=cx_+hD2_*sinT; res.ty=cy_-hD2_*cosT;
    res.bx=cx_-hD2_*sinT; res.by=cy_+hD2_*cosT;
    double sq=( std::pow(res.lx-lx,2)+std::pow(res.ly-ly,2)
               +std::pow(res.rx-rx,2)+std::pow(res.ry-ry,2)
               +std::pow(res.tx-tx,2)+std::pow(res.ty-ty,2)
               +std::pow(res.bx-bx,2)+std::pow(res.by-by,2));
    res.residual=std::sqrt(sq/8.0);
    return res;
}

// ── detectVickers (raw 8 bpp grayscale input) ────────────────────────────────
struct DetectResult {
    bool   ok=false;
    double cx=0,cy=0,hD1=0,hD2=0,conf=0;
    double tipLx=0,tipLy=0, tipRx=0,tipRy=0;
    double tipTx=0,tipTy=0, tipBx=0,tipBy=0;
    int    imgW=0, imgH=0;
    std::string error;
};

static DetectResult detectVickers(const uint8_t* rawGray, int W, int H) {
    DetectResult res;
    if (!rawGray || W <= 0 || H <= 0) {
        res.error = "empty input"; return res;
    }
    res.imgW = W; res.imgH = H;

    const int   N   = W * H;
    const double fcx = W * 0.5, fcy = H * 0.5;
    const double dg  = std::hypot(W, H);

    // Step 1a: illumination normalisation (R=50)
    std::vector<uint8_t> srcVec(rawGray, rawGray + N);
    auto gray = normalizeIllum(srcVec, W, H, 50);

    // Step 1b: scratch suppression — grayscale closing R=21
    auto scratchFree = grayMorphCloseR(gray, W, H, 21);

    // Step 1c: fine blur for sub-pixel refinement (from normalised gray)
    auto b5  = gblur5(gray.data(), W, H);

    // Step 2: smooth scratch-free for adaptive threshold
    auto b11 = gblur11(scratchFree.data(), W, H);

    // Step 3: adaptive threshold
    const int   adaptR = std::max(60, H/8);
    const float adaptK = 0.18f;
    auto binCoarse = adaptiveThreshBox(b11, W, H, adaptR, adaptK);

    // Coarse close + fill (radius=7 disk, via morphCloseR equivalent)
    auto clCoarse  = fillHoles(morphCloseR(binCoarse, W, H, 7), W, H);

    // Coarse blob selection
    auto bls = findBlobs(clCoarse, W, H, (int)(N*0.0005), (int)(N*0.35));

    double cx = fcx, cy = fcy, blobR = std::min(W,H)*0.10, bst = -1.0;
    for (auto& b : bls) {
        if (b.bw < 3 || b.bh < 3) continue;
        double asp = (double)std::min(b.bw,b.bh) / std::max(b.bw,b.bh);
        if (asp < 0.15) continue;
        if (b.cy < H*0.08 || b.cy > H*0.92) continue;
        if (b.cx < W*0.04 || b.cx > W*0.96) continue;
        double dist = std::hypot(b.cx-fcx, b.cy-fcy)/dg;
        double sc   = b.area * asp * asp * std::exp(-dist*3.0);
        if (sc > bst) { bst=sc; cx=b.cx; cy=b.cy;
                        blobR=std::hypot((double)b.bw,(double)b.bh)*0.55; }
    }
    if (bst < 0) { res.error="no valid blob found"; return res; }
    blobR = std::min(blobR, std::min(W,H)*0.30);

    const double minPx  = std::min(W,H) * 0.015;
    const double maxPx  = std::min(W,H) * 0.85;

    // Step 4: fine close to fill specular hole
    int closeR = std::max(9, std::min((int)(blobR*0.15), H/10));
    auto filled = fillHoles(morphCloseR(binCoarse, W, H, closeR), W, H);

    // Pick best filled blob (closest to coarse centre)
    auto fillBlobs = findBlobs(filled, W, H, (int)(N*0.0003), (int)(N*0.40));
    if (fillBlobs.empty()) { res.error="no filled blobs"; return res; }

    double bcx=cx, bcy=cy, bestD=1e18;
    int    bestBlobIdx = -1;
    for (int i = 0; i < (int)fillBlobs.size(); i++) {
        auto& b = fillBlobs[i];
        double asp=(double)std::min(b.bw,b.bh)/std::max(b.bw,b.bh);
        if (asp<0.12) continue;
        double d=std::hypot(b.cx-cx, b.cy-cy);
        if (d < bestD) { bestD=d; bestBlobIdx=i; bcx=b.cx; bcy=b.cy;
                         blobR=std::hypot((double)b.bw,(double)b.bh)*0.55; }
    }
    if (bestBlobIdx < 0) { res.error="no suitable filled blob"; return res; }
    blobR = std::clamp(blobR, minPx*0.5, std::min(W,H)*0.45);

    // Step 5: outer boundary of the filled blob
    std::vector<uint8_t> boundary(N, 0);
    const auto& bestFill = fillBlobs[(size_t)bestBlobIdx];
    int fx0=(int)std::max(1.0, bcx-blobR*1.4), fy0=(int)std::max(1.0, bcy-blobR*1.4);
    int fx1=(int)std::min((double)W-2, bcx+blobR*1.4), fy1=(int)std::min((double)H-2, bcy+blobR*1.4);
    for (int y = fy0; y <= fy1; y++) for (int x = fx0; x <= fx1; x++) {
        if (!filled[(size_t)y*W+x]) continue;
        bool bnd=false;
        for (int dy=-1;dy<=1&&!bnd;dy++) for (int dx=-1;dx<=1;dx++) {
            if (!filled[(size_t)(y+dy)*W+(size_t)(x+dx)]) { bnd=true; break; }
        }
        if (bnd) boundary[(size_t)y*W+x] = 255;
    }

    // Collect boundary points
    struct Pt { double x, y; };
    std::vector<Pt> bndPts;
    for (int y = fy0; y <= fy1; y++) for (int x = fx0; x <= fx1; x++) {
        if (boundary[(size_t)y*W+x]) bndPts.push_back({(double)x,(double)y});
    }
    if (bndPts.empty()) { res.error="boundary empty"; return res; }

    const double searchR2 = blobR * 1.55;

    // Step 6: Quadrant LSQ line fitting → 4 diamond tips
    std::vector<Pt> qUL, qUR, qLR, qLL;
    for (auto& p : bndPts) {
        bool right=(p.x>=bcx), below=(p.y>=bcy);
        if (!right && !below) qUL.push_back(p);
        else if (right && !below) qUR.push_back(p);
        else if (right &&  below) qLR.push_back(p);
        else                      qLL.push_back(p);
    }

    struct LineFit { bool ok=false; double a=0,b=0,c=0; };
    auto fitLine = [](const std::vector<Pt>& pts) -> LineFit {
        LineFit lf;
        if (pts.size() < 3) return lf;
        double mx=0,my=0,sxx=0,sxy=0,syy=0;
        for (auto& p:pts) { mx+=p.x; my+=p.y; }
        mx/=pts.size(); my/=pts.size();
        for (auto& p:pts) {
            double dx=p.x-mx, dy=p.y-my;
            sxx+=dx*dx; sxy+=dx*dy; syy+=dy*dy;
        }
        double tr=sxx+syy, det=sxx*syy-sxy*sxy;
        double disc=std::sqrt(std::max(0.0, tr*tr*0.25-det));
        double lam=tr*0.5-disc;
        double nx=-sxy, ny=sxx-lam, nlen=std::hypot(nx,ny);
        if (nlen < 1e-9) return lf;
        nx/=nlen; ny/=nlen;
        lf.a=nx; lf.b=ny; lf.c=nx*mx+ny*my; lf.ok=true;
        return lf;
    };
    auto intersect=[](const LineFit& l1, const LineFit& l2, double& xi, double& yi)->bool{
        double det=l1.a*l2.b-l2.a*l1.b;
        if (std::abs(det)<1e-9) return false;
        xi=(l1.c*l2.b-l2.c*l1.b)/det; yi=(l1.a*l2.c-l2.a*l1.c)/det; return true;
    };

    auto lUL=fitLine(qUL), lUR=fitLine(qUR), lLR=fitLine(qLR), lLL=fitLine(qLL);
    double tTx=0,tTy=0, tRx=0,tRy=0, tBx=0,tBy=0, tLx=0,tLy=0;
    bool intOk[4]={false,false,false,false};
    if (lUL.ok&&lUR.ok) intOk[0]=intersect(lUL,lUR,tTx,tTy);
    if (lUR.ok&&lLR.ok) intOk[1]=intersect(lUR,lLR,tRx,tRy);
    if (lLR.ok&&lLL.ok) intOk[2]=intersect(lLR,lLL,tBx,tBy);
    if (lLL.ok&&lUL.ok) intOk[3]=intersect(lLL,lUL,tLx,tLy);
    bool lineFitOk = lUL.ok&&lUR.ok&&lLR.ok&&lLL.ok
                  && intOk[0]&&intOk[1]&&intOk[2]&&intOk[3];

    // Validity gate for each tip
    auto inRange=[&](double x, double y)->bool{
        double d=std::hypot(x-bcx,y-bcy);
        return x>=1&&x<W-1&&y>=1&&y<H-1 && d>minPx && d<maxPx
            && std::abs(x-bcx)<searchR2 && std::abs(y-bcy)<searchR2;
    };

    // Fallback: directional cone sweep on boundary points
    if (!lineFitOk || !inRange(tTx,tTy)||!inRange(tRx,tRy)
                   || !inRange(tBx,tBy)||!inRange(tLx,tLy)) {
        const double cosLim = std::cos(38.0*M_PI/180.0);
        auto coneTip = [&](double dX, double dY) -> Pt {
            double bestDist=-1; Pt best={bcx,bcy};
            for (auto& p : bndPts) {
                double dx=p.x-bcx, dy=p.y-bcy, len=std::hypot(dx,dy);
                if (len < 1) continue;
                if ((dx*dX+dy*dY)/len < cosLim) continue;
                if (len > bestDist) { bestDist=len; best=p; }
            }
            return best;
        };
        auto [ax,ay]=std::make_pair(coneTip( 0,-1).x, coneTip( 0,-1).y); tTx=ax; tTy=ay;
        auto [bx,by]=std::make_pair(coneTip( 1, 0).x, coneTip( 1, 0).y); tRx=bx; tRy=by;
        auto [cx2,cy2]=std::make_pair(coneTip(0,1).x,coneTip(0,1).y);    tBx=cx2;tBy=cy2;
        auto [dx2,dy2]=std::make_pair(coneTip(-1,0).x,coneTip(-1,0).y);  tLx=dx2;tLy=dy2;
    }

    if (!inRange(tTx,tTy)||!inRange(tRx,tRy)||!inRange(tBx,tBy)||!inRange(tLx,tLy))
        { res.error="tips out of range"; return res; }
    if (tTy>=bcy||tBy<=bcy||tLx>=bcx||tRx<=bcx)
        { res.error="tips in wrong direction"; return res; }

    // Step 9: sub-pixel refinement
    {
        int spWin = std::clamp((int)(blobR*0.08), 3, 8);
        subpixelRefine(b5, W, H, tLx, tLy, spWin);
        subpixelRefine(b5, W, H, tRx, tRy, spWin);
        subpixelRefine(b5, W, H, tTx, tTy, spWin);
        subpixelRefine(b5, W, H, tBx, tBy, spWin);
    }

    // Step 10: geometric rhombus fit — removes non-rigidity
    auto rh = fitRhombus(tLx,tLy, tRx,tRy, tTx,tTy, tBx,tBy);
    if (rh.ok && rh.residual < blobR*0.12) {
        tLx=rh.lx; tLy=rh.ly;
        tRx=rh.rx; tRy=rh.ry;
        tTx=rh.tx; tTy=rh.ty;
        tBx=rh.bx; tBy=rh.by;
    }

    // Step 11: validate diagonals
    double hD1=std::hypot(tRx-tLx, tRy-tLy)*0.5;
    double hD2=std::hypot(tBx-tTx, tBy-tTy)*0.5;
    if (hD1<minPx||hD2<minPx) { res.error="diagonals too small"; return res; }
    double ratio=std::min(hD1,hD2)/std::max(hD1,hD2);
    if (ratio < 0.45) { res.error="aspect ratio too low"; return res; }

    res.cx   = (tLx+tRx+tTx+tBx)*0.25;
    res.cy   = (tLy+tRy+tTy+tBy)*0.25;
    res.hD1  = hD1; res.hD2 = hD2;
    res.tipLx=tLx; res.tipLy=tLy;
    res.tipRx=tRx; res.tipRy=tRy;
    res.tipTx=tTx; res.tipTy=tTy;
    res.tipBx=tBx; res.tipBy=tBy;
    res.conf = std::clamp(ratio * 0.95, 0.0, 1.0);
    res.ok   = true;
    return res;
}

// ═══════════════════════════════════════════════════════════════════════════
//  N-API WRAPPER
// ═══════════════════════════════════════════════════════════════════════════

// process(data:Buffer, width:uint, height:uint, params:object) → object
static Napi::Value Process(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4
        || !info[0].IsBuffer()
        || !info[1].IsNumber()
        || !info[2].IsNumber()
        || !info[3].IsObject()) {
        Napi::TypeError::New(env, "process(data:Buffer, width:uint, height:uint, params:object)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto     buf    = info[0].As<Napi::Buffer<uint8_t>>();
    uint32_t W      = info[1].As<Napi::Number>().Uint32Value();
    uint32_t H      = info[2].As<Napi::Number>().Uint32Value();
    auto     params = info[3].As<Napi::Object>();

    if (buf.ByteLength() < (size_t)W * H) {
        Napi::RangeError::New(env, "process: buffer too small for W×H")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Extract params (safe defaults from param.cpp defaults)
    auto numOr = [&](const char* key, double def) -> double {
        Napi::Value v = params.Get(key);
        return v.IsNumber() ? v.As<Napi::Number>().DoubleValue() : def;
    };
    double pxPerMm = numOr("pxPerMm",  100.0);
    double loadKgf = numOr("loadKgf",   10.0);

    if (pxPerMm <= 0) {
        Napi::Object fail = Napi::Object::New(env);
        fail.Set("ok",    Napi::Boolean::New(env, false));
        fail.Set("error", Napi::String::New(env, "invalid pxPerMm — calibrate first"));
        return fail;
    }
    if (loadKgf <= 0) {
        Napi::Object fail = Napi::Object::New(env);
        fail.Set("ok",    Napi::Boolean::New(env, false));
        fail.Set("error", Napi::String::New(env, "invalid loadKgf"));
        return fail;
    }

    // Run the Vickers detection algorithm.
    DetectResult det = detectVickers(buf.Data(), (int)W, (int)H);

    Napi::Object result = Napi::Object::New(env);
    result.Set("ok", Napi::Boolean::New(env, det.ok));

    if (!det.ok) {
        result.Set("error", Napi::String::New(env, det.error));
        return result;
    }

    // Convert pixels → mm using calibration scale factor.
    double d1_mm    = (det.hD1 * 2.0) / pxPerMm;
    double d2_mm    = (det.hD2 * 2.0) / pxPerMm;
    double d_mean   = (d1_mm + d2_mm) * 0.5;
    // HV = 1.8544 × F(kgf) / d²(mm²)
    double hv       = (d_mean > 0) ? (1.8544 * loadKgf / (d_mean * d_mean)) : 0.0;

    double iW = det.imgW, iH = det.imgH;

    result.Set("hv",        Napi::Number::New(env, hv));
    result.Set("d1_mm",     Napi::Number::New(env, d1_mm));
    result.Set("d2_mm",     Napi::Number::New(env, d2_mm));
    result.Set("d_mean_mm", Napi::Number::New(env, d_mean));
    result.Set("confidence",Napi::Number::New(env, det.conf));
    result.Set("px_per_mm", Napi::Number::New(env, pxPerMm));
    result.Set("img_w",     Napi::Number::New(env, det.imgW));
    result.Set("img_h",     Napi::Number::New(env, det.imgH));
    // Normalised overlay coordinates [0, 1]
    result.Set("cx_frac",   Napi::Number::New(env, det.cx    / iW));
    result.Set("cy_frac",   Napi::Number::New(env, det.cy    / iH));
    result.Set("lx_frac",   Napi::Number::New(env, det.tipLx / iW));
    result.Set("ly_frac",   Napi::Number::New(env, det.tipLy / iH));
    result.Set("rx_frac",   Napi::Number::New(env, det.tipRx / iW));
    result.Set("ry_frac",   Napi::Number::New(env, det.tipRy / iH));
    result.Set("tx_frac",   Napi::Number::New(env, det.tipTx / iW));
    result.Set("ty_frac",   Napi::Number::New(env, det.tipTy / iH));
    result.Set("bx_frac",   Napi::Number::New(env, det.tipBx / iW));
    result.Set("by_frac",   Napi::Number::New(env, det.tipBy / iH));

    return result;
}

// ── Module init ──────────────────────────────────────────────────────────────
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("process", Napi::Function::New(env, Process));
    return exports;
}

NODE_API_MODULE(processor, Init)
