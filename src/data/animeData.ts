import "@/assets/poster-1.jpg";
import "@/assets/poster-2.jpg";
import "@/assets/poster-3.jpg";
import "@/assets/poster-4.jpg";
import "@/assets/poster-5.jpg";
import "@/assets/poster-6.jpg";
import "@/assets/hero-1.jpg";
import "@/assets/hero-2.jpg";
import "@/assets/hero-3.jpg";

export interface AudioTrack {
  language: string;
  label: string;
  link: string;
  audioUrl?: string;
  rawAudioUrl?: string;
  qualityLinks?: Record<string, string>;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  isDefault?: boolean;
}

export interface SubtitleTrack {
  language?: string;
  label: string;
  url: string;
}

export interface MoviePart {
  partNumber: number;
  title?: string;
  link: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  /** Direct video URL (MP4/M3U8) or iframe embed — separate from Telegram links. */
  directLink?: string;
  /** Epoch ms — premium-only until this moment, then free for everyone. */
  lockUntil?: number;
}

export interface Episode {
  qualityLinks?: Record<string, string>;
  episodeNumber: number;
  /** Combo episode: last real episode inside this link (e.g. 2 → 4). */
  episodeEnd?: number;
  title: string;
  link: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
  /** Direct video URL (MP4/M3U8) or iframe embed — separate from Telegram links. */
  directLink?: string;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  /** Epoch ms — premium-only until this moment, then free for everyone. */
  lockUntil?: number;
}

export interface Season {
  name: string;
  episodes: Episode[];
}

export interface AnimeItem {
  id: string;
  title: string;
  poster: string;
  backdrop: string;
  year: string;
  rating: string;
  language: string;
  category: string;
  type: "webseries" | "movie";
  storyline: string;
  overview?: string;
  description?: string;
  seasons?: Season[];
  movieLink?: string;
  movieLink480?: string;
  movieLink720?: string;
  movieLink1080?: string;
  movieLink4k?: string;
  /** For movies split into multiple parts. When present, playback uses parts[] instead of movieLink*. */
  parts?: MoviePart[];
  trailer?: string;
  createdAt?: number;
  updatedAt?: number;
  source?: "firebase" | "animesalt" | "moviebox";
  sourceName?: string;
  anSlug?: string;
  animeSaltSlug?: string;
  displayAs?: "an" | "rs" | string;
  slug?: string;
  dubType?: "official" | "fandub";
  baseLanguage?: string;
  availableLanguages?: string[];
  seasonsByLanguage?: Record<string, Season[]>;
  episodeCount?: number;
  audioTracks?: AudioTrack[];
  tmdbId?: number | string;
  genres?: string[];
  directors?: string[];
  cast?: { name: string; character?: string; photo?: string }[];
  premium?: boolean;
  premiumEpisodes?: Record<string, boolean>;
  /**
   * Lightweight timed-lock index so cards and the play gate can enforce the
   * admin "Episode Lock" without loading the full item.
   * Keys: `s{seasonIdx}e{episodeIdx}` for series, `p{partIdx}` for movie parts,
   * `movie` for the main movie file. Values: epoch ms.
   */
  episodeLocks?: Record<string, number>;
  /** Epoch ms — whole title is premium-only until this moment. */
  lockUntil?: number;
  logo?: string;
}
