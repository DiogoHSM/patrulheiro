import { query } from "@/lib/db"
import { Badge } from "@/components/badge"
import Link from "next/link"

function camaraUrl(fonteId: string) {
  return `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${fonteId}`
}
function senadoUrl(fonteId: string) {
  return `https://www25.senado.leg.br/web/atividade/materias/-/materia/${fonteId}`
}

async function getStats() {
  const [r] = await query<{ total: string; favoraveis: string; contrarias: string; pendentes: string; ambiguas: string; neutras: string }>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE alinhamento = 'favoravel') AS favoraveis,
      COUNT(*) FILTER (WHERE alinhamento = 'contrario') AS contrarias,
      COUNT(*) FILTER (WHERE alinhamento = 'ambiguo')  AS ambiguas,
      COUNT(*) FILTER (WHERE alinhamento = 'neutro')   AS neutras,
      COUNT(*) FILTER (WHERE processado = FALSE)        AS pendentes
    FROM proposicoes
  `)
  return r
}

async function getCriticas() {
  return query<{
    id: string; tipo: string; numero: number; ano: number
    ementa: string; alinhamento_score: number; risco_politico: string
    fonte: string; fonte_id: string; temas_primarios: string[]
  }>(`
    SELECT id, tipo, numero, ano, LEFT(ementa, 110) AS ementa,
           alinhamento_score, risco_politico, fonte, fonte_id, temas_primarios
    FROM proposicoes
    WHERE alinhamento = 'contrario'
      AND (situacao IS NULL OR situacao NOT IN ('Arquivada', 'Rejeitada', 'Vetada'))
    ORDER BY risco_politico = 'alto' DESC, alinhamento_score DESC NULLS LAST, data_apresentacao DESC
    LIMIT 8
  `)
}

async function getRecentes() {
  return query<{
    id: string; tipo: string; numero: number; ano: number
    ementa: string; alinhamento: string
    fonte: string; fonte_id: string
  }>(`
    SELECT id, tipo, numero, ano, LEFT(ementa, 90) AS ementa,
           alinhamento, fonte, fonte_id
    FROM proposicoes
    WHERE processado = TRUE
    ORDER BY updated_at DESC
    LIMIT 6
  `)
}

async function getTopTemas() {
  return query<{ tema: string; total: string; contrarias: string }>(`
    SELECT
      INITCAP(LOWER(TRIM(unnest(temas_primarios)))) AS tema,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE alinhamento = 'contrario') AS contrarias
    FROM proposicoes
    WHERE processado = TRUE AND temas_primarios IS NOT NULL
    GROUP BY 1
    ORDER BY contrarias DESC, total DESC
    LIMIT 6
  `)
}

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4 md:p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="text-2xl md:text-3xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{sub}</p>}
    </div>
  )
}

function Panel({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
      <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>{title}</h2>
      {action}
    </div>
  )
}

export default async function DashboardPage() {
  const [stats, criticas, recentes, temas] = await Promise.all([
    getStats(), getCriticas(), getRecentes(), getTopTemas()
  ])

  const processadas = Number(stats?.total ?? 0) - Number(stats?.pendentes ?? 0)
  const pctRaw = stats?.total ? (processadas / Number(stats.total)) * 100 : 0
  const pct = Number(stats?.pendentes) > 0 ? Math.min(Math.floor(pctRaw * 10) / 10, 99.9) : 100

  return (
    <div className="p-4 md:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Análise de Proposições</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Monitoramento legislativo — Câmara e Senado</p>
        </div>
      </div>

      {/* KPI Cards — inline style com CSS var responsiva */}
      <div style={{ display: "grid", gridTemplateColumns: "var(--kpi-cols)", gap: "var(--kpi-gap)" }}>
        <StatCard label="Monitoradas" value={Number(stats?.total ?? 0).toLocaleString("pt-BR")} color="var(--text)" sub="fev–mar 2026" />
        <StatCard label="Favoráveis"  value={Number(stats?.favoraveis ?? 0).toLocaleString("pt-BR")} color="var(--green)" />
        <StatCard label="Contrárias"  value={Number(stats?.contrarias ?? 0).toLocaleString("pt-BR")} color="var(--red)" />
        <StatCard label="Ambíguas"    value={Number(stats?.ambiguas ?? 0).toLocaleString("pt-BR")}  color="var(--yellow)" />
        <StatCard label="Neutras"     value={Number(stats?.neutras ?? 0).toLocaleString("pt-BR")}   color="var(--text-muted)" />
      </div>

      {/* Main grid — 1 col mobile / 2 cols desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Radar */}
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <Panel
            title="⚠️ Radar — Contrárias ao PL"
            action={<Link href="/proposicoes?alinhamento=contrario" className="text-xs hover:underline" style={{ color: "var(--primary)" }}>Ver todas →</Link>}
          />
          <div style={{ background: "var(--surface-deep)" }}>
            {criticas.length === 0 ? (
              <p className="px-5 py-8 text-sm text-center" style={{ color: "var(--text-dim)" }}>
                {Number(stats?.pendentes) > 0 ? "⏳ Aguardando análise…" : "Nenhuma proposição contrária identificada"}
              </p>
            ) : criticas.map((p, i) => (
              <div key={p.id} className="px-5 py-3 row-hover"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Link href={`/proposicoes/${p.id}`} className="font-mono font-semibold text-xs hover:underline" style={{ color: "var(--yellow)" }}>
                        {p.tipo} {p.numero}/{p.ano}
                      </Link>
                      <a href={p.fonte === "camara" ? camaraUrl(p.fonte_id) : senadoUrl(p.fonte_id)}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                        style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                        {p.fonte === "camara" ? "Câmara ↗" : "Senado ↗"}
                      </a>
                      <Badge value={p.risco_politico} />
                    </div>
                    <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--text-muted)" }}>{p.ementa}</p>
                    {p.temas_primarios?.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {p.temas_primarios.slice(0, 2).map(t => (
                          <span key={t} className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-dim)" }}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {p.alinhamento_score && (
                    <span className="text-xs font-bold shrink-0 mt-0.5" style={{ color: "var(--red)" }}>
                      {Math.round(Math.min(p.alinhamento_score, 1) * 100)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Recentes */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <Panel
              title="🕐 Recém analisadas"
              action={<Link href="/proposicoes" className="text-xs hover:underline" style={{ color: "var(--primary)" }}>Ver todas →</Link>}
            />
            <div style={{ background: "var(--surface-deep)" }}>
              {recentes.length === 0 ? (
                <p className="px-5 py-6 text-sm text-center" style={{ color: "var(--text-dim)" }}>⏳ Aguardando análise…</p>
              ) : recentes.map((p, i) => (
                <div key={p.id} className="px-5 py-3 row-hover"
                  style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Link href={`/proposicoes/${p.id}`} className="font-mono font-semibold text-xs hover:underline" style={{ color: "var(--text-muted)" }}>
                          {p.tipo} {p.numero}/{p.ano}
                        </Link>
                        <a href={p.fonte === "camara" ? camaraUrl(p.fonte_id) : senadoUrl(p.fonte_id)}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs hover:opacity-80"
                          style={{ color: "var(--text-dim)" }}>↗</a>
                      </div>
                      <p className="text-xs line-clamp-1" style={{ color: "var(--text-muted)" }}>{p.ementa}</p>
                    </div>
                    <Badge value={p.alinhamento} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Temas */}
          {temas.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <Panel title="🎯 Temas com mais contrárias" />
              <div className="p-4 space-y-2" style={{ background: "var(--surface-deep)" }}>
                {temas.map((t) => (
                  <div key={t.tema} className="flex items-center gap-3">
                    <span className="text-xs flex-1 truncate" style={{ color: "var(--text-muted)" }}>{t.tema}</span>
                    <div className="flex items-center gap-2">
                      {Number(t.contrarias) > 0 && (
                        <span className="text-xs font-semibold" style={{ color: "var(--red)" }}>{t.contrarias} ✗</span>
                      )}
                      <span className="text-xs" style={{ color: "var(--text-dim)" }}>{t.total} total</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
