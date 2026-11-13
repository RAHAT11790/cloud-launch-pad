export interface RsAudioModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _rs_open(id: number, extra: number, extraLen: number, rate: number, channels: number, bits: number): number;
  _rs_close(): void;
  _rs_decode(data: number, len: number): number;
  _rs_out(): number;
  _rs_reset(): void;
  _rs_alloc(n: number): number;
  _rs_free(p: number): void;
}
export default function createRsAudio(options?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (path: string) => string }): Promise<RsAudioModule>;
