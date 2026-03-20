import { query } from "@/lib/db"
import Link from "next/link"

async function getDeputados() {
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
    WHERE p.fonte = 'camara'
      AND a.fonte_id IS NOT NULL AND a.fonte_id != ''
    GROUP BY a.fonte_id, a.nome, a.partido, a.uf
    ORDER BY COUNT(DISTINCT p.id) DESC
  `)
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
  PSB: "#ff6600",
  PDT: "#cc0000",
  PRD: "#003580",
}

export default async function DeputadosPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams
  const deputados = await getDeputados()

  const sorted = [...deputados].sort((a, b) => {
    if (sort === "nome") return a.nome.localeCompare(b.nome, "pt-BR")
    const classA = Number(a.total) - Number(a.pendentes)
    const classB = Number(b.total) - Number(b.pendentes)
    const pctA = classA > 0 ? Number(a.favoraveis) / classA : 0
    const pctB = classB > 0 ? Number(b.favoraveis) / classB : 0
    return pctB - pctA
  })

  const partidos = [...new Set(deputados.map(d => d.partido).filter(Boolean))]
    .map(partido => {
      const membros = deputados.filter(d => d.partido === partido)
      const totalFav = membros.reduce((acc, d) => acc + Number(d.favoraveis), 0)
      const totalClass = membros.reduce((acc, d) => acc + Number(d.total) - Number(d.pendentes), 0)
      const pctAlinhamento = totalClass > 0 ? Math.round((totalFav / totalClass) * 100) : 0
      const contrarias = membros.reduce((acc, d) => acc + Number(d.contrarias), 0)
      return { partido, membros, pctAlinhamento, contrarias }
    })
    .sort((a, b) => b.pctAlinhamento - a.pctAlinhamento)

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Deputados</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {deputados.length} deputados com proposições monitoradas
        </p>
      </div>

      {/* Por partido */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {partidos.map(({ partido, membros, pctAlinhamento, contrarias }) => (
          <div key={partido} className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full shrink-0"
                style={{ background: PARTIDO_CORES[partido] ?? "var(--text-dim)" }} />
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{partido}</span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{membros.length} dep.</p>
            {pctAlinhamento > 0 && (
              <p className="text-xs mt-0.5 font-semibold" style={{
                color: pctAlinhamento >= 60 ? "var(--green)" : pctAlinhamento <= 30 ? "var(--red)" : "var(--yellow)"
              }}>{pctAlinhamento}% alinhado</p>
            )}
            {contrarias > 0 && (
              <p className="text-xs mt-0.5" style={{ color: "var(--red)" }}>{contrarias} contrária{contrarias !== 1 ? "s" : ""}</p>
            )}
          </div>
        ))}
      </div>

      {/* Lista */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Todos os deputados</h2>
          <div className="flex items-center gap-1 text-xs">
            <span style={{ color: "var(--text-dim)" }}>Ordenar:</span>
            <Link href="?sort=alinhamento" className="px-2 py-1 rounded transition-colors"
              style={{ background: sort !== "nome" ? "var(--primary)" : "transparent", color: sort !== "nome" ? "#fff" : "var(--text-muted)" }}>
              Alinhamento
            </Link>
            <Link href="?sort=nome" className="px-2 py-1 rounded transition-colors"
              style={{ background: sort === "nome" ? "var(--primary)" : "transparent", color: sort === "nome" ? "#fff" : "var(--text-muted)" }}>
              Nome
            </Link>
          </div>
        </div>
        <div style={{ background: "var(--surface-deep)" }}>
          {sorted.map((d, i) => {
            const total = Number(d.total)
            const contrarias = Number(d.contrarias)
            const favoraveis = Number(d.favoraveis)
            const pendentes = Number(d.pendentes)
            const classificadas = total - pendentes
            const pctContrarias = classificadas > 0 ? Math.round((contrarias / classificadas) * 100) : 0

            return (
              <div key={d.fonte_id} className="px-5 py-3 row-hover"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-1.5 h-8 rounded-full shrink-0"
                      style={{ background: PARTIDO_CORES[d.partido] ?? "var(--border)" }} />
                    <div className="min-w-0">
                      <Link
                        href={`/deputados/${d.fonte_id}`}
                        className="font-medium text-sm hover:underline"
                        style={{ color: "var(--text)" }}
                      >
                        {d.nome}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-semibold" style={{ color: PARTIDO_CORES[d.partido] ?? "var(--text-dim)" }}>{d.partido}</span>
                        {d.uf && <span className="text-xs" style={{ color: "var(--text-dim)" }}>{d.uf}</span>}
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
