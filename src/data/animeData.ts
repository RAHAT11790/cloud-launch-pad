import poster1 from "@/assets/poster-1.jpg";
import poster2 from "@/assets/poster-2.jpg";
import poster3 from "@/assets/poster-3.jpg";
import poster4 from "@/assets/poster-4.jpg";
import poster5 from "@/assets/poster-5.jpg";
import poster6 from "@/assets/poster-6.jpg";
import hero1 from "@/assets/hero-1.jpg";
import hero2 from "@/assets/hero-2.jpg";
import hero3 from "@/assets/hero-3.jpg";

export interface Episode {
  episodeNumber: number;
  title: string;
  link: string;
  link480?: string;
  link720?: string;
  link1080?: string;
  link4k?: string;
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
  seasons?: Season[];
  movieLink?: string;
  movieLink480?: string;
  movieLink720?: string;
  movieLink1080?: string;
  movieLink4k?: string;
  trailer?: string;
  createdAt?: number;
  updatedAt?: number;
  source?: "firebase" | "animesalt" | "moviebox";
  slug?: string;
  dubType?: "official" | "fandub";
}

export const categories = ["Action", "Romance", "Fantasy", "Sci-Fi", "Horror", "Comedy"];

export const heroSlides = [
  { id: "1", title: "Shadow Warriors", backdrop: hero1, subtitle: "The ultimate battle begins", rating: "9.2", year: "2024" },
  { id: "2", title: "Blade of the Moon", backdrop: hero2, subtitle: "A samurai's destiny", rating: "8.9", year: "2024" },
  { id: "3", title: "Mecha Genesis", backdrop: hero3, subtitle: "The cosmos awaits", rating: "9.0", year: "2025" },
];

const sampleEpisodes: Season[] = [
  {
    name: "Season 1",
    episodes: Array.from({ length: 12 }, (_, i) => ({
      episodeNumber: i + 1,
      title: `Episode ${i + 1}`,
      link: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    })),
  },
  {
    name: "Season 2",
    episodes: Array.from({ length: 10 }, (_, i) => ({
      episodeNumber: i + 1,
      title: `Episode ${i + 1}`,
      link: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    })),
  },
];

export const animeList: AnimeItem[] = [
  { id: "1", title: "Dark Phantom", poster: poster1, backdrop: hero1, year: "2024", rating: "9.1", language: "Japanese", category: "Action", type: "webseries", storyline: "In a world where shadows hold power, one warrior must rise against the darkness to save humanity from the Phantom King.", seasons: sampleEpisodes },
  { id: "2", title: "Magical Sakura", poster: poster2, backdrop: hero2, year: "2024", rating: "8.5", language: "Japanese", category: "Romance", type: "webseries", storyline: "A young magical girl discovers her true powers while navigating school life and unexpected romance.", seasons: sampleEpisodes },
  { id: "3", title: "Shadow Ninja", poster: poster3, backdrop: hero3, year: "2023", rating: "8.8", language: "Japanese", category: "Action", type: "movie", storyline: "The last ninja clan must protect an ancient artifact that could reshape the world.", movieLink: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
  { id: "4", title: "Super Warrior Z", poster: poster4, backdrop: hero1, year: "2025", rating: "9.3", language: "Japanese", category: "Action", type: "webseries", storyline: "An alien warrior trains on Earth to become the strongest fighter in the universe.", seasons: sampleEpisodes },
  { id: "5", title: "Demon Hunter", poster: poster5, backdrop: hero2, year: "2024", rating: "9.0", language: "Japanese", category: "Fantasy", type: "webseries", storyline: "After a devastating attack on their village, a young hunter embarks on a journey to become the greatest demon slayer.", seasons: sampleEpisodes },
  { id: "6", title: "Neon Dreams", poster: poster6, backdrop: hero3, year: "2025", rating: "8.7", language: "Japanese", category: "Sci-Fi", type: "movie", storyline: "In a cyberpunk future, a hacker discovers a conspiracy that threatens to destroy the last free city.", movieLink: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
  { id: "7", title: "Blade Saga", poster: poster1, backdrop: hero1, year: "2023", rating: "8.4", language: "Japanese", category: "Fantasy", type: "webseries", storyline: "A cursed swordsman searches for redemption across a war-torn land.", seasons: sampleEpisodes },
  { id: "8", title: "Star Crystal", poster: poster2, backdrop: hero2, year: "2024", rating: "8.6", language: "Japanese", category: "Romance", type: "movie", storyline: "Two magical beings from different worlds fall in love, defying the laws of their realms.", movieLink: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
  { id: "9", title: "Cyber Knight", poster: poster4, backdrop: hero3, year: "2025", rating: "9.2", language: "Japanese", category: "Sci-Fi", type: "webseries", storyline: "In a digital battlefield, cyber knights fight to protect the virtual realm from corruption.", seasons: sampleEpisodes },
  { id: "10", title: "Spirit Hunters", poster: poster5, backdrop: hero1, year: "2024", rating: "8.9", language: "Japanese", category: "Horror", type: "webseries", storyline: "A group of students with supernatural abilities investigate paranormal activities across Japan.", seasons: sampleEpisodes },
  { id: "11", title: "Laugh Academy", poster: poster6, backdrop: hero2, year: "2023", rating: "8.3", language: "Japanese", category: "Comedy", type: "webseries", storyline: "A hilarious school comedy where students compete in the most absurd competitions.", seasons: sampleEpisodes },
  { id: "12", title: "Galaxy Fighters", poster: poster3, backdrop: hero3, year: "2025", rating: "9.1", language: "Japanese", category: "Action", type: "movie", storyline: "Earth's mightiest fighters unite to battle an intergalactic threat.", movieLink: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
];
