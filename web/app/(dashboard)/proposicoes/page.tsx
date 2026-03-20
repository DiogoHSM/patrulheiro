import { query } from "@/lib/db"
import { Badge, FonteBadge } from "@/components/badge"
import { FiltersMobile } from "@/components/filters-mobile"
import Link from "next/link"

const PER_PAGE = 30

interface SearchParams { alinhamento?: string; tipo?: string; fonte?: string; q?: string; page?: string; mes?: string }

async function getProposicoes(filters: SearchParams) {
  const page = Number(filters.page ?? 1)
  const offset = (page - 1) * PER_PAGE

  const conditions: string[] = ["1=1"]
  const params: unknown[] = []

  if (filters.alinhamento) { conditions.push(`alinhamento = $${params.length + 1}`); params.push(filters.alinhamento) }
  if (filters.tipo) { conditions.push(`tipo = $${params.length + 1}`); params.push(filters.tipo) }
  if (filters.fonte) { conditions.push(`fonte = $${params.length + 1}`); params.push(filters.fonte) }
  if (filters.mes) {
    conditions.push(`TO_CHAR(data_apresentacao, 'YYYY-MM') = $${params.length + 1}`)
    params.push(filters.mes)
  }
  if (filters.q) {
    conditions.push(`ementa ILIKE $${params.length + 1}`)
    params.push(`%${filters.q}%`)
  }

  const where = conditions.join(" AND ")

  const [{ total }] = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM proposicoes WHERE ${where}`, params
  )

  const rows = await query<{
    id: string; tipo: string; numero: number; ano: number
    ementa: string; alinhamento: string; fonte: string
    situacao: string; data_apresentacao: string; risco_politico: string
  }>(`
    SELECT id, tipo, numero, ano, LEFT(ementa, 120) AS ementa,
           alinhamento, fonte, situacao, data_apresentacao, risco_politico
    FROM proposicoes
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ${PER_PAGE} OFFSET ${offset}
  `, params)

  return { rows, total: Number(total), page, pages: Math.ceil(Number(total) / PER_PAGE) }
}

const MESES = [
  { value: "2026-02", label: "Fev 2026" },
  { value: "2026-03", label: "Mar 2026" },
]

export default async function ProposicoesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = await searchParams
  const { rows, total, page, pages } = await getProposicoes(filters)

  const filterBtn = (key: string, val: string, label: string) => {
    const active = (filters as Record<string, string>)[key] === val
    const params = new URLSearchParams(filters as Record<string, string>)
    if (active) { params.delete(key) } else { params.set(key, val) }
    params.delete("page")
    return (
      <Link key={val} href={`/proposicoes?${params}`}
        className="px-3 py-1 rounded-full text-xs font-medium transition-all"
        style={{ background: active ? "var(--primary)" : "var(--border)", color: active ? "#fff" : "var(--text-muted)" }}>
        {label}
      </Link>
    )
  }

  const hasFilters = filters.q || filters.alinhamento || filters.tipo || filters.fonte || filters.mes

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Proposições</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{total.toLocaleString("pt-BR")} proposições encontradas</p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <form method="get" className="flex gap-2">
          <input name="q" defaultValue={filters.q} placeholder="Buscar na ementa..."
            className="flex-1 px-4 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--surface-deep)", border: "1px solid var(--border)", color: "var(--text)" }} />
          {filters.mes && <input type="hidden" name="mes" value={filters.mes} />}
          {filters.alinhamento && <input type="hidden" name="alinhamento" value={filters.alinhamento} />}
          {filters.tipo && <input type="hidden" name="tipo" value={filters.tipo} />}
          {filters.fonte && <input type="hidden" name="fonte" value={filters.fonte} />}
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer"
            style={{ background: "var(--primary)" }}>Buscar</button>
          {hasFilters && (
            <Link href="/proposicoes" className="px-4 py-2 rounded-lg text-sm transition-colors"
              style={{ background: "var(--border)", color: "var(--text-muted)" }}>Limpar</Link>
          )}
        </form>

        {/* Desktop filters */}
        <div className="hidden md:flex flex-wrap gap-2 items-center">
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Mês:</span>
          {MESES.map(m => filterBtn("mes", m.value, m.label))}
        </div>

        <div className="hidden md:flex flex-wrap gap-2 items-center">
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Alinhamento:</span>
          {filterBtn("alinhamento", "favoravel", "✅ Favorável")}
          {filterBtn("alinhamento", "contrario", "❌ Contrário")}
          {filterBtn("alinhamento", "neutro", "➖ Neutro")}
          {filterBtn("alinhamento", "ambiguo", "⚠️ Ambíguo")}
          <span className="mx-1" style={{ color: "var(--border)" }}>|</span>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Fonte:</span>
          {filterBtn("fonte", "camara", "Câmara")}
          {filterBtn("fonte", "senado", "Senado")}
          <span className="mx-1" style={{ color: "var(--border)" }}>|</span>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Tipo:</span>
          {["PL", "PEC", "PLP", "MPV", "PDL"].map(t => filterBtn("tipo", t, t))}
        </div>

        {/* Mobile filters */}
        <FiltersMobile filters={filters} />
      </div>

      {/* Table — desktop */}
      <div className="hidden md:block rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Proposição</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Ementa</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Casa</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Data</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Alinhamento</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Risco</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link href={`/proposicoes/${p.id}`}>
                    <span className="font-mono font-semibold text-xs" style={{ color: "var(--yellow)" }}>
                      {p.tipo} {p.numero}/{p.ano}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/proposicoes/${p.id}`} className="transition-colors line-clamp-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {p.ementa}
                  </Link>
                </td>
                <td className="px-4 py-3"><FonteBadge value={p.fonte} /></td>
                <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "var(--text-dim)" }}>
                  {p.data_apresentacao ? new Date(p.data_apresentacao).toLocaleDateString("pt-BR") : "—"}
                </td>
                <td className="px-4 py-3"><Badge value={p.alinhamento} /></td>
                <td className="px-4 py-3"><Badge value={p.risco_politico} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-dim)" }}>
                  Nenhuma proposição encontrada
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile */}
      <div className="md:hidden space-y-3">
        {rows.length === 0 && (
          <p className="text-center py-12 text-sm" style={{ color: "var(--text-dim)" }}>Nenhuma proposição encontrada</p>
        )}
        {rows.map((p) => (
          <Link key={p.id} href={`/proposicoes/${p.id}`}
            className="block rounded-xl p-4 space-y-2"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold text-xs" style={{ color: "var(--yellow)" }}>{p.tipo} {p.numero}/{p.ano}</span>
              <div className="flex gap-2 items-center">
                <Badge value={p.alinhamento} />
                <Badge value={p.risco_politico} />
              </div>
            </div>
            <p className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>{p.ementa}</p>
            <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-dim)" }}>
              <FonteBadge value={p.fonte} />
              <span>{p.data_apresentacao ? new Date(p.data_apresentacao).toLocaleDateString("pt-BR") : "—"}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link href={`/proposicoes?${new URLSearchParams({ ...(filters as Record<string, string>), page: String(page - 1) })}`}
              className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>← Anterior</Link>
          )}
          <span className="px-4 py-2 text-sm" style={{ color: "var(--text-muted)" }}>Página {page} de {pages}</span>
          {page < pages && (
            <Link href={`/proposicoes?${new URLSearchParams({ ...(filters as Record<string, string>), page: String(page + 1) })}`}
              className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>Próxima →</Link>
          )}
        </div>
      )}
    </div>
  )
}
