"use client"
import { useRouter } from "next/navigation"

interface Props {
  sort: string
  order: string
  partido?: string
}

export function SortControls({ sort, order, partido }: Props) {
  const router = useRouter()

  function buildUrl(overrides: Record<string, string>) {
    const params = new URLSearchParams()
    const current: Record<string, string> = { sort, order }
    if (partido) current.partido = partido
    Object.entries({ ...current, ...overrides }).forEach(([k, v]) => v && params.set(k, v))
    return `?${params}`
  }

  const selectStyle = {
    background: "var(--surface-deep)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  }

  return (
    <div className="flex items-center gap-2">
      <select value={sort} onChange={e => router.push(buildUrl({ sort: e.target.value }))}
        className="px-2 py-1 rounded-lg text-xs cursor-pointer" style={selectStyle}>
        <option value="alinhamento">Alinhamento</option>
        <option value="nome">Nome</option>
        <option value="total">Qtd. Proposições</option>
      </select>
      <button onClick={() => router.push(buildUrl({ order: order === "desc" ? "asc" : "desc" }))}
        className="px-2 py-1 rounded-lg text-xs cursor-pointer" style={selectStyle}>
        {order === "desc" ? "↓ Desc" : "↑ Asc"}
      </button>
    </div>
  )
}
