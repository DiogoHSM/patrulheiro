import { query } from "@/lib/db"
import { SortControls } from "@/components/sort-controls"
import Link from "next/link"

async function getSenadores() {
  return query<{
    fonte_id: string; nome: string; partido: string; uf: string
    total: string; favoraveis: string; contrarias: string; pendentes: string
  }>(`
    SELECT
      a.fonte_id,
      a.nome,
      a.partido,
      a.uf,
      COUNT(DISTINCT p.id)::text                                             AS total,
      COUNT(DISTINCT p.id) FILTER (WHERE p.alinhamento = 'favoravel')::text AS favoraveis,
      COUNT(DISTINCT p.id) FILTER (WHERE p.alinhamento = 'contrario')::text AS contrarias,
      COUNT(DISTINCT p.id) FILTER (WHERE p.processado = FALSE)::text        AS pendentes
    FROM proposicao_autores a
    JOIN proposicoes p ON p.id = a.proposicao_id
    WHERE p.fonte = 'senado'
      AND a.fonte_id IS NOT NULL AND a.fonte_id != ''
    GROUP BY a.fonte_id, a.nome, a.partido, a.uf
    ORDER BY COUNT(DISTINCT p.id) DESC
  `)
}

async function getAlinhamentoVotos() {
  const rows = await query<{ fonte_id: string; total_votos: string; votos_alinhados: string }>(`
    SELECT
      v.deputado_id AS fonte_id,
      COUNT(*)::text AS total_votos,
      COUNT(*) FILTER (WHERE
        (UPPER(vt.orientacao_pl) = 'SIM' AND v.tipo_voto = 'Sim') OR
        (UPPER(vt.orientacao_pl) IN ('NÃO','NAO','CONTRÁRIO','CONTRARIO') AND v.tipo_voto = 'Não')
      )::text AS votos_alinhados
    FROM votos v
    JOIN votacoes vt ON vt.id = v.votacao_id
    WHERE vt.orientacao_pl IS NOT NULL
      AND UPPER(vt.orientacao_pl) NOT IN ('LIBERADO','LIBERAL')
      AND vt.fonte = 'senado'
    GROUP BY v.deputado_id
    HAVING COUNT(*) >= 3
  `)
  return Object.fromEntries(rows.map(r => [r.fonte_id, r]))
}

const PARTIDO_CORES: Record<string, string> = {
  PL: "#004f9f",
  PT: "#cc0000",
  UNIÃO: "#e87722",
  PSD: "#005ba1",
  MDB: "#009c3b",
  REPUBLICANOS: "#1e3a6e",
  PP: "#0066cc",
  PODEMOS: "#00aaff",
  PSDB: "#0060a8",
  NOVO: "#f58220",
}

function alinhamentoPct(fav: number, cont: number): number | null {
  const total = fav + cont
  return total >= 2 ? Math.round((fav / total) * 100) : null
}

export default async function SenadoresPage({ searchParams }: { searchParams: Promise<{ sort?: string; order?: string; partido?: string }> }) {
  const { sort = "alinhamento", order = "desc", partido: partido_filtro } = await searchParams
  const [senadores, alinhamentoVotos] = await Promise.all([getSenadores(), getAlinhamentoVotos()])

  const filtered = partido_filtro ? senadores.filter(s => s.partido === partido_filtro) : senadores

  const sorted = [...filtered].sort((a, b) => {
    let diff = 0
    if (sort === "nome") {
      diff = a.nome.localeCompare(b.nome, "pt-BR")
    } else if (sort === "total") {
      diff = Number(a.total) - Number(b.total)
    } else {
      const pctA = alinhamentoPct(Number(a.favoraveis), Number(a.contrarias)) ?? -1
      const pctB = alinhamentoPct(Number(b.favoraveis), Number(b.contrarias)) ?? -1
      diff = pctA - pctB
    }
    return order === "asc" ? diff : -diff
  })

  const partidos = [...new Set(senadores.map(s => s.partido).filter(Boolean))]
    .map(partido => {
      const membros = senadores.filter(s => s.partido === partido)
      const totalFav = membros.reduce((acc, s) => acc + Number(s.favoraveis), 0)
      const totalCont = membros.reduce((acc, s) => acc + Number(s.contrarias), 0)
      const pctAlinhamento = alinhamentoPct(totalFav, totalCont)
      const contrarias = totalCont
      return { partido, membros, pctAlinhamento, contrarias }
    })
    .sort((a, b) => (b.pctAlinhamento ?? -1) - (a.pctAlinhamento ?? -1))

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Senadores</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {partido_filtro ? `${sorted.length} de ` : ""}{senadores.length} senadores com proposições monitoradas
          {partido_filtro && <span className="ml-1 font-semibold" style={{ color: "var(--primary)" }}>· {partido_filtro}</span>}
        </p>
      </div>

      {/* Por partido */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {partidos.map(({ partido, membros, pctAlinhamento, contrarias }) => {
          const ativo = partido === partido_filtro
          const href = ativo
            ? `?sort=${sort}&order=${order}`
            : `?sort=${sort}&order=${order}&partido=${partido}`
          return (
            <Link key={partido} href={href} className="rounded-xl p-4 block transition-all"
              style={{
                background: ativo ? "var(--primary)" : "var(--surface)",
                border: `1px solid ${ativo ? "var(--primary)" : "var(--border)"}`,
              }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: ativo ? "#fff" : (PARTIDO_CORES[partido] ?? "var(--text-dim)") }} />
                <span className="font-bold text-sm" style={{ color: ativo ? "#fff" : "var(--text)" }}>{partido}</span>
              </div>
              <p className="text-xs" style={{ color: ativo ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}>{membros.length} senador{membros.length !== 1 ? "es" : ""}</p>
              {pctAlinhamento !== null && (
                <p className="text-xs mt-0.5 font-semibold" style={{
                  color: ativo ? "#fff" : (pctAlinhamento >= 60 ? "var(--green)" : pctAlinhamento <= 30 ? "var(--red)" : "var(--yellow)")
                }}>{pctAlinhamento}% alinhado</p>
              )}
              {contrarias > 0 && (
                <p className="text-xs mt-0.5" style={{ color: ativo ? "rgba(255,255,255,0.6)" : "var(--text-dim)" }}>{contrarias} contrária{contrarias !== 1 ? "s" : ""}</p>
              )}
            </Link>
          )
        })}
      </div>

      {/* Lista */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Todos os senadores</h2>
          <SortControls sort={sort} order={order} partido={partido_filtro} />
        </div>
        <div style={{ background: "var(--surface-deep)" }}>
          {sorted.map((s, i) => {
            const total = Number(s.total)
            const contrarias = Number(s.contrarias)
            const favoraveis = Number(s.favoraveis)
            const pendentes = Number(s.pendentes)
            const classificadas = total - pendentes
            const pctContrarias = classificadas > 0 ? Math.round((contrarias / classificadas) * 100) : 0
            const voto = alinhamentoVotos[s.fonte_id]
            const pctAlinhamento = voto
              ? Math.round((Number(voto.votos_alinhados) / Number(voto.total_votos)) * 100)
              : null

            return (
              <div key={s.fonte_id} className="px-5 py-3 row-hover"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-1.5 h-8 rounded-full shrink-0"
                      style={{ background: PARTIDO_CORES[s.partido] ?? "var(--border)" }} />
                    <div className="min-w-0">
                      <Link
                        href={`/senadores/${s.fonte_id}`}
                        className="font-medium text-sm hover:underline"
                        style={{ color: "var(--text)" }}
                      >
                        {s.nome}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-semibold" style={{ color: PARTIDO_CORES[s.partido] ?? "var(--text-dim)" }}>{s.partido}</span>
                        {s.uf && <span className="text-xs" style={{ color: "var(--text-dim)" }}>{s.uf}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-xs">
                    <span style={{ color: "var(--text-dim)" }}>{total} prop.</span>
                    {favoraveis > 0 && (
                      <span className="font-semibold" style={{ color: "var(--green)" }}>+{favoraveis}</span>
                    )}
                    {contrarias > 0 && (
                      <span className="font-semibold" style={{ color: "var(--red)" }}>−{contrarias}</span>
                    )}
                    {pendentes > 0 && (
                      <span style={{ color: "var(--text-dim)" }}>⏳{pendentes}</span>
                    )}
                    {pctAlinhamento !== null && (
                      <span className="px-1.5 py-0.5 rounded font-semibold"
                        style={{
                          background: pctAlinhamento >= 70
                            ? "color-mix(in srgb, var(--green) 15%, transparent)"
                            : pctAlinhamento <= 40
                              ? "color-mix(in srgb, var(--red) 15%, transparent)"
                              : "color-mix(in srgb, var(--yellow) 15%, transparent)",
                          color: pctAlinhamento >= 70 ? "var(--green)" : pctAlinhamento <= 40 ? "var(--red)" : "var(--yellow)",
                        }}>
                        {pctAlinhamento}% alinhado
                      </span>
                    )}
                    {pctContrarias >= 30 && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-bold"
                        style={{ background: "color-mix(in srgb, var(--red) 15%, transparent)", color: "var(--red)" }}>
                        {pctContrarias}% ✗
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
