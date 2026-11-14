// Software HEVC video decoder for the RS player: one compressed frame in,
// 8-bit I420 picture out. Used only when the phone has no working HEVC
// decoder of its own (WebCodecs/hardware are tried first).
// Built with emscripten against FFmpeg with only the hevc decoder enabled.
#include <libavcodec/avcodec.h>
#include <libavutil/pixdesc.h>
#include <emscripten/emscripten.h>
#include <string.h>
#include <stdlib.h>

static AVCodecContext *ctx = NULL;
static AVPacket *pkt = NULL;
static AVFrame *frm = NULL;
static uint8_t *out = NULL;
static int out_cap = 0;
static int out_w = 0, out_h = 0;
static double out_pts = 0;

EMSCRIPTEN_KEEPALIVE void rv_close(void) {
  if (ctx) avcodec_free_context(&ctx);
  if (pkt) av_packet_free(&pkt);
  if (frm) av_frame_free(&frm);
  ctx = NULL; pkt = NULL; frm = NULL;
}

static int open_threads = 1;
/** Threads for the next rv_open (only the multi-thread build can use > 1). */
EMSCRIPTEN_KEEPALIVE void rv_set_threads(int n) { open_threads = n < 1 ? 1 : n > 8 ? 8 : n; }

/** codec: 1 = HEVC, 2 = H.264. Returns 0 on success. */
EMSCRIPTEN_KEEPALIVE int rv_open(int codec, const uint8_t *extra, int extra_len) {
  rv_close();
  const AVCodec *c = avcodec_find_decoder(codec == 2 ? AV_CODEC_ID_H264 : AV_CODEC_ID_HEVC);
  if (!c) return -1;
  ctx = avcodec_alloc_context3(c);
  if (!ctx) return -2;
  if (extra && extra_len > 0) {
    ctx->extradata = av_mallocz(extra_len + AV_INPUT_BUFFER_PADDING_SIZE);
    memcpy(ctx->extradata, extra, extra_len);
    ctx->extradata_size = extra_len;
  }
  ctx->thread_count = open_threads;
  // Frame threads decode several pictures at once (the big win for HEVC);
  // slice threads also split one picture when the file allows it.
  if (open_threads > 1) ctx->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
  ctx->flags2 |= AV_CODEC_FLAG2_FAST;
  if (avcodec_open2(ctx, c, NULL) < 0) { rv_close(); return -3; }
  pkt = av_packet_alloc();
  frm = av_frame_alloc();
  return 0;
}

/** Raised step by step while the phone falls behind; motion stays smooth as
 *  long as possible (filters go first, whole pictures last):
 *  0 = full quality, 1 = no deblocking/SAO (every picture still shown),
 *  2 = also skip non-reference pictures, 3 = keyframes only. */
EMSCRIPTEN_KEEPALIVE void rv_set_skip(int level) {
  if (!ctx) return;
  ctx->skip_frame = level >= 3 ? AVDISCARD_NONKEY : level >= 2 ? AVDISCARD_NONREF : AVDISCARD_DEFAULT;
  ctx->skip_loop_filter = level >= 1 ? AVDISCARD_ALL : AVDISCARD_DEFAULT;
}

/** Returns 0 when accepted, 1 when the decoder is full (receive first), <0 on error. */
EMSCRIPTEN_KEEPALIVE int rv_send(const uint8_t *data, int len, double pts) {
  if (!ctx) return -1;
  pkt->data = (uint8_t *)data; pkt->size = len;
  pkt->pts = (int64_t)pts; pkt->dts = AV_NOPTS_VALUE;
  int r = avcodec_send_packet(ctx, pkt);
  if (r == AVERROR(EAGAIN)) return 1;
  if (r == AVERROR_INVALIDDATA) return 0; // corrupt packet: skip it, keep going
  return r < 0 ? -2 : 0;
}

EMSCRIPTEN_KEEPALIVE int rv_send_eof(void) {
  if (!ctx) return -1;
  return avcodec_send_packet(ctx, NULL) < 0 ? -2 : 0;
}

static int ensure_out(int w, int h) {
  int need = w * h + 2 * ((w + 1) / 2) * ((h + 1) / 2);
  if (need > out_cap) {
    uint8_t *n = realloc(out, need);
    if (!n) return -1;
    out = n; out_cap = need;
  }
  return 0;
}

/* Any planar YUV (8..16 bit, 420/422/444) → 8-bit I420. */
static int convert(AVFrame *f) {
  const AVPixFmtDescriptor *d = av_pix_fmt_desc_get(f->format);
  if (!d || (d->flags & AV_PIX_FMT_FLAG_RGB) || d->nb_components < 3) return -1;
  int w = f->width & ~1, h = f->height & ~1;
  if (w <= 0 || h <= 0 || ensure_out(w, h) < 0) return -1;
  int deep = d->comp[0].depth > 8;
  int shift = d->comp[0].depth - 8;
  int cw = w / 2, ch = h / 2;
  int sx = d->log2_chroma_w, sy = d->log2_chroma_h; // 1,1 = 420
  uint8_t *dy = out, *du = out + w * h, *dv = du + cw * ch;
  for (int y = 0; y < h; y++) {
    if (!deep) memcpy(dy + y * w, f->data[0] + y * f->linesize[0], w);
    else {
      const uint16_t *s = (const uint16_t *)(f->data[0] + y * f->linesize[0]);
      uint8_t *o = dy + y * w;
      for (int x = 0; x < w; x++) o[x] = (uint8_t)(s[x] >> shift);
    }
  }
  for (int p = 1; p <= 2; p++) {
    uint8_t *dst = p == 1 ? du : dv;
    for (int y = 0; y < ch; y++) {
      int sy_row = (y * 2) >> sy;
      const uint8_t *row = f->data[p] + sy_row * f->linesize[p];
      uint8_t *o = dst + y * cw;
      if (!deep) {
        if (sx == 1) memcpy(o, row, cw);
        else for (int x = 0; x < cw; x++) o[x] = row[x * 2];
      } else {
        const uint16_t *s = (const uint16_t *)row;
        int step = sx == 1 ? 1 : 2;
        for (int x = 0; x < cw; x++) o[x] = (uint8_t)(s[x * step] >> shift);
      }
    }
  }
  out_w = w; out_h = h;
  out_pts = f->best_effort_timestamp != AV_NOPTS_VALUE ? (double)f->best_effort_timestamp : (double)f->pts;
  return 0;
}

/** 1 = a picture is ready (rv_frame/rv_w/rv_h/rv_pts), 0 = need more input, -1 = finished. */
EMSCRIPTEN_KEEPALIVE int rv_receive(void) {
  if (!ctx) return -1;
  for (;;) {
    int r = avcodec_receive_frame(ctx, frm);
    if (r == AVERROR(EAGAIN)) return 0;
    if (r == AVERROR_EOF) return -1;
    if (r < 0) return 0;
    int ok = convert(frm);
    av_frame_unref(frm);
    if (ok == 0) return 1;
  }
}

EMSCRIPTEN_KEEPALIVE uint8_t *rv_frame(void) { return out; }
EMSCRIPTEN_KEEPALIVE int rv_w(void) { return out_w; }
EMSCRIPTEN_KEEPALIVE int rv_h(void) { return out_h; }
EMSCRIPTEN_KEEPALIVE double rv_pts(void) { return out_pts; }
/** After a seek: forget references; the next packet must be a keyframe. */
EMSCRIPTEN_KEEPALIVE void rv_flush(void) { if (ctx) avcodec_flush_buffers(ctx); }
EMSCRIPTEN_KEEPALIVE uint8_t *rv_alloc(int n) { return av_malloc(n + AV_INPUT_BUFFER_PADDING_SIZE); }
EMSCRIPTEN_KEEPALIVE void rv_free(uint8_t *p) { av_free(p); }
