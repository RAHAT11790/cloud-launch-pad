// Lightweight fuzzy matcher tuned for admin search bars.
// Returns a score 0..1; >=0.5 = match (per project rule).
// Strategy:
//  - Normalize (lowercase, strip non-alphanumerics, collapse spaces).
//  - If query is substring of target → 1.0.
//  - Otherwise: token coverage (how many query tokens appear, partial OK)
//    + ordered-char subsequence ratio. Average of both.

const normalize = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const subseqRatio = (q: string, t: string): number => {
  if (!q) return 1;
  if (!t) return 0;
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (q[i] === t[j]) i++;
  }
  return i / q.length;
};

export const fuzzyScore = (query: string, target: string): number => {
  const q = normalize(query);
  const t = normalize(target);
  if (!q) return 1;
  if (!t) return 0;
  if (t.includes(q)) return 1;
  // token coverage
  const qTokens = q.split(" ").filter(Boolean);
  let tokenHits = 0;
  for (const qt of qTokens) {
    if (qt.length <= 2 ? t.includes(qt) : (t.includes(qt) || subseqRatio(qt, t) >= 0.85)) {
      tokenHits++;
    }
  }
  const tokenScore = qTokens.length ? tokenHits / qTokens.length : 0;
  const charScore = subseqRatio(q.replace(/\s+/g, ""), t.replace(/\s+/g, ""));
  return Math.max(tokenScore * 0.6 + charScore * 0.4, charScore * 0.85);
};

export const fuzzyMatch = (query: string, target: string, threshold = 0.5): boolean => {
  if (!query.trim()) return true;
  return fuzzyScore(query, target) >= threshold;
};
