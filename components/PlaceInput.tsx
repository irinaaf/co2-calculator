import { useState, useRef, useEffect, useCallback } from "react";

export interface PlaceSuggestion {
  label: string;
  layer: string;
  lat: number;
  lon: number;
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

const LAYER_ICON: Record<string, string> = {
  venue: "○",
  stop: "⊡",
  address: "○",
  locality: "○",
  county: "○",
};

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// Pin icon SVG
const PinIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.5C5.79 1.5 4 3.29 4 5.5c0 3.25 4 9 4 9s4-5.75 4-9c0-2.21-1.79-4-4-4z"/>
    <circle cx="8" cy="5.5" r="1.25"/>
  </svg>
);

export function PlaceInput({ label, value, onChange, placeholder = "Place or address…", required = false }: Props) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchSuggestions = useCallback(
    debounce(async (query: string) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      if (query.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
      setLoading(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error("geocode failed");
        const data: PlaceSuggestion[] = await res.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSuggestions([]);
      } finally { setLoading(false); }
    }, 280), []
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
    fetchSuggestions(e.target.value);
  }
  function handleSelect(s: PlaceSuggestion) {
    onChange(s.label);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="space-y-1.5 relative" ref={wrapRef}>
      <label className="label-xs">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex-shrink-0"
          style={{ color: "hsl(220,8%,60%)" }}>
          <PinIcon />
        </div>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          className="w-full text-sm rounded-xl pl-8 pr-3 py-2.5 outline-none transition-colors"
          style={{
            border: "1px solid hsl(220,8%,90%)",
            background: "hsl(220,8%,97%)",
            color: "hsl(220,14%,12%)",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "hsl(150,30%,45%)"; if (suggestions.length > 0) setOpen(true); }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = "hsl(220,8%,90%)"; }}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse"
            style={{ color: "hsl(220,8%,60%)" }}>···</span>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-xl overflow-hidden"
          style={{
            background: "#fff",
            border: "1px solid hsl(220,8%,88%)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}>
          {suggestions.map((s) => (
            <button key={`${s.lat},${s.lon}`} type="button" onMouseDown={() => handleSelect(s)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors"
              style={{ color: "hsl(220,14%,20%)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220,8%,97%)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span className="text-xs flex-shrink-0" style={{ color: "hsl(220,8%,60%)" }}>
                {LAYER_ICON[s.layer] ?? "○"}
              </span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
