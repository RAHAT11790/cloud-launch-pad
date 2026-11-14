export type { RsVideoModule } from "./rsvideo";
import type { RsVideoModule } from "./rsvideo";
export default function createRsVideoMt(options?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (path: string) => string }): Promise<RsVideoModule>;
