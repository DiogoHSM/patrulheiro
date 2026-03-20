const CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  favoravel:  { label: "Favorável",  bg: "rgba(34,197,94,0.18)",   color: "#15803d" },
  contrario:  { label: "Contrário",  bg: "rgba(239,68,68,0.18)",   color: "#dc2626" },
  neutro:     { label: "Neutro",     bg: "rgba(148,163,184,0.18)", color: "#64748b" },
  ambiguo:    { label: "Ambíguo",    bg: "rgba(251,191,36,0.18)",  color: "#b45309" },
  alto:       { label: "Alto",       bg: "rgba(239,68,68,0.18)",   color: "#dc2626" },
  medio:      { label: "Médio",      bg: "rgba(251,191,36,0.18)",  color: "#b45309" },
  baixo:      { label: "Baixo",      bg: "rgba(34,197,94,0.18)",   color: "#15803d" },
  alta:       { label: "Alta",       bg: "rgba(239,68,68,0.18)",   color: "#dc2626" },
  media:      { label: "Média",      bg: "rgba(251,191,36,0.18)",  color: "#b45309" },
  critica:    { label: "Crítica",    bg: "rgba(168,85,247,0.18)",  color: "#7c3aed" },
}

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-xs" style={{ color: "var(--text-dim)" }}>—</span>
  const c = CONFIG[value] ?? { label: value, bg: "rgba(148,163,184,0.18)", color: "#64748b" }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold"
      style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  )
}

const FONTE_CONFIG: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  camara:  { label: "Câmara",  icon: "🏛", bg: "rgba(0,79,159,0.12)", color: "#004f9f" },
  senado:  { label: "Senado",  icon: "⚖️", bg: "rgba(21,128,61,0.12)", color: "#15803d" },
}

export function FonteBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null
  const c = FONTE_CONFIG[value] ?? { label: value, icon: "📄", bg: "rgba(148,163,184,0.18)", color: "#64748b" }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
      style={{ background: c.bg, color: c.color }}>
      <span>{c.icon}</span>{c.label}
    </span>
  )
}
