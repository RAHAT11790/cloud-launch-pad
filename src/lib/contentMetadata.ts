import { TMDB_IMG_BASE } from "@/lib/siteConfig";

export const GENERIC_CATEGORIES = new Set(["", "anime", "animesalt", "uncategorized", "unknown", "n/a", "na"]);

const clean = (value: unknown) => String(value ?? "").trim();

const values = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  if (value === undefined || value === null || value === "") return [];
  return [value];
};

export const firstText = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    const value = clean(candidate);
    if (value) return value;
  }
  return "";
};

export const normalizeStringList = (value: unknown): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (entry: unknown) => {
    if (entry === undefined || entry === null) return;
    if (Array.isArray(entry)) return entry.forEach(push);
    if (typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const named = firstText(obj.name, obj.title, obj.label, obj.value);
      if (named) return push(named);
      return values(obj).forEach(push);
    }
    clean(entry)
      .split(/[,/|•·]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const key = part.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(part);
        }
      });
  };
  push(value);
  return out;
};

export const normalizeGenresFrom = (row: any): string[] =>
  normalizeStringList(row?.genres ?? row?.genre ?? row?.genreNames ?? row?.tmdbGenres);

export const normalizeRatingFrom = (row: any): string => {
  const raw = row?.rating ?? row?.imdbRating ?? row?.imdb_rating ?? row?.voteAverage ?? row?.vote_average ?? row?.tmdbRating ?? row?.vote;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw ? raw.toFixed(1) : "";
  return clean(raw);
};

export const normalizeYearFrom = (row: any): string => {
  const raw = firstText(row?.year, row?.releaseYear, row?.release_year, row?.released, row?.releaseDate, row?.release_date, row?.firstAirDate, row?.first_air_date, row?.airDate);
  return raw.match(/(?:19|20)\d{2}/)?.[0] || raw;
};

export const normalizeOverviewFrom = (row: any): string =>
  firstText(
    row?.overview,
    row?.storyline,
    row?.description,
    row?.plot,
    row?.synopsis,
    row?.summary,
    row?.tmdbOverview,
    row?.tmdb?.overview,
    row?.details?.overview,
    row?.details?.description,
  );

const resolveTmdbPhoto = (photo: string) => {
  if (!photo) return "";
  if (photo.startsWith("/")) return `${TMDB_IMG_BASE}w185${photo}`;
  return photo;
};

export type NormalizedCastPerson = { name: string; character?: string; photo?: string };

export const normalizeCastFrom = (row: any, limit = 12): NormalizedCastPerson[] => {
  const raw = row?.cast ?? row?.voiceArtists ?? row?.voiceArtist ?? row?.voice_artists ?? row?.voice_actors ?? row?.voiceActors ?? row?.actors ?? row?.stars ?? row?.credits?.cast ?? row?.tmdb?.credits?.cast;
  const seen = new Set<string>();
  const out: NormalizedCastPerson[] = [];
  values(raw).forEach((entry) => {
    if (out.length >= limit) return;
    if (typeof entry === "string") {
      normalizeStringList(entry).forEach((name) => {
        const key = name.toLowerCase();
        if (out.length < limit && !seen.has(key)) {
          seen.add(key);
          out.push({ name });
        }
      });
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const obj = entry as Record<string, unknown>;
    const name = firstText(obj.name, obj.original_name, obj.title, obj.actor, obj.artist, obj.voice, obj.voiceActor, obj.voice_actor);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const character = firstText(obj.character, obj.role, obj.as, obj.voiceRole, obj.voice_role, obj.characters);
    const photo = resolveTmdbPhoto(firstText(obj.photo, obj.profile, obj.profileUrl, obj.profile_url, obj.image, obj.avatar, obj.profile_path, obj.poster, obj.picture));
    out.push({ name, ...(character ? { character } : {}), ...(photo ? { photo } : {}) });
  });
  return out;
};

export const normalizeDirectorsFrom = (row: any): string[] => {
  const explicit = normalizeStringList(row?.directors ?? row?.director);
  if (explicit.length) return explicit.slice(0, 4);
  const crew = values(row?.credits?.crew)
    .filter((person: any) => /director/i.test(clean(person?.job)))
    .map((person: any) => firstText(person?.name, person?.original_name))
    .filter(Boolean);
  return normalizeStringList(crew).slice(0, 4);
};

export const normalizeCategoryFrom = (row: any, genres: string[] = [], fallback = "Anime"): string => {
  const rawList = normalizeStringList(row?.category ?? row?.primaryCategory ?? row?.categories);
  const raw = rawList.join(", ").trim();
  if (raw && !GENERIC_CATEGORIES.has(raw.toLowerCase())) return raw;
  return genres.length ? genres.join(", ") : (raw || fallback);
};

export const splitMetadataLabels = (value?: unknown): string[] => normalizeStringList(value);

export const contentCategoryLabels = (item: any): string[] => {
  const labels = [...splitMetadataLabels(item?.category), ...normalizeGenresFrom(item)];
  const seen = new Set<string>();
  const real = labels.filter((label) => !GENERIC_CATEGORIES.has(label.toLowerCase()));
  const source = real.length ? real : labels;
  return source.filter((label) => {
    const key = label.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const loose = (value: string) => value.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

export const metadataLabelMatches = (label: string, activeCategory: string): boolean => {
  const token = label.trim().toLowerCase();
  const active = activeCategory.trim().toLowerCase();
  if (!token || !active) return false;
  if (token === active || token.includes(active) || active.includes(token)) return true;
  const tokenLoose = loose(token);
  const activeLoose = loose(active);
  return !!tokenLoose && !!activeLoose && (tokenLoose === activeLoose || tokenLoose.includes(activeLoose) || activeLoose.includes(tokenLoose));
};