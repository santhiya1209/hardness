// backend/native/hikrobot/hikrobot_camera.cpp
// Single-file HikRobot camera N-API addon
// Pure C++ Vickers HV edge detection — NO OpenCV, NO external libs

#define _USE_MATH_DEFINES
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

// HikRobot MVS SDK  (only external dependency)
#include "MvCameraControl.h"

// ─────────────────────────────────────────────────
//  Data structures
// ─────────────────────────────────────────────────
struct FrameData {
    std::vector<unsigned char> jpeg;
    unsigned int width=0, height=0, frameNum=0;
    long long    timestamp=0;
};
struct DeviceInfo {
    std::string  model, serial, ipAddress;
    unsigned int deviceType=0, index=0;
};
struct CameraParams {
    float        exposureUs=10000.f, gainDb=0.f;
    unsigned int width=1280, height=1024;
};
struct MeasureResult {
    bool   success=false;
    double hv=0, d1_mm=0, d2_mm=0, d_mean_mm=0, confidence=0, px_per_mm=0;
    std::string error;
};
struct CalibResult {
    bool   success=false;
    double px_per_mm=0, offset_hv=0, measured_hv=0, error_pct=0;
    std::string message;
};

// ═══════════════════════════════════════════════════════════════════
//  TINY JPEG DECODER  (Y-channel only, baseline DCT)
//  Decodes what MV_CC_SaveImageEx2 produces — no libjpeg needed.
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
            if(bl==0){
                if(bp>=sz)return -1;
                bb=d[bp++];
                if(bb==0xFF&&bp<sz&&d[bp]==0x00)bp++;
                bl=8;
            }
            return(bb>>(--bl))&1;
        };
        int code=0,len=0;
        for(int i=0;i<count;){
            int bit=nb(); if(bit<0)return -1;
            code=(code<<1)|bit; len++;
            for(;i<count&&lengths[i]==len;i++)
                if(codes[i]==(uint16_t)code)return vals[i];
        }
        return -1;
    }
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
    return v;
}

static void idct8(int coeff[64],const QuantTable& qt,uint8_t out[64]){
    float s[64]={};
    for(int i=0;i<64;i++) s[ZZ[i]]=coeff[i]*(float)qt.q[i];
    float t[64];
    for(int r=0;r<8;r++){
        float* row=s+r*8, v[8]={};
        for(int x=0;x<8;x++)
            for(int u=0;u<8;u++)
                v[x]+=(u?1.f:.70710678f)*row[u]*
                       std::cos((2*x+1)*u*(float)M_PI/16.f);
        for(int x=0;x<8;x++) t[r*8+x]=v[x]*.5f;
    }
    for(int c=0;c<8;c++){
        float v[8]={};
        for(int y=0;y<8;y++)
            for(int u=0;u<8;u++)
                v[y]+=(u?1.f:.70710678f)*t[u*8+c]*
                       std::cos((2*y+1)*u*(float)M_PI/16.f);
        for(int y=0;y<8;y++)
            out[y*8+c]=clamp8((int)(v[y]*.5f+128.5f));
    }
}

// Returns W*H Y-channel pixels, empty on error
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
        if(mk==0xD9)break;
        if(mk==0xD8)continue;
        if(pos+2>sz)break;
        int segLen=u16be(jpg+pos);
        const uint8_t* seg=jpg+pos+2; size_t sd=segLen-2;
        if(mk==0xDB){ // DQT
            size_t o=0;
            while(o<sd){
                int info=seg[o++];int pr=(info>>4)&0xF,id=info&0xF;
                if(id>=4)break;
                for(int i=0;i<64;i++){
                    qt[id].q[i]=pr?u16be(seg+o):seg[o];
                    o+=pr?2:1;}
                hasQT[id]=true;}
        } else if(mk==0xC0){ // SOF0
            H=u16be(seg+1); W=u16be(seg+3); nComp=seg[5];
            for(int i=0;i<nComp&&i<4;i++)
                comp[seg[6+i*3]].qtId=seg[6+i*3+2];
        } else if(mk==0xC4){ // DHT
            size_t o=0;
            while(o<sd){
                int info=seg[o++],cls=(info>>4)&1,id=info&0xF;
                if(id>=2)break;
                HuffTable& ht=cls?htAC[id]:htDC[id];
                memset(&ht,0,sizeof(ht));
                int tot=0;
                for(int i=1;i<=16;i++){ht.bits[i]=seg[o++];tot+=ht.bits[i];}
                for(int i=0;i<tot;i++)ht.vals[i]=seg[o++];
                ht.build();
                if(cls)hasAC[id]=true; else hasDC[id]=true;}
        } else if(mk==0xDA){ // SOS
            int sc=seg[0];
            for(int i=0;i<sc;i++){
                int cid=seg[1+i*2],hid=seg[2+i*2];
                comp[cid].dcId=(hid>>4)&0xF;
                comp[cid].acId=hid&0xF;}
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
            int mcuW=(W+7)/8, mcuH=(H+7)/8;
            size_t bp=0; int bb=0,bl=0;
            const uint8_t* rd=raw.data(); size_t rs=raw.size();
            int dcP[5]={};
            for(int my=0;my<mcuH;my++)
            for(int mx=0;mx<mcuW;mx++){
                for(int ci=1;ci<=nComp;ci++){
                    int di=comp[ci].dcId,ai=comp[ci].acId,qi=comp[ci].qtId;
                    if(!hasDC[di]||!hasAC[ai]||!hasQT[qi])continue;
                    int cf[64]={};
                    int dcS=htDC[di].decode(rd,rs,bp,bb,bl);
                    if(dcS<0)goto done;
                    dcP[ci]+=recvBits(dcS,rd,rs,bp,bb,bl);
                    cf[0]=dcP[ci];
                    for(int k=1;k<64;){
                        int acS=htAC[ai].decode(rd,rs,bp,bb,bl);
                        if(acS<0)goto done;
                        if(!acS)break;
                        if(acS==0xF0){k+=16;continue;}
                        int run=(acS>>4)&0xF,cat=acS&0xF;
                        k+=run; if(k>=64)break;
                        cf[k++]=recvBits(cat,rd,rs,bp,bb,bl);}
                    if(ci==1){ // store Y only
                        uint8_t blk[64]; idct8(cf,qt[qi],blk);
                        int bx=mx*8,by=my*8;
                        for(int r=0;r<8;r++){int y=by+r;if(y>=H)break;
                            for(int c=0;c<8;c++){int x=bx+c;if(x>=W)break;
                                gray[y*W+x]=blk[r*8+c];}}}}}
            done: return gray;}
        pos+=segLen;}
    return{};
}
} // TinyJpeg

// ═══════════════════════════════════════════════════════════════════
//  PURE C++ IMAGE ALGORITHMS
// ═══════════════════════════════════════════════════════════════════

// ── Gaussian blur 5×5 ────────────────────────────────────────────
static std::vector<float> gblur5(const uint8_t* s,int W,int H){
    static const float K[]={.0625f,.25f,.375f,.25f,.0625f};
    std::vector<float> t(W*H),o(W*H);
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        float v=0; for(int k=-2;k<=2;k++){int xx=std::max(0,std::min(W-1,x+k));v+=K[k+2]*s[y*W+xx];}
        t[y*W+x]=v;}
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        float v=0; for(int k=-2;k<=2;k++){int yy=std::max(0,std::min(H-1,y+k));v+=K[k+2]*t[yy*W+x];}
        o[y*W+x]=v;}
    return o;
}

// ── Gaussian blur 11×11 ───────────────────────────────────────────
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
    return o;
}

// ── Otsu threshold ────────────────────────────────────────────────
static float otsu(const std::vector<float>& img,int N){
    int h[256]={};
    for(int i=0;i<N;i++) h[std::max(0,std::min(255,(int)img[i]))]++;
    double tot=N,s=0; for(int i=0;i<256;i++) s+=i*h[i];
    double sb=0,wb=0,mv=0; float thr=128;
    for(int i=0;i<256;i++){
        wb+=h[i]; if(!wb)continue;
        double wf=tot-wb; if(!wf)break;
        sb+=i*h[i];
        double mb=sb/wb,mf=(s-sb)/wf;
        double v=wb*wf*(mb-mf)*(mb-mf);
        if(v>mv){mv=v;thr=(float)i;}}
    return thr;
}

// ── Morphological close 15×15 circle ─────────────────────────────
static std::vector<uint8_t> close15(const std::vector<uint8_t>& src,int W,int H){
    int R=7;
    // Dilate
    std::vector<uint8_t> dil(W*H,0);
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        uint8_t v=0;
        for(int dy=-R;dy<=R&&!v;dy++){int yy=y+dy;if(yy<0||yy>=H)continue;
            for(int dx=-R;dx<=R&&!v;dx++){int xx=x+dx;if(xx<0||xx>=W)continue;
                if(dy*dy+dx*dx<=R*R) v=src[yy*W+xx];}}
        dil[y*W+x]=v;}
    // Erode
    std::vector<uint8_t> ero(W*H,0);
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){
        uint8_t all=1;
        for(int dy=-R;dy<=R&&all;dy++){int yy=y+dy;if(yy<0||yy>=H){all=0;break;}
            for(int dx=-R;dx<=R&&all;dx++){int xx=x+dx;if(xx<0||xx>=W){all=0;break;}
                if(dy*dy+dx*dx<=R*R&&!dil[yy*W+xx])all=0;}}
        ero[y*W+x]=all;}
    return ero;
}

// ── Blob centroid finder ──────────────────────────────────────────
struct Blob{double cx,cy;int area,bw,bh;};
static std::vector<Blob> blobs(const std::vector<uint8_t>& bin,int W,int H,int mn,int mx){
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
    return out;
}

// ── Canny edge detector (Sobel + NMS + hysteresis) ────────────────
static std::vector<uint8_t> canny(const std::vector<float>& g,int W,int H,float lo,float hi){
    std::vector<float> mag(W*H,0); std::vector<int> dir(W*H,0);
    for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++){
        float gx=-g[(y-1)*W+x-1]+g[(y-1)*W+x+1]-2*g[y*W+x-1]+2*g[y*W+x+1]-g[(y+1)*W+x-1]+g[(y+1)*W+x+1];
        float gy=-g[(y-1)*W+x-1]-2*g[(y-1)*W+x]-g[(y-1)*W+x+1]+g[(y+1)*W+x-1]+2*g[(y+1)*W+x]+g[(y+1)*W+x+1];
        mag[y*W+x]=std::sqrt(gx*gx+gy*gy);
        float a=std::atan2(std::abs(gy),std::abs(gx))*180.f/(float)M_PI;
        dir[y*W+x]=a<22.5f?0:a<67.5f?(gx*gy>0?1:3):2;}
    // NMS
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
    // Hysteresis
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
    return out;
}

// ── Dilate 3×3 ────────────────────────────────────────────────────
static std::vector<uint8_t> dil3(const std::vector<uint8_t>& s,int W,int H){
    std::vector<uint8_t> d(W*H,0);
    for(int y=1;y<H-1;y++) for(int x=1;x<W-1;x++){
        uint8_t v=0;
        for(int dy=-1;dy<=1&&!v;dy++) for(int dx=-1;dx<=1&&!v;dx++)
            v=s[(y+dy)*W+x+dx];
        d[y*W+x]=v;}
    return d;
}

// ── IQR-robust extreme ────────────────────────────────────────────
static double robExt(std::vector<double>& a,bool mn){
    if(a.empty())return 0;
    std::sort(a.begin(),a.end());
    double q1=a[(int)(a.size()*.25)],q3=a[(int)(a.size()*.75)];
    double iqr=q3-q1,lo=q1-1.5*iqr,hi=q3+1.5*iqr;
    std::vector<double> f; for(double x:a)if(x>=lo&&x<=hi)f.push_back(x);
    auto& s=f.size()>=2?f:a;
    return mn?s.front():s.back();
}

// ── Main Vickers detector ─────────────────────────────────────────
struct DR{bool ok=false;double cx=0,cy=0,hD1=0,hD2=0,conf=0;};

static DR detectVickers(const std::vector<uint8_t>& jpg,double t1=0,double t2=0){
    DR res; if(jpg.empty())return res;
    int W=0,H=0;
    auto gray=TinyJpeg::decodeGray(jpg.data(),jpg.size(),W,H);
    if(gray.empty()||W<=0||H<=0)return res;
    int N=W*H; double fcx=W*.5,fcy=H*.5,dg=std::hypot(W,H);

    // 1. Centre detection via Otsu + blobs
    auto b11=gblur11(gray.data(),W,H);
    float thr=otsu(b11,N);
    std::vector<uint8_t> binInv(N);
    for(int i=0;i<N;i++) binInv[i]=(b11[i]<thr)?1:0;
    auto cl=close15(binInv,W,H);
    auto bls=blobs(cl,W,H,(int)(N*.003),(int)(N*.35));
    double cx=fcx,cy=fcy,bst=-1;
    for(auto& b:bls){
        if(b.bw<5||b.bh<5)continue;
        double asp=(double)std::min(b.bw,b.bh)/std::max(b.bw,b.bh);
        double dist=std::hypot(b.cx-fcx,b.cy-fcy)/dg;
        double sc=b.area*asp*asp*std::exp(-dist*3.);
        if(sc>bst){bst=sc;cx=b.cx;cy=b.cy;}}

    // 2. Canny edges
    auto b5=gblur5(gray.data(),W,H);
    float lo,hi;
    if(t1>0&&t2>0){lo=(float)t1;hi=(float)t2;}
    else{
        std::vector<float> tmp=b5;
        std::nth_element(tmp.begin(),tmp.begin()+N/2,tmp.end());
        float med=tmp[N/2];
        lo=std::max(10.f,med*.66f); hi=std::min(250.f,med*1.33f);}
    auto edges=canny(b5,W,H,lo,hi);
    auto dil=dil3(edges,W,H);

    // 3. Collect tip pixels in ROI around centre
    double minPx=std::min(W,H)*.03, maxPx=std::min(W,H)*.80;
    int roi=(int)(std::min(W,H)*.45);
    int rx0=std::max(0,(int)cx-roi),rx1=std::min(W-1,(int)cx+roi);
    int ry0=std::max(0,(int)cy-roi),ry1=std::min(H-1,(int)cy+roi);
    int bH=std::max(4,(int)((ry1-ry0)*.20));
    int bW=std::max(4,(int)((rx1-rx0)*.20));

    std::vector<double> lA,rA,tA,bA;
    for(int row=(int)cy-bH;row<=(int)cy+bH;row++){
        if(row<ry0||row>ry1)continue;
        for(int c=rx0;c<=rx1;c++) if(dil[row*W+c]){lA.push_back(c);break;}
        for(int c=rx1;c>=rx0;c--) if(dil[row*W+c]){rA.push_back(c);break;}}
    for(int col=(int)cx-bW;col<=(int)cx+bW;col++){
        if(col<rx0||col>rx1)continue;
        for(int r=ry0;r<=ry1;r++) if(dil[r*W+col]){tA.push_back(r);break;}
        for(int r=ry1;r>=ry0;r--) if(dil[r*W+col]){bA.push_back(r);break;}}

    if(lA.size()>=3&&tA.size()>=3){
        double lx=robExt(lA,true),rx2=robExt(rA,false);
        double ty=robExt(tA,true),by=robExt(bA,false);
        double hd1=(rx2-lx)*.5,hd2=(by-ty)*.5;
        if(hd1>=minPx&&hd2>=minPx&&hd1<=maxPx&&hd2<=maxPx){
            res.hD1=hd1; res.hD2=hd2;
            res.cx=(lx+rx2)*.5; res.cy=(ty+by)*.5;
            res.conf=std::min(1.,std::min(hd1,hd2)/std::max(hd1,hd2)*.95);
            res.ok=true; return res;}}

    // 4. Intensity scanline fallback
    std::vector<double> bg;
    for(double fr:{.25,.30,.35}){
        int d2=(int)(std::min(W,H)*fr);
        for(int a=0;a<360;a+=20){
            double r2=a*M_PI/180.;
            int sx=(int)(cx+d2*std::cos(r2)),sy=(int)(cy+d2*std::sin(r2));
            if(sx>0&&sx<W-1&&sy>0&&sy<H-1) bg.push_back(b5[sy*W+sx]);}}
    if(bg.size()<6)return res;
    std::sort(bg.begin(),bg.end());
    double bgE=bg[(int)(bg.size()*.75)],indE=bg[(int)(bg.size()*.10)];
    double wall=(bgE+indE)*.5;
    auto scanE=[&](double sx,double sy,double dx,double dy)->double{
        int mr=(int)(std::min(W,H)*.48);
        double prev=b5[(int)sy*W+(int)sx],tip=dx?sx:sy;
        for(int r=1;r<=mr;r++){
            int x=(int)(sx+dx*r),y=(int)(sy+dy*r);
            if(x<=0||x>=W-1||y<=0||y>=H-1)break;
            double v=b5[y*W+x];
            if(prev<wall&&v>=wall){tip=dx?x:y;break;}
            prev=v;}
        return tip;};
    std::vector<double> lA2,rA2,tA2,bA2;
    int step=std::max(2,(int)(std::min(W,H)*.01));
    int span=(int)(std::min(W,H)*.08);
    for(int off=-span;off<=span;off+=step){
        double sy2=cy+off; if(sy2>1&&sy2<H-2){lA2.push_back(scanE(cx,sy2,-1,0));rA2.push_back(scanE(cx,sy2,1,0));}
        double sx2=cx+off; if(sx2>1&&sx2<W-2){tA2.push_back(scanE(sx2,cy,0,-1));bA2.push_back(scanE(sx2,cy,0,1));}}
    if(lA2.size()<3||tA2.size()<3)return res;
    double lx=robExt(lA2,true),rx2=robExt(rA2,false);
    double ty=robExt(tA2,true),by=robExt(bA2,false);
    double hd1=(rx2-lx)*.5,hd2=(by-ty)*.5;
    if(hd1<minPx||hd2<minPx)return res;
    res.hD1=hd1; res.hD2=hd2;
    res.cx=(lx+rx2)*.5; res.cy=(ty+by)*.5;
    res.conf=.40; res.ok=true;
    return res;
}

// ─────────────────────────────────────────────────
//  Camera class
// ─────────────────────────────────────────────────
class HikrobotCamera {
public:
    HikrobotCamera():m_handle(nullptr),m_isOpen(false),m_isGrabbing(false),m_grabRunning(false),m_hasFrame(false){MV_CC_Initialize();}
    ~HikrobotCamera(){stopGrabbing();closeDevice();MV_CC_Finalize();}

    std::string getSDKVersion()const{
        unsigned v=MV_CC_GetSDKVersion();
        std::ostringstream ss;
        ss<<((v>>24)&0xFF)<<"."<<((v>>16)&0xFF)<<"."<<((v>>8)&0xFF)<<"."<<(v&0xFF);
        return ss.str();}

    std::vector<DeviceInfo> enumDevices(){
        std::vector<DeviceInfo> out;
        MV_CC_DEVICE_INFO_LIST list; memset(&list,0,sizeof(list));
        if(MV_CC_EnumDevices(MV_GIGE_DEVICE|MV_USB_DEVICE,&list)!=MV_OK)return out;
        for(unsigned i=0;i<list.nDeviceNum;i++){
            MV_CC_DEVICE_INFO* p=list.pDeviceInfo[i];
            DeviceInfo d; d.index=i;
            if(p->nTLayerType==MV_USB_DEVICE){d.deviceType=1;d.model=(char*)p->SpecialInfo.stUsb3VInfo.chModelName;d.serial=(char*)p->SpecialInfo.stUsb3VInfo.chSerialNumber;}
            else{d.deviceType=2;d.model=(char*)p->SpecialInfo.stGigEInfo.chModelName;d.serial=(char*)p->SpecialInfo.stGigEInfo.chSerialNumber;
                unsigned ip=p->SpecialInfo.stGigEInfo.nCurrentIp;
                std::ostringstream ss;ss<<((ip>>24)&0xFF)<<"."<<((ip>>16)&0xFF)<<"."<<((ip>>8)&0xFF)<<"."<<(ip&0xFF);d.ipAddress=ss.str();}
            out.push_back(d);}
        return out;}

    bool openDevice(unsigned index=0){
        if(m_isOpen)closeDevice();
        MV_CC_DEVICE_INFO_LIST list; memset(&list,0,sizeof(list));
        int ret=MV_CC_EnumDevices(MV_GIGE_DEVICE|MV_USB_DEVICE,&list);
        if(ret!=MV_OK||!list.nDeviceNum){setErr("No devices");return false;}
        if(index>=list.nDeviceNum){setErr("Index out of range");return false;}
        ret=MV_CC_CreateHandle(&m_handle,list.pDeviceInfo[index]);
        if(ret!=MV_OK){setErr("CreateHandle failed");return false;}
        ret=MV_CC_OpenDevice(m_handle);
        if(ret!=MV_OK){MV_CC_DestroyHandle(m_handle);m_handle=nullptr;setErr("OpenDevice failed");return false;}
        if(list.pDeviceInfo[index]->nTLayerType==MV_GIGE_DEVICE){int pkt=MV_CC_GetOptimalPacketSize(m_handle);if(pkt>0)MV_CC_SetIntValueEx(m_handle,"GevSCPSPacketSize",pkt);}
        MV_CC_SetEnumValue(m_handle,"PixelFormat",PixelType_Gvsp_RGB8_Packed);
        MV_CC_DEVICE_INFO* p=list.pDeviceInfo[index];
        m_device.index=index;
        if(p->nTLayerType==MV_USB_DEVICE){m_device.deviceType=1;m_device.model=(char*)p->SpecialInfo.stUsb3VInfo.chModelName;m_device.serial=(char*)p->SpecialInfo.stUsb3VInfo.chSerialNumber;}
        else{m_device.deviceType=2;m_device.model=(char*)p->SpecialInfo.stGigEInfo.chModelName;m_device.serial=(char*)p->SpecialInfo.stGigEInfo.chSerialNumber;}
        m_isOpen=true; return true;}

    bool closeDevice(){if(!m_isOpen)return true;stopGrabbing();if(m_handle){MV_CC_CloseDevice(m_handle);MV_CC_DestroyHandle(m_handle);m_handle=nullptr;}m_isOpen=false;return true;}
    bool isOpen()const{return m_isOpen;}
    bool isGrabbing()const{return m_isGrabbing;}

    bool startGrabbing(){
        if(!m_isOpen){setErr("Not open");return false;}
        if(m_isGrabbing)return true;
        if(MV_CC_StartGrabbing(m_handle)!=MV_OK){setErr("StartGrabbing failed");return false;}
        m_isGrabbing=m_grabRunning=true;
        m_grabThread=std::thread(&HikrobotCamera::grabLoop,this);
        return true;}

    bool stopGrabbing(){
        if(!m_isGrabbing)return true;
        m_grabRunning=false;
        if(m_grabThread.joinable())m_grabThread.join();
        if(m_handle)MV_CC_StopGrabbing(m_handle);
        m_isGrabbing=false; return true;}

    bool getLatestFrame(FrameData& out){
        if(!m_hasFrame)return false;
        std::lock_guard<std::mutex> lk(m_mutex);
        out=m_latestFrame; return true;}

    bool setExposure(float us){if(!m_isOpen)return false;MV_CC_SetEnumValue(m_handle,"ExposureAuto",0);return MV_CC_SetFloatValue(m_handle,"ExposureTime",us)==MV_OK;}
    bool setGain(float db){if(!m_isOpen)return false;MV_CC_SetEnumValue(m_handle,"GainAuto",0);return MV_CC_SetFloatValue(m_handle,"Gain",db)==MV_OK;}

    bool getParams(CameraParams& p){
        if(!m_isOpen)return false;
        MVCC_FLOATVALUE fv; MVCC_INTVALUE_EX iv;
        if(MV_CC_GetFloatValue(m_handle,"ExposureTime",&fv)==MV_OK)p.exposureUs=fv.fCurValue;
        if(MV_CC_GetFloatValue(m_handle,"Gain",&fv)==MV_OK)p.gainDb=fv.fCurValue;
        if(MV_CC_GetIntValueEx(m_handle,"Width",&iv)==MV_OK)p.width=(unsigned)iv.nCurValue;
        if(MV_CC_GetIntValueEx(m_handle,"Height",&iv)==MV_OK)p.height=(unsigned)iv.nCurValue;
        return true;}

    bool setParams(const CameraParams& p){
        bool ok=setExposure(p.exposureUs)&setGain(p.gainDb);
        if(p.width&&p.height){MV_CC_SetIntValueEx(m_handle,"Width",p.width);MV_CC_SetIntValueEx(m_handle,"Height",p.height);}
        return ok;}

    bool saveSnapshot(const std::string& fp){
        FrameData fr; if(!getLatestFrame(fr)){setErr("No frame");return false;}
        FILE* f=fopen(fp.c_str(),"wb"); if(!f){setErr("Cannot open file");return false;}
        fwrite(fr.jpeg.data(),1,fr.jpeg.size(),f); fclose(f); return true;}

    MeasureResult measureHV(double pxPerMm,double loadKgf,double t1=0,double t2=0){
        MeasureResult r; r.px_per_mm=pxPerMm;
        if(!m_isGrabbing){r.error="Not grabbing";return r;}
        if(pxPerMm<=0){r.error="Invalid px/mm";return r;}
        if(loadKgf<=0){r.error="Invalid load";return r;}
        FrameData fr;
        for(int i=0;i<20&&!getLatestFrame(fr);i++)
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        if(fr.jpeg.empty()){r.error="No frame";return r;}
        DR det=detectVickers(fr.jpeg,t1,t2);
        if(!det.ok){r.error="Edge detection failed — check focus/exposure";return r;}
        r.d1_mm=(det.hD1*2.)/pxPerMm;
        r.d2_mm=(det.hD2*2.)/pxPerMm;
        r.d_mean_mm=(r.d1_mm+r.d2_mm)*.5;
        if(r.d_mean_mm>0) r.hv=1.8544*loadKgf/(r.d_mean_mm*r.d_mean_mm);
        r.confidence=det.conf; r.success=true;
        return r;}

    CalibResult calibrate(double refHV,double loadKgf){
        CalibResult r;
        MeasureResult m=measureHV(100.,loadKgf);
        if(!m.success){r.message=m.error;return r;}
        double d_um=std::sqrt(1854.4*loadKgf/refHV);
        double pxPerMm=(m.d_mean_mm*100.)/(d_um/1000.);
        double measHV=1.8544*loadKgf/(m.d_mean_mm*m.d_mean_mm);
        r.success=true;r.px_per_mm=pxPerMm;r.offset_hv=refHV-measHV;
        r.measured_hv=measHV;r.error_pct=(measHV-refHV)/refHV*100.;r.message="OK";
        return r;}

    std::string getLastError()const{return m_lastError;}
    DeviceInfo getCurrentDevice()const{return m_device;}

private:
    void* m_handle;
    std::atomic<bool> m_isOpen,m_isGrabbing,m_grabRunning,m_hasFrame;
    std::string m_lastError; DeviceInfo m_device;
    std::mutex m_mutex; FrameData m_latestFrame; std::thread m_grabThread;

    void grabLoop(){
        MV_FRAME_OUT fr;
        while(m_grabRunning){
            memset(&fr,0,sizeof(fr));
            if(MV_CC_GetImageBuffer(m_handle,&fr,100)==MV_OK){
                FrameData fd;
                if(toJpeg(fr,fd)){std::lock_guard<std::mutex> lk(m_mutex);m_latestFrame=std::move(fd);m_hasFrame=true;}
                MV_CC_FreeImageBuffer(m_handle,&fr);}
            std::this_thread::sleep_for(std::chrono::milliseconds(8));}}

    bool toJpeg(MV_FRAME_OUT& src,FrameData& dst){
        unsigned w=src.stFrameInfo.nWidth,h=src.stFrameInfo.nHeight;
        unsigned bsz=w*h*3+2048; std::vector<unsigned char> buf(bsz,0);
        MV_SAVE_IMAGE_PARAM_EX sp; memset(&sp,0,sizeof(sp));
        sp.enImageType=MV_Image_Jpeg; sp.enPixelType=src.stFrameInfo.enPixelType;
        sp.nWidth=w;sp.nHeight=h;sp.nDataLen=src.stFrameInfo.nFrameLen;
        sp.pData=src.pBufAddr;sp.nJpgQuality=85;sp.pImageBuffer=buf.data();sp.nBufferSize=bsz;
        if(MV_CC_SaveImageEx2(m_handle,&sp)!=MV_OK)return false;
        dst.jpeg.resize(sp.nImageLen);memcpy(dst.jpeg.data(),buf.data(),sp.nImageLen);
        dst.width=w;dst.height=h;dst.frameNum=src.stFrameInfo.nFrameNum;
        dst.timestamp=std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        return true;}

    void setErr(const std::string& m){m_lastError=m;std::cerr<<"[Hikrobot] "<<m<<"\n";}
};

// ─────────────────────────────────────────────────
//  Base64
// ─────────────────────────────────────────────────
static const char B64C[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static std::string b64enc(const unsigned char* buf,size_t len){
    std::string r;r.reserve(((len+2)/3)*4);
    for(size_t i=0;i<len;i+=3){
        unsigned b=(buf[i]<<16)|(i+1<len?buf[i+1]<<8:0)|(i+2<len?buf[i+2]:0);
        r+=B64C[(b>>18)&0x3F];r+=B64C[(b>>12)&0x3F];
        r+=(i+1<len)?B64C[(b>>6)&0x3F]:'=';
        r+=(i+2<len)?B64C[b&0x3F]:'=';}
    return r;}

static HikrobotCamera g_cam;

// N-API bindings
Napi::Value NGetSDKVersion(const Napi::CallbackInfo& i){return Napi::String::New(i.Env(),g_cam.getSDKVersion());}
Napi::Value NEnumDevices(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();auto ds=g_cam.enumDevices();
    Napi::Array a=Napi::Array::New(e,ds.size());
    for(size_t k=0;k<ds.size();k++){Napi::Object o=Napi::Object::New(e);
        o.Set("model",Napi::String::New(e,ds[k].model));o.Set("serial",Napi::String::New(e,ds[k].serial));
        o.Set("ipAddress",Napi::String::New(e,ds[k].ipAddress));o.Set("deviceType",Napi::Number::New(e,ds[k].deviceType));
        o.Set("index",Napi::Number::New(e,ds[k].index));a[k]=o;}return a;}
Napi::Value NOpenDevice(const Napi::CallbackInfo& info){
    unsigned idx=(info.Length()>0&&info[0].IsNumber())?info[0].As<Napi::Number>().Uint32Value():0;
    bool ok=g_cam.openDevice(idx);Napi::Object r=Napi::Object::New(info.Env());
    r.Set("success",Napi::Boolean::New(info.Env(),ok));r.Set("error",Napi::String::New(info.Env(),g_cam.getLastError()));return r;}
Napi::Value NCloseDevice(const Napi::CallbackInfo& i){return Napi::Boolean::New(i.Env(),g_cam.closeDevice());}
Napi::Value NStartGrabbing(const Napi::CallbackInfo& info){
    bool ok=g_cam.startGrabbing();Napi::Object r=Napi::Object::New(info.Env());
    r.Set("success",Napi::Boolean::New(info.Env(),ok));r.Set("error",Napi::String::New(info.Env(),g_cam.getLastError()));return r;}
Napi::Value NStopGrabbing(const Napi::CallbackInfo& i){return Napi::Boolean::New(i.Env(),g_cam.stopGrabbing());}
Napi::Value NGetFrame(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();FrameData f;bool ok=g_cam.getLatestFrame(f);
    Napi::Object r=Napi::Object::New(e);r.Set("success",Napi::Boolean::New(e,ok));
    if(ok&&!f.jpeg.empty()){r.Set("frame",Napi::String::New(e,b64enc(f.jpeg.data(),f.jpeg.size())));
        r.Set("width",Napi::Number::New(e,f.width));r.Set("height",Napi::Number::New(e,f.height));
        r.Set("frameNum",Napi::Number::New(e,f.frameNum));r.Set("timestamp",Napi::Number::New(e,(double)f.timestamp));}
    else r.Set("error",Napi::String::New(e,g_cam.getLastError()));return r;}
Napi::Value NGetStatus(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();Napi::Object r=Napi::Object::New(e);
    r.Set("sdkVersion",Napi::String::New(e,g_cam.getSDKVersion()));
    r.Set("cameraOpen",Napi::Boolean::New(e,g_cam.isOpen()));r.Set("grabbing",Napi::Boolean::New(e,g_cam.isGrabbing()));
    DeviceInfo d=g_cam.getCurrentDevice();Napi::Object dev=Napi::Object::New(e);
    dev.Set("model",Napi::String::New(e,d.model));dev.Set("serial",Napi::String::New(e,d.serial));
    dev.Set("type",Napi::String::New(e,d.deviceType==1?"USB3":"GigE"));r.Set("device",dev);
    CameraParams p;if(g_cam.isOpen()&&g_cam.getParams(p)){Napi::Object po=Napi::Object::New(e);
        po.Set("exposure_us",Napi::Number::New(e,p.exposureUs));po.Set("gain_db",Napi::Number::New(e,p.gainDb));
        po.Set("width",Napi::Number::New(e,p.width));po.Set("height",Napi::Number::New(e,p.height));r.Set("params",po);}
    return r;}
Napi::Value NSetParams(const Napi::CallbackInfo& info){
    if(info.Length()<1||!info[0].IsObject())return Napi::Boolean::New(info.Env(),false);
    Napi::Object opts=info[0].As<Napi::Object>();CameraParams p;g_cam.getParams(p);
    if(opts.Has("exposureUs"))p.exposureUs=opts.Get("exposureUs").As<Napi::Number>().FloatValue();
    if(opts.Has("gainDb"))p.gainDb=opts.Get("gainDb").As<Napi::Number>().FloatValue();
    if(opts.Has("width"))p.width=opts.Get("width").As<Napi::Number>().Uint32Value();
    if(opts.Has("height"))p.height=opts.Get("height").As<Napi::Number>().Uint32Value();
    bool ok=g_cam.setParams(p);Napi::Object r=Napi::Object::New(info.Env());
    r.Set("success",Napi::Boolean::New(info.Env(),ok));r.Set("error",Napi::String::New(info.Env(),g_cam.getLastError()));return r;}
Napi::Value NMeasureHV(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();double pm=100.,lk=10.,t1=0,t2=0;
    if(info.Length()>0&&info[0].IsObject()){Napi::Object o=info[0].As<Napi::Object>();
        if(o.Has("pxPerMm"))pm=o.Get("pxPerMm").As<Napi::Number>().DoubleValue();
        if(o.Has("loadKgf"))lk=o.Get("loadKgf").As<Napi::Number>().DoubleValue();
        if(o.Has("cannyT1"))t1=o.Get("cannyT1").As<Napi::Number>().DoubleValue();
        if(o.Has("cannyT2"))t2=o.Get("cannyT2").As<Napi::Number>().DoubleValue();}
    MeasureResult m=g_cam.measureHV(pm,lk,t1,t2);Napi::Object r=Napi::Object::New(e);
    r.Set("success",Napi::Boolean::New(e,m.success));r.Set("hv",Napi::Number::New(e,m.hv));
    r.Set("d1_mm",Napi::Number::New(e,m.d1_mm));r.Set("d2_mm",Napi::Number::New(e,m.d2_mm));
    r.Set("d_mean_mm",Napi::Number::New(e,m.d_mean_mm));r.Set("confidence",Napi::Number::New(e,m.confidence));
    r.Set("px_per_mm",Napi::Number::New(e,m.px_per_mm));r.Set("error",Napi::String::New(e,m.error));return r;}
Napi::Value NCalibrate(const Napi::CallbackInfo& info){
    Napi::Env e=info.Env();double refHV=200.,lk=10.;
    if(info.Length()>0&&info[0].IsObject()){Napi::Object o=info[0].As<Napi::Object>();
        if(o.Has("refHV"))refHV=o.Get("refHV").As<Napi::Number>().DoubleValue();
        if(o.Has("loadKgf"))lk=o.Get("loadKgf").As<Napi::Number>().DoubleValue();}
    CalibResult c=g_cam.calibrate(refHV,lk);Napi::Object r=Napi::Object::New(e);
    r.Set("success",Napi::Boolean::New(e,c.success));r.Set("px_per_mm",Napi::Number::New(e,c.px_per_mm));
    r.Set("offset_hv",Napi::Number::New(e,c.offset_hv));r.Set("measured_hv",Napi::Number::New(e,c.measured_hv));
    r.Set("error_pct",Napi::Number::New(e,c.error_pct));r.Set("message",Napi::String::New(e,c.message));return r;}
Napi::Value NSaveSnapshot(const Napi::CallbackInfo& info){
    std::string fp=(info.Length()>0&&info[0].IsString())?info[0].As<Napi::String>().Utf8Value():"snapshot.jpg";
    return Napi::Boolean::New(info.Env(),g_cam.saveSnapshot(fp));}

Napi::Object Init(Napi::Env env,Napi::Object exports){
    exports.Set("getSDKVersion",Napi::Function::New(env,NGetSDKVersion));
    exports.Set("enumDevices",  Napi::Function::New(env,NEnumDevices));
    exports.Set("openDevice",   Napi::Function::New(env,NOpenDevice));
    exports.Set("closeDevice",  Napi::Function::New(env,NCloseDevice));
    exports.Set("startGrabbing",Napi::Function::New(env,NStartGrabbing));
    exports.Set("stopGrabbing", Napi::Function::New(env,NStopGrabbing));
    exports.Set("getFrame",     Napi::Function::New(env,NGetFrame));
    exports.Set("getStatus",    Napi::Function::New(env,NGetStatus));
    exports.Set("setParams",    Napi::Function::New(env,NSetParams));
    exports.Set("measureHV",    Napi::Function::New(env,NMeasureHV));
    exports.Set("calibrate",    Napi::Function::New(env,NCalibrate));
    exports.Set("saveSnapshot", Napi::Function::New(env,NSaveSnapshot));
    return exports;}

NODE_API_MODULE(hikrobot_camera,Init)
