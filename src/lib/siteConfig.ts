// ============================================
// RS ANIME - Centralized Site Configuration
// ============================================
// সব হার্ডকোডেড ভ্যালু এখানে env থেকে আসে।
// .env.example দেখে সব ভ্যালু সেট করুন।

// --- Branding ---
export const SITE_NAME = import.meta.env.VITE_SITE_NAME || "RS ANIME";
export const SITE_DESCRIPTION = import.meta.env.VITE_SITE_DESCRIPTION || "Your ultimate destination for watching anime series and movies.";
export const SITE_URL = import.meta.env.VITE_SITE_URL || "https://rs-anime.lovable.app";
export const SITE_ICON_URL = import.meta.env.VITE_SITE_ICON_URL || "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";

// --- Telegram ---
export const TELEGRAM_CHANNEL = import.meta.env.VITE_TELEGRAM_CHANNEL || "@CARTOONFUNNY03";
export const TELEGRAM_CHANNEL_URL = import.meta.env.VITE_TELEGRAM_CHANNEL_URL || "https://t.me/cartoonfunny03";
export const TELEGRAM_ADMIN_URL = import.meta.env.VITE_TELEGRAM_ADMIN_URL || "https://t.me/rs_woner";

// --- TMDB ---
export const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || "37f4b185e3dc487e4fd3e56e2fab2307";
export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const TMDB_IMG_BASE = "https://image.tmdb.org/t/p/";

// --- Cloudflare CDN ---
export const CLOUDFLARE_CDN_URL = import.meta.env.VITE_CLOUDFLARE_CDN_URL || "https://rs-anime-3.rahatsarker224.workers.dev";

// --- Supabase (auto-set, don't change) ---
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// --- Firebase (auto-set from env) ---
export const FIREBASE_VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "BDMR1Q2pzEWQZtt-E_g_T4GD0AN0_DkGfpDDs2_4a0Oy27INY1LPUGeR8n6NPmIDG3_dBL1OwHbN4a-Toku0Xs4";

// --- FCM ---
export const FCM_ENDPOINT = `${SUPABASE_URL}/functions/v1/send-fcm`;
