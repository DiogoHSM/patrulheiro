import { query, queryOne } from "@/lib/db"
import { Badge } from "@/components/badge"
import Link from "next/link"
import { notFound } from "next/navigation"

function camaraUrl(fonteId: string) {
  return `https://www.camara.leg.br/deputados/${fonteId}`
}

function camaraProposicaoUrl(fonteId: string) {
  return `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${fonteId}`
}

export default async function DeputadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const deputado = await queryOne<{ nome: string; partido: string; uf: string }>(`
    SELECT DISTINCT ON (fonte_id) nome, partido, uf
    FROM proposicao_autores
    WHERE fonte_id = $1
    ORDER BY fonte_id, created_at DESC
  `, [id])

  if (!deputado) notFound()

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
    WHERE a.fonte_id = $1 AND p.fonte = 'camara'
    ORDER BY p.data_apresentacao DESC NULLS LAST
  `, [id])

  const total = proposicoes.length
  const classificadas = proposicoes.filter(p => p.processado)
  const contrarias = classificadas.filter(p => p.alinhamento === 'contrario').length
  const favoraveis = classificadas.filter(p => p.alinhamento === 'favoravel').length
  const pendentes = proposicoes.filter(p => !p.processado).length

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      <Link href="/deputados" className="text-sm transition-colors" style={{ color: "var(--text-muted)" }}>← Deputados</Link>

      {/* Header */}
      <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>{deputado.nome}</h1>
            <div className="flex items-center gap-3 mt-1">
              {deputado.partido && <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>{deputado.partido}</span>}
              {deputado.uf && <span className="text-sm" style={{ color: "var(--text-muted)" }}>{deputado.uf}</span>}
            </div>
          </div>
          <a href={camaraUrl(id)} target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: "var(--surface)", border: "1px solid var(--primary)", color: "var(--primary)" }}>
            Perfil na Câmara ↗
          </a>
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
                    <a href={camaraProposicaoUrl(p.fonte_id)} target="_blank" rel="noopener noreferrer"
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
