import { useEffect, useMemo, useState } from "react";
import { db, ref, onValue } from "@/lib/firebase";
import { useAnimeSaltData } from "@/hooks/useAnimeSaltData";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";

interface Props { glassCard: string; btnPrimary: string; btnSecondary: string; }

type Row = { id: string; title: string; year?: string | number; source: "RS" | "AN" };

const norm = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const trigger = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const AnimeNameExporter = ({ glassCard, btnPrimary, btnSecondary }: Props) => {
  const [rsItems, setRsItems] = useState<Row[]>([]);
  const { items: saltItems, loading: saltLoading } = useAnimeSaltData();

  useEffect(() => {
    const merged = new Map<string, Row>();
    const apply = () => setRsItems(Array.from(merged.values()));
    const u1 = onValue(ref(db, "webseries"), (snap) => {
      const v = snap.val() || {};
      for (const id of Object.keys(v)) merged.set(`ws:${id}`, { id, title: v[id]?.title || id, year: v[id]?.year, source: "RS" });
      apply();
    });
    const u2 = onValue(ref(db, "movies"), (snap) => {
      const v = snap.val() || {};
      for (const id of Object.keys(v)) merged.set(`mv:${id}`, { id, title: v[id]?.title || id, year: v[id]?.year, source: "RS" });
      apply();
    });
    return () => { u1(); u2(); };
  }, []);

  const anRows: Row[] = useMemo(
    () => saltItems.map((it) => ({ id: it.id, title: it.title, year: it.year, source: "AN" as const })),
    [saltItems]
  );

  const { rsOnly, anOnly, inBoth } = useMemo(() => {
    const rsKeys = new Set(rsItems.map((r) => norm(r.title)));
    const anKeys = new Set(anRows.map((r) => norm(r.title)));
    return {
      rsOnly: rsItems.filter((r) => !anKeys.has(norm(r.title))),
      anOnly: anRows.filter((r) => !rsKeys.has(norm(r.title))),
      inBoth: rsItems.filter((r) => anKeys.has(norm(r.title))),
    };
  }, [rsItems, anRows]);

  const download = (key: string, rows: Row[], fmt: "json" | "txt") => {
    if (!rows.length) { toast.error("Nothing to export."); return; }
    const stamp = today();
    if (fmt === "json") {
      trigger(`${key}-${stamp}.json`, JSON.stringify(rows, null, 2), "application/json");
    } else {
      const lines = rows.map((r) => `${r.title}${r.year ? ` (${r.year})` : ""}`).join("\n");
      trigger(`${key}-${stamp}.txt`, lines, "text/plain");
    }
    toast.success(`Exported ${rows.length} names → ${key}-${stamp}.${fmt}`);
  };

  const Group = ({ label, count, rows, slug, accent }: { label: string; count: number; rows: Row[]; slug: string; accent: string }) => (
    <div className="bg-white/[0.04] border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${accent}`} />
          <span className="text-[12px] font-semibold text-white">{label}</span>
        </div>
        <span className="text-[10px] text-white/55 font-mono">{count.toLocaleString()}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => download(slug, rows, "json")} className={`${btnSecondary} !py-1.5 !text-[11px] flex items-center justify-center gap-1`}>
          <Download size={11} /> JSON
        </button>
        <button onClick={() => download(slug, rows, "txt")} className={`${btnSecondary} !py-1.5 !text-[11px] flex items-center justify-center gap-1`}>
          <FileText size={11} /> TXT
        </button>
      </div>
    </div>
  );

  return (
    <div className={`${glassCard} p-4 mb-4`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-flex w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500/30 to-emerald-500/30 border border-white/10 items-center justify-center text-[13px]">📦</span>
        <h3 className="text-sm font-semibold text-white">Export Anime Names</h3>
      </div>
      <p className="text-[11px] text-white/55 mb-3 leading-relaxed">
        Download anime title lists from your RS catalog and AnimeSalt (AN) source. Compare which titles exist in one but not the other.
        {saltLoading && <span className="text-amber-300"> · Loading AN catalog…</span>}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <Group label="RS only (not in AN)"   count={rsOnly.length}  rows={rsOnly}  slug="rs-only"  accent="bg-emerald-400" />
        <Group label="AN only (not in RS)"   count={anOnly.length}  rows={anOnly}  slug="an-only"  accent="bg-sky-400" />
        <Group label="In both (RS ∩ AN)"     count={inBoth.length}  rows={inBoth}  slug="rs-and-an" accent="bg-amber-400" />
        <Group label="All RS"                count={rsItems.length} rows={rsItems} slug="all-rs"   accent="bg-fuchsia-400" />
        <Group label="All AN"                count={anRows.length}  rows={anRows}  slug="all-an"   accent="bg-cyan-400" />
      </div>
    </div>
  );
};

export default AnimeNameExporter;
