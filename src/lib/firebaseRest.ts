import { auth, db } from "@/lib/firebase";

const getDatabaseUrl = () => String(db.app.options.databaseURL || "").replace(/\/+$/, "");

const encodePath = (path: string) =>
  String(path || "")
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");

const withAuthParam = async (params?: Record<string, string | number | boolean>) => {
  const next: Record<string, string | number | boolean> = { ...(params || {}) };
  try {
    const token = await auth.currentUser?.getIdToken(false);
    if (token) next.auth = token;
  } catch {}
  return next;
};

export const firebaseRestUrl = (path: string, params?: Record<string, string | number | boolean>) => {
  const base = getDatabaseUrl();
  if (!base) throw new Error("Firebase databaseURL is missing");
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => search.set(key, String(value)));
  const qs = search.toString();
  return `${base}/${encodePath(path)}.json${qs ? `?${qs}` : ""}`;
};

export const firebaseRestGet = async <T,>(path: string, params?: Record<string, string | number | boolean>): Promise<T | null> => {
  const requestParams = await withAuthParam(params);
  const cacheKey = `rs_rest_cache:${path}:${JSON.stringify(params || {})}`;
  if (typeof window !== "undefined") {
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as T;
    } catch {}
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(firebaseRestUrl(path, requestParams), {
      method: "GET",
      cache: "force-cache",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Firebase REST ${res.status}`);
    const data = (await res.json()) as T;
    if (typeof window !== "undefined" && !params?.shallow) {
      try {
        const text = JSON.stringify(data);
        if (text.length < 750_000) sessionStorage.setItem(cacheKey, text);
      } catch {}
    }
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
};

export const firebaseRestShallowKeys = async (path: string): Promise<string[]> => {
  const data = await firebaseRestGet<Record<string, true>>(path, { shallow: true });
  return data && typeof data === "object" ? Object.keys(data) : [];
};
