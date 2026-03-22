import { query, queryOne } from "@/lib/db"
import { Badge } from "@/components/badge"
import Link from "next/link"

const PER_PAGE = 30

interface SearchParams { alinhamento?: string; impacto?: string; secao?: string; q?: string; page?: string; data?: string }

async function getLastEdicao(): Promise<string | null> {
  const row = await queryOne<{ edicao: string }>("SELECT MAX(edicao) AS edicao FROM dou_atos WHERE relevante = TRUE")
  return row?.edicao ?? null
}

async function getAtos(filters: SearchParams) {
  const page = Number(filters.page ?? 1)
  const offset = (page - 1) * PER_PAGE

  const conditions: string[] = ["relevante = TRUE"]
  const params: unknown[] = []

  if (filters.alinhamento) { conditions.push(`alinhamento = $${params.length + 1}`); params.push(filters.alinhamento) }
  if (filters.impacto) { conditions.push(`impacto_estimado = $${params.length + 1}`); params.push(filters.impacto) }
  if (filters.secao) { conditions.push(`secao = $${params.length + 1}`); params.push(filters.secao) }
  if (filters.data) { conditions.push(`edicao = $${params.length + 1}`); params.push(filters.data) }
  if (filters.q) {
    conditions.push(`(titulo ILIKE $${params.length + 1} OR orgao ILIKE $${params.length + 1})`)
    params.push(`%${filters.q}%`)
  }

  const where = conditions.join(" AND ")

  const [{ total }] = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM dou_atos WHERE ${where}`, params
  )

  const rows = await query<{
    id: string; edicao: string; secao: string; tipo_ato: string
    orgao: string; titulo: string; resumo_executivo: string
    alinhamento: string; impacto_estimado: string; processado: boolean
  }>(`
    SELECT id, edicao, secao, tipo_ato, orgao,
           LEFT(titulo, 100) AS titulo,
           LEFT(resumo_executivo, 120) AS resumo_executivo,
           alinhamento, impacto_estimado, processado
    FROM dou_atos
    WHERE ${where}
    ORDER BY edicao DESC, created_at DESC
    LIMIT ${PER_PAGE} OFFSET ${offset}
  `, params)

  return { rows, total: Number(total), page, pages: Math.ceil(Number(total) / PER_PAGE) }
}

export default async function DouPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = await searchParams
  const lastEdicao = await getLastEdicao()

  // Apply smart defaults when no explicit filter is set
  const effectiveFilters: SearchParams = {
    ...filters,
    secao: filters.secao ?? "1",
    data: filters.data ?? (lastEdicao ?? undefined),
  }

  const { rows, total, page, pages } = await getAtos(effectiveFilters)

  const filterBtn = (key: string, val: string, label: string) => {
    const active = (effectiveFilters as Record<string, string>)[key] === val
    const params = new URLSearchParams(effectiveFilters as Record<string, string>)
    if (active) { params.delete(key) } else { params.set(key, val) }
    params.delete("page")
    return (
      <Link key={val} href={`/dou?${params}`}
        className="px-3 py-1 rounded-full text-xs font-medium transition-all"
        style={{ background: active ? "var(--primary)" : "var(--border)", color: active ? "#fff" : "var(--text-muted)" }}>
        {label}
      </Link>
    )
  }

  const hasFilters = filters.q || filters.alinhamento || filters.impacto || filters.secao || filters.data

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Diário Oficial</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{total.toLocaleString("pt-BR")} atos encontrados</p>
      </div>

      {/* Filters */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <form method="get" className="flex gap-2">
          <input name="q" defaultValue={effectiveFilters.q} placeholder="Buscar por órgão ou título..."
            className="flex-1 px-4 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--surface-deep)", border: "1px solid var(--border)", color: "var(--text)" }} />
          {effectiveFilters.alinhamento && <input type="hidden" name="alinhamento" value={effectiveFilters.alinhamento} />}
          {effectiveFilters.impacto && <input type="hidden" name="impacto" value={effectiveFilters.impacto} />}
          {effectiveFilters.secao && <input type="hidden" name="secao" value={effectiveFilters.secao} />}
          {effectiveFilters.data && <input type="hidden" name="data" value={effectiveFilters.data} />}
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer"
            style={{ background: "var(--primary)" }}>Buscar</button>
          {hasFilters && (
            <Link href="/dou" className="px-4 py-2 rounded-lg text-sm transition-colors"
              style={{ background: "var(--border)", color: "var(--text-muted)" }}>Limpar</Link>
          )}
        </form>

        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Alinhamento:</span>
          {filterBtn("alinhamento", "contrario", "❌ Contrário")}
          {filterBtn("alinhamento", "ambiguo", "⚠️ Ambíguo")}
          {filterBtn("alinhamento", "favoravel", "✅ Favorável")}
          {filterBtn("alinhamento", "neutro", "➖ Neutro")}
          <span className="mx-1" style={{ color: "var(--border)" }}>|</span>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Impacto:</span>
          {filterBtn("impacto", "alto", "Alto")}
          {filterBtn("impacto", "medio", "Médio")}
          <span className="mx-1" style={{ color: "var(--border)" }}>|</span>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Seção:</span>
          {filterBtn("secao", "1", "Seção 1")}
          {filterBtn("secao", "2", "Seção 2")}
          {filterBtn("secao", "3", "Seção 3")}
        </div>
      </div>

      {/* Table — desktop */}
      <div className="hidden md:block rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Data</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Seção</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Tipo / Órgão</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Resumo</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Alinhamento</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Impacto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="transition-colors" style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "var(--text-dim)" }}>{a.edicao}</td>
                <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: "var(--text-muted)" }}>
                  <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--border)" }}>S{a.secao}</span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/dou/${a.id}`}>
                    <p className="text-xs font-semibold" style={{ color: "var(--yellow)" }}>{a.tipo_ato || "—"}</p>
                    <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--text-muted)" }}>{a.orgao}</p>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/dou/${a.id}`} className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>
                    {a.resumo_executivo || a.titulo || "—"}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {a.processado ? <Badge value={a.alinhamento} /> : <span className="text-xs" style={{ color: "var(--text-dim)" }}>⏳</span>}
                </td>
                <td className="px-4 py-3">
                  {a.processado ? <Badge value={a.impacto_estimado} /> : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: "var(--text-dim)" }}>
                  Nenhum ato encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile */}
      <div className="md:hidden space-y-3">
        {rows.length === 0 && (
          <p className="text-center py-12 text-sm" style={{ color: "var(--text-dim)" }}>Nenhum ato encontrado</p>
        )}
        {rows.map((a) => (
          <Link key={a.id} href={`/dou/${a.id}`}
            className="block rounded-xl p-4 space-y-2"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-dim)" }}>S{a.secao}</span>
                <span className="text-xs" style={{ color: "var(--text-dim)" }}>{a.edicao}</span>
              </div>
              {a.processado && <Badge value={a.alinhamento} />}
            </div>
            <p className="text-xs font-semibold" style={{ color: "var(--yellow)" }}>{a.tipo_ato} — {a.orgao}</p>
            <p className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>{a.resumo_executivo || a.titulo}</p>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link href={`/dou?${new URLSearchParams({ ...(effectiveFilters as Record<string, string>), page: String(page - 1) })}`}
              className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>← Anterior</Link>
          )}
          <span className="px-4 py-2 text-sm" style={{ color: "var(--text-muted)" }}>Página {page} de {pages}</span>
          {page < pages && (
            <Link href={`/dou?${new URLSearchParams({ ...(effectiveFilters as Record<string, string>), page: String(page + 1) })}`}
              className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>Próxima →</Link>
          )}
        </div>
      )}
    </div>
  )
}
