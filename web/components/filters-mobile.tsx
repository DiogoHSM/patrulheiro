"use client"
import { useRouter } from "next/navigation"

const TIPOS = ["PL", "PEC", "PLP", "MPV", "PDL"]
const MESES = [
  { value: "2026-02", label: "Fev 2026" },
  { value: "2026-03", label: "Mar 2026" },
]

interface Filters {
  alinhamento?: string; tipo?: string; fonte?: string; mes?: string; q?: string
}

export function FiltersMobile({ filters }: { filters: Filters }) {
  const router = useRouter()

  function navigate(key: string, value: string) {
    const params = new URLSearchParams(filters as Record<string, string>)
    if (value) { params.set(key, value) } else { params.delete(key) }
    params.delete("page")
    router.push(`/proposicoes?${params}`)
  }

  const selectStyle = {
    background: "var(--surface-deep)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  }

  return (
    <div className="md:hidden grid grid-cols-2 gap-2">
      <select value={filters.alinhamento ?? ""} onChange={e => navigate("alinhamento", e.target.value)}
        className="px-3 py-2 rounded-lg text-sm" style={selectStyle}>
        <option value="">Alinhamento</option>
        <option value="favoravel">✅ Favorável</option>
        <option value="contrario">❌ Contrário</option>
        <option value="neutro">➖ Neutro</option>
        <option value="ambiguo">⚠️ Ambíguo</option>
      </select>
      <select value={filters.fonte ?? ""} onChange={e => navigate("fonte", e.target.value)}
        className="px-3 py-2 rounded-lg text-sm" style={selectStyle}>
        <option value="">Fonte</option>
        <option value="camara">Câmara</option>
        <option value="senado">Senado</option>
      </select>
      <select value={filters.tipo ?? ""} onChange={e => navigate("tipo", e.target.value)}
        className="px-3 py-2 rounded-lg text-sm" style={selectStyle}>
        <option value="">Tipo</option>
        {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={filters.mes ?? ""} onChange={e => navigate("mes", e.target.value)}
        className="px-3 py-2 rounded-lg text-sm" style={selectStyle}>
        <option value="">Mês</option>
        {MESES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
    </div>
  )
}
