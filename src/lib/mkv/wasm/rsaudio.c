// Tiny audio decoder for the RS player: one compressed frame in, stereo
// float PCM at 48 kHz out. Built with emscripten against a minimal FFmpeg.
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
#include <libavutil/channel_layout.h>
#include <libswresample/swresample.h>
#include <emscripten/emscripten.h>
#include <string.h>
#include <stdlib.h>

static AVCodecContext *ctx = NULL;
static SwrContext *swr = NULL;
static AVPacket *pkt = NULL;
static AVFrame *frm = NULL;
static float *out = NULL;
static int out_cap = 0;   // stereo frames
static int out_len = 0;   // stereo frames
static int src_rate = 0, src_fmt = -1, src_ch = 0;
static uint64_t src_mask = 0;

static enum AVCodecID codec_for(int id) {
  switch (id) {
    case 1: return AV_CODEC_ID_AC3;
    case 2: return AV_CODEC_ID_EAC3;
    case 3: return AV_CODEC_ID_DTS;
    case 4: return AV_CODEC_ID_TRUEHD;
    case 5: return AV_CODEC_ID_MLP;
    case 6: return AV_CODEC_ID_FLAC;
    case 7: return AV_CODEC_ID_VORBIS;
    case 8: return AV_CODEC_ID_MP2;
    case 9: return AV_CODEC_ID_MP3;
    case 10: return AV_CODEC_ID_ALAC;
    case 11: return AV_CODEC_ID_PCM_S16LE;
    case 12: return AV_CODEC_ID_PCM_S24LE;
    case 13: return AV_CODEC_ID_PCM_S32LE;
    case 14: return AV_CODEC_ID_PCM_F32LE;
    case 15: return AV_CODEC_ID_PCM_S16BE;
    case 16: return AV_CODEC_ID_PCM_S24BE;
    default: return AV_CODEC_ID_NONE;
  }
}

static void drop_swr(void) { if (swr) swr_free(&swr); swr = NULL; src_rate = 0; src_fmt = -1; src_ch = 0; src_mask = 0; }

EMSCRIPTEN_KEEPALIVE void rs_close(void) {
  drop_swr();
  if (ctx) avcodec_free_context(&ctx);
  if (pkt) av_packet_free(&pkt);
  if (frm) av_frame_free(&frm);
  ctx = NULL; pkt = NULL; frm = NULL; out_len = 0;
}

/** Returns 0 on success. extradata may be NULL. */
EMSCRIPTEN_KEEPALIVE int rs_open(int id, const uint8_t *extra, int extra_len, int rate, int channels, int bits) {
  rs_close();
  const AVCodec *codec = avcodec_find_decoder(codec_for(id));
  if (!codec) return -1;
  ctx = avcodec_alloc_context3(codec);
  if (!ctx) return -2;
  if (extra && extra_len > 0) {
    ctx->extradata = av_mallocz(extra_len + AV_INPUT_BUFFER_PADDING_SIZE);
    memcpy(ctx->extradata, extra, extra_len);
    ctx->extradata_size = extra_len;
  }
  if (rate > 0) ctx->sample_rate = rate;
  if (channels > 0) av_channel_layout_default(&ctx->ch_layout, channels);
  if (bits > 0) ctx->bits_per_coded_sample = bits;
  if (avcodec_open2(ctx, codec, NULL) < 0) { rs_close(); return -3; }
  pkt = av_packet_alloc();
  frm = av_frame_alloc();
  return 0;
}

static int ensure_swr(AVFrame *f) {
  uint64_t mask = f->ch_layout.order == AV_CHANNEL_ORDER_NATIVE ? f->ch_layout.u.mask : 0;
  if (swr && f->sample_rate == src_rate && f->format == src_fmt && f->ch_layout.nb_channels == src_ch && mask == src_mask) return 0;
  drop_swr();
  AVChannelLayout in = {0};
  if (f->ch_layout.order == AV_CHANNEL_ORDER_UNSPEC || f->ch_layout.nb_channels <= 0) av_channel_layout_default(&in, f->ch_layout.nb_channels > 0 ? f->ch_layout.nb_channels : 2);
  else av_channel_layout_copy(&in, &f->ch_layout);
  AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
  if (swr_alloc_set_opts2(&swr, &stereo, AV_SAMPLE_FMT_FLT, 48000, &in, f->format, f->sample_rate, 0, NULL) < 0) { av_channel_layout_uninit(&in); return -1; }
  av_channel_layout_uninit(&in);
  if (swr_init(swr) < 0) { drop_swr(); return -1; }
  src_rate = f->sample_rate; src_fmt = f->format; src_ch = f->ch_layout.nb_channels; src_mask = mask;
  return 0;
}

static int append_frame(AVFrame *f) {
  if (ensure_swr(f) < 0) return -1;
  int need = (int)swr_get_out_samples(swr, f->nb_samples) + 64;
  if (out_len + need > out_cap) {
    int cap = (out_len + need) * 2;
    float *n = realloc(out, (size_t)cap * 2 * sizeof(float));
    if (!n) return -1;
    out = n; out_cap = cap;
  }
  uint8_t *dst = (uint8_t *)(out + out_len * 2);
  int got = swr_convert(swr, &dst, out_cap - out_len, (const uint8_t **)f->extended_data, f->nb_samples);
  if (got < 0) return -1;
  out_len += got;
  return got;
}

static int drain(void) {
  int total = 0;
  for (;;) {
    int r = avcodec_receive_frame(ctx, frm);
    if (r == AVERROR(EAGAIN) || r == AVERROR_EOF) break;
    if (r < 0) return total; // corrupt frame: skip it, keep going
    int got = append_frame(frm);
    av_frame_unref(frm);
    if (got > 0) total += got;
  }
  return total;
}

/** Decode one packet; returns stereo frames available (call rs_out to read). */
EMSCRIPTEN_KEEPALIVE int rs_decode(const uint8_t *data, int len) {
  out_len = 0;
  if (!ctx) return -1;
  pkt->data = (uint8_t *)data; pkt->size = len;
  int r = avcodec_send_packet(ctx, pkt);
  if (r == AVERROR(EAGAIN)) { drain(); r = avcodec_send_packet(ctx, pkt); }
  if (r < 0 && r != AVERROR_INVALIDDATA) return -2;
  drain();
  return out_len;
}

EMSCRIPTEN_KEEPALIVE float *rs_out(void) { return out; }
/** After a seek: forget decoder state and resampler history. */
EMSCRIPTEN_KEEPALIVE void rs_reset(void) { if (ctx) avcodec_flush_buffers(ctx); if (swr) { drop_swr(); } out_len = 0; }
EMSCRIPTEN_KEEPALIVE uint8_t *rs_alloc(int n) { return av_malloc(n + AV_INPUT_BUFFER_PADDING_SIZE); }
EMSCRIPTEN_KEEPALIVE void rs_free(uint8_t *p) { av_free(p); }
