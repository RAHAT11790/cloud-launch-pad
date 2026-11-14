/** Pre-started threads in the multi-core build (link flag PTHREAD_POOL_SIZE); the decoder never asks for more. */
export const MT_MAX_THREADS = 4;

/** Decoder threads for a phone with `cores` cores: one core is left for sound, painting and the page. */
export const decoderThreads = (cores: number) => Math.max(1, Math.min(MT_MAX_THREADS, Math.floor(cores) - 1));
