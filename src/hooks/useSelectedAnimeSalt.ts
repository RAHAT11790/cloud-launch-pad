import { useEffect, useState } from "react";
import type { AnimeItem } from "@/data/animeData";

export function useSelectedAnimeSalt() {
  const [items, setItems] = useState<AnimeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // AN entries are now converted into normal RS-style `webseries` cards from
    // Dashboard → Series → AN Series. Returning an empty list here prevents the
    // old API-only AN cards from duplicating those Firebase cards or loading
    // slowly on the user panel.
    setItems([]);
    setLoading(false);
  }, []);

  return { items, loading };
}