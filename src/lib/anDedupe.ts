import { db, ref, onValue } from "@/lib/firebase";

/**
 * AN ⇄ RS duplicate control.
 *
 * When `settings/anAutoDisableRsDuplicates` is ON, any AN (AnimeSalt) card whose
 * title matches an RS library title (series OR movie) is automatically hidden
 * from the user panel — no manual work, no double cards. Matching is done on a
 * normalized title key so "Naruto Shippuden (Season 2)" == "naruto shippuden".
 */

export const AN_DEDUPE_SETTING_PATH = "settings/anAutoDisableRsDuplicates";

const STOP_SUFFIX_RE =
  /\b(season|seasons|s|part|chapter|cour|saga|series|movie|film|the movie|hindi|dubbed|dual audio|uncut|complete|batch)\b/gi;

export const normalizeAnTitleKey = (raw: unknown): string => {
  let t = String(raw || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(season|part|chapter|cour|s)\s*\d+\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)\s+season\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  t = t.replace(STOP_SUFFIX_RE, " ");
  return t.replace(/\s+/g, " ").trim();
};

const collectKeys = (val: any, out: Set<string>) => {
  if (!val || typeof val !== "object") return;
  Object.values(val).forEach((row: any) => {
    const key = normalizeAnTitleKey(row?.title || row?.name);
    if (key) out.add(key);
  });
};

/** Live set of normalized RS titles (webseries + movies). */
export const subscribeRsTitleKeys = (cb: (keys: Set<string>) => void) => {
  let ws: any = null;
  let mv: any = null;
  const emit = () => {
    const out = new Set<string>();
    collectKeys(ws, out);
    collectKeys(mv, out);
    cb(out);
  };
  const u1 = onValue(ref(db, "adminContentIndex/webseries"), (s) => { ws = s.val(); emit(); });
  const u2 = onValue(ref(db, "adminContentIndex/movies"), (s) => { mv = s.val(); emit(); });
  return () => { try { u1(); } catch {} try { u2(); } catch {} };
};

/** Live value of the auto-disable toggle (default OFF). */
export const subscribeAnDedupeEnabled = (cb: (enabled: boolean) => void) =>
  onValue(ref(db, AN_DEDUPE_SETTING_PATH), (s) => cb(s.val() === true));
