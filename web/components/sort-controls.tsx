"use client"
import { useRouter, useSearchParams } from "next/navigation"

export function SortControls({ sort, order }: { sort: string; order: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(key, value)
    router.push(`?${params}`)
  }

  const selectStyle = {
    background: "var(--surface-deep)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  }

  return (
    <div className="flex items-center gap-2">
      <select value={sort} onChange={e => update("sort", e.target.value)}
        className="px-2 py-1 rounded-lg text-xs cursor-pointer" style={selectStyle}>
        <option value="alinhamento">Alinhamento</option>
        <option value="nome">Nome</option>
        <option value="total">Qtd. Proposições</option>
      </select>
      <button onClick={() => update("order", order === "desc" ? "asc" : "desc")}
        className="px-2 py-1 rounded-lg text-xs cursor-pointer" style={selectStyle}>
        {order === "desc" ? "↓ Desc" : "↑ Asc"}
      </button>
    </div>
  )
}
