/** Most decoder threads the multi-core build uses (link flag PTHREAD_POOL_SIZE is one more). */
export const MT_MAX_THREADS = 8;

/**
 * Decoder threads for a phone with `cores` cores. HEVC frame threads mostly
 * wait on each other's reference pictures, so one per core (up to 8) is the
 * fastest — measured 3.3x a single thread with 8, only 2x with 4.
 */
export const decoderThreads = (cores: number) => Math.max(1, Math.min(MT_MAX_THREADS, Math.floor(cores) || 1));
