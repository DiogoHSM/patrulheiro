import { query, queryOne } from "@/lib/db"
import { Badge } from "@/components/badge"
import Link from "next/link"
import { notFound } from "next/navigation"

function senadoUrl(fonteId: string) {
  return `https://www25.senado.leg.br/web/atividade/materias/-/materia/${fonteId}`
}

export default async function SenadorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const senador = await queryOne<{ nome: string; partido: string; uf: string; url_perfil: string }>(`
    SELECT DISTINCT ON (fonte_id) nome, partido, uf, url_perfil
    FROM proposicao_autores
    WHERE fonte_id = $1
    ORDER BY fonte_id, created_at DESC
  `, [id])

  if (!senador) notFound()

  const proposicoes = await query<{
    id: string; tipo: string; numero: number; ano: number
    ementa: string; alinhamento: string; risco_politico: string
    fonte_id: string; processado: boolean; data_apresentacao: string
    tipo_autoria: string
  }>(`
    SELECT p.id, p.tipo, p.numero, p.ano, LEFT(p.ementa, 120) AS ementa,
           p.alinhamento, p.risco_politico, p.fonte_id, p.processado,
           p.data_apresentacao, a.tipo_autoria
    FROM proposicao_autores a
    JOIN proposicoes p ON p.id = a.proposicao_id
    WHERE a.fonte_id = $1 AND p.fonte = 'senado'
    ORDER BY p.data_apresentacao DESC NULLS LAST
  `, [id])

  const total = proposicoes.length
  const classificadas = proposicoes.filter(p => p.processado)
  const contrarias = classificadas.filter(p => p.alinhamento === 'contrario').length
  const favoraveis = classificadas.filter(p => p.alinhamento === 'favoravel').length
  const pendentes = proposicoes.filter(p => !p.processado).length

  const alinhamentoVotos = await queryOne<{ total_votos: string; votos_alinhados: string }>(`
    SELECT
      COUNT(*)::text AS total_votos,
      COUNT(*) FILTER (WHERE
        (UPPER(vt.orientacao_pl) = 'SIM' AND v.tipo_voto = 'Sim') OR
        (UPPER(vt.orientacao_pl) IN ('NÃO','NAO','CONTRÁRIO','CONTRARIO') AND v.tipo_voto = 'Não')
      )::text AS votos_alinhados
    FROM votos v
    JOIN votacoes vt ON vt.id = v.votacao_id
    WHERE v.deputado_id = $1
      AND vt.orientacao_pl IS NOT NULL
      AND UPPER(vt.orientacao_pl) NOT IN ('LIBERADO','LIBERAL')
      AND vt.fonte = 'senado'
  `, [id])

  const totalVotos = Number(alinhamentoVotos?.total_votos ?? 0)
  const votosAlinhados = Number(alinhamentoVotos?.votos_alinhados ?? 0)
  const pctAlinhamento = totalVotos >= 3 ? Math.round((votosAlinhados / totalVotos) * 100) : null

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      <Link href="/senadores" className="text-sm transition-colors" style={{ color: "var(--text-muted)" }}>← Senadores</Link>

      {/* Header */}
      <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>{senador.nome}</h1>
            <div className="flex items-center gap-3 mt-1">
              {senador.partido && <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>{senador.partido}</span>}
              {senador.uf && <span className="text-sm" style={{ color: "var(--text-muted)" }}>{senador.uf}</span>}
            </div>
          </div>
          {senador.url_perfil && (
            <a href={senador.url_perfil} target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--surface)", border: "1px solid var(--primary)", color: "var(--primary)" }}>
              Perfil no Senado ↗
            </a>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label: "Proposições", value: total, color: "var(--text)" },
            { label: "Favoráveis", value: favoraveis, color: "var(--green)" },
            { label: "Contrárias", value: contrarias, color: "var(--red)" },
            { label: "Pendentes", value: pendentes, color: "var(--text-dim)" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg p-3" style={{ background: "var(--surface-deep)" }}>
              <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>{label}</p>
              <p className="text-xl font-bold" style={{ color }}>{value}</p>
            </div>
          ))}
          {pctAlinhamento !== null && (
            <div className="rounded-lg p-3" style={{ background: "var(--surface-deep)" }}>
              <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Alinhamento em votações</p>
              <p className="text-xl font-bold" style={{
                color: pctAlinhamento >= 70 ? "var(--green)" : pctAlinhamento <= 40 ? "var(--red)" : "var(--yellow)"
              }}>{pctAlinhamento}%</p>
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>{votosAlinhados}/{totalVotos} votos</p>
            </div>
          )}
        </div>
      </div>

      {/* Proposições */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Proposições</h2>
        </div>
        <div style={{ background: "var(--surface-deep)" }}>
          {proposicoes.map((p, i) => (
            <div key={p.id} className="px-5 py-3 row-hover"
              style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Link href={`/proposicoes/${p.id}`}
                      className="font-mono font-semibold text-xs hover:underline"
                      style={{ color: "var(--yellow)" }}>
                      {p.tipo} {p.numero}/{p.ano}
                    </Link>
                    <a href={senadoUrl(p.fonte_id)} target="_blank" rel="noopener noreferrer"
                      className="text-xs hover:opacity-80" style={{ color: "var(--text-dim)" }}>↗</a>
                    {p.tipo_autoria !== "autor" && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-dim)" }}>
                        {p.tipo_autoria}
                      </span>
                    )}
                    {p.data_apresentacao && (
                      <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                        {new Date(p.data_apresentacao).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--text-muted)" }}>{p.ementa}</p>
                </div>
                <div className="shrink-0">
                  {p.processado ? <Badge value={p.alinhamento} /> : (
                    <span className="text-xs" style={{ color: "var(--text-dim)" }}>⏳</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
