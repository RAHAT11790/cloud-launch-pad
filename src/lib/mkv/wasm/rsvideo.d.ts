export interface RsVideoModule {
  HEAPU8: Uint8Array;
  _rv_open(codec: number, extra: number, extraLen: number): number;
  _rv_close(): void;
  _rv_set_skip(level: number): void;
  _rv_send(data: number, len: number, pts: number): number;
  _rv_send_eof(): number;
  _rv_receive(): number;
  _rv_frame(): number;
  _rv_w(): number;
  _rv_h(): number;
  _rv_pts(): number;
  _rv_flush(): void;
  _rv_alloc(n: number): number;
  _rv_free(p: number): void;
}
export default function createRsVideo(options?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (path: string) => string }): Promise<RsVideoModule>;
