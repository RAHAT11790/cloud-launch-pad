type SearchableEpisode = { number: number; label?: string; title?: string; combo?: boolean };
const normalize = (text: string) => text.replace(/[০-৯]/g, digit => String("০১২৩৪৫৬৭৮৯".indexOf(digit))).toLowerCase().trim();
export function matchesEpisode(episode: SearchableEpisode, search: string) {
  const term = normalize(search).replace(/^(?:episode|ep)\s*/i, "");
  if (!term) return true;
  if (/^\d+$/.test(term)) {
    const number = Number(term);
    if (number === episode.number) return true;
    const range = normalize(episode.label || "").match(/(\d+)\s*[-–—]\s*(\d+)/);
    return !!range && number >= Number(range[1]) && number <= Number(range[2]);
  }
  return normalize(`${episode.label || ""} ${episode.title || ""}`).includes(term);
}