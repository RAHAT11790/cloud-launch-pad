// TV remote / keyboard mapping for the video player.
// One place decides what a key does, so Android TV, Tizen, webOS and a PC
// keyboard all behave the same way.

export type RemoteAction =
  | "playPause"
  | "play"
  | "pause"
  | "seekBack"
  | "seekFwd"
  | "volUp"
  | "volDown"
  | "mute"
  | "chUp"
  | "chDown"
  | "back"
  | "fullscreen"
  | "digit";

export interface RemoteKeyInput {
  key: string;
  keyCode?: number;
}

export interface RemoteKeyContext {
  /** Focus sits on a visible button/link/list item that should get the key itself. */
  onControl: boolean;
  /** The player has a channel list (Live TV) — Up/Down zap channels like a TV. */
  hasChannels: boolean;
  /** TV focus navigation is active and the controls are visible: Up/Down move focus instead. */
  arrowsNavigate: boolean;
}

// Vendor key codes seen on TV browsers (Tizen / webOS / HbbTV) that do not
// report a standard `key` value.
const KEYCODE_ACTIONS: Record<number, RemoteAction> = {
  10252: "playPause",
  179: "playPause",
  415: "play",
  19: "pause",
  417: "seekFwd",
  412: "seekBack",
  427: "chUp",
  428: "chDown",
  33: "chUp",
  34: "chDown",
  447: "volUp",
  448: "volDown",
  449: "mute",
  461: "back",
  10009: "back",
};

const ALWAYS_KEYS: Record<string, RemoteAction> = {
  MediaPlayPause: "playPause",
  MediaPlay: "play",
  MediaPause: "pause",
  MediaFastForward: "seekFwd",
  MediaRewind: "seekBack",
  ChannelUp: "chUp",
  ChannelDown: "chDown",
  PageUp: "chUp",
  PageDown: "chDown",
  MediaTrackNext: "chDown",
  MediaTrackPrevious: "chUp",
  AudioVolumeUp: "volUp",
  AudioVolumeDown: "volDown",
  AudioVolumeMute: "mute",
  GoBack: "back",
  BrowserBack: "back",
  Escape: "back",
};

export function remoteActionFor(input: RemoteKeyInput, ctx: RemoteKeyContext): RemoteAction | null {
  const { key } = input;
  if (key && ALWAYS_KEYS[key]) return ALWAYS_KEYS[key];
  if (!key || key === "Unidentified") {
    const byCode = input.keyCode ? KEYCODE_ACTIONS[input.keyCode] : undefined;
    if (byCode) return byCode;
  }
  if (input.keyCode === 10009 || input.keyCode === 461) return "back";

  // Everything below belongs to the focused control when one is focused.
  if (ctx.onControl) return null;

  switch (key) {
    case "Enter":
    case " ":
    case "k":
    case "K":
      return "playPause";
    case "ArrowLeft":
    case "j":
    case "J":
      return "seekBack";
    case "ArrowRight":
    case "l":
    case "L":
      return "seekFwd";
    case "ArrowUp":
      if (ctx.arrowsNavigate) return null;
      return ctx.hasChannels ? "chUp" : "volUp";
    case "ArrowDown":
      if (ctx.arrowsNavigate) return null;
      return ctx.hasChannels ? "chDown" : "volDown";
    case "+":
    case "=":
      return "volUp";
    case "-":
    case "_":
      return "volDown";
    case "m":
    case "M":
      return "mute";
    case "f":
    case "F":
      return "fullscreen";
    case "Backspace":
      return "back";
    default:
      if (ctx.hasChannels && /^[0-9]$/.test(key)) return "digit";
      return null;
  }
}

/** Next list position for a channel/episode step. Channels wrap like a TV; episodes stop at the ends. */
export function stepIndex(length: number, current: number, dir: 1 | -1, wrap: boolean): number | null {
  if (length <= 0) return null;
  if (current < 0) return dir > 0 ? 0 : length - 1;
  const next = current + dir;
  if (next >= 0 && next < length) return next;
  if (!wrap || length < 2) return null;
  return (next + length) % length;
}

/** Channel number typed on the remote → list position, or null when out of range. */
export function channelIndexFromDigits(digits: string, length: number): number | null {
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1 || n > length) return null;
  return n - 1;
}

export const REMOTE_VOLUME_STEP = 10;
export const WHEEL_VOLUME_STEP = 5;

export function stepVolume(current: number, dir: 1 | -1, step = REMOTE_VOLUME_STEP): number {
  return Math.max(0, Math.min(100, Math.round(current + dir * step)));
}
