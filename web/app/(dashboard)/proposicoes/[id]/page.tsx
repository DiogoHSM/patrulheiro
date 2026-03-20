import { query, queryOne } from "@/lib/db"
import { Badge } from "@/components/badge"
import { MonitorarButton } from "@/components/monitorar-button"
import Link from "next/link"
import { notFound } from "next/navigation"

function fonteUrl(fonte: string, fonteId: string) {
  if (fonte === "camara") return `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${fonteId}`
  return `https://www25.senado.leg.br/web/atividade/materias/-/materia/${fonteId}`
}

export default async function ProposicaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const prop = await queryOne<{
    id: string; tipo: string; numero: number; ano: number; ementa: string
    resumo_executivo: string; fonte: string; fonte_id: string; situacao: string; regime: string
    orgao_atual: string; data_apresentacao: string; url_inteiro_teor: string
    temas_primarios: string[]; temas_secundarios: string[]; entidades_citadas: string[]
    impacto_estimado: string; urgencia_ia: string
    alinhamento: string; alinhamento_score: number; alinhamento_just: string
    risco_politico: string; recomendacao: string; processado: boolean
  }>(`SELECT * FROM proposicoes WHERE id = $1`, [id])

  if (!prop) notFound()

  const autores = await query<{ nome: string; partido: string; uf: string; tipo_autoria: string; fonte_id: string }>(
    `SELECT nome, partido, uf, tipo_autoria, fonte_id FROM proposicao_autores WHERE proposicao_id = $1 ORDER BY tipo_autoria`, [id]
  )

  const tramitacoes = await query<{ data: string; descricao: string; orgao: string }>(`
    SELECT DISTINCT ON (data, orgao, descricao) data, orgao, descricao
    FROM tramitacoes WHERE proposicao_id = $1
    ORDER BY data DESC, orgao, descricao
    LIMIT 15
  `, [id])

  const monitoramento = await queryOne(
    `SELECT id FROM monitoramentos WHERE proposicao_id = $1`, [id]
  )

  const score = prop.alinhamento_score ? Math.round(Math.min(prop.alinhamento_score, 1) * 100) : null

  return (
    <div className="p-4 md:p-8 max-w-5xl space-y-6">
      {/* Back */}
      <Link href="/proposicoes" className="text-sm transition-colors" style={{ color: "var(--text-muted)" }}>← Voltar</Link>

      {/* Header */}
      <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <span className="font-mono font-bold text-lg" style={{ color: "var(--yellow)" }}>
                {prop.tipo} {prop.numero}/{prop.ano}
              </span>
              <span className="text-xs px-2 py-0.5 rounded capitalize" style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                {prop.fonte}
              </span>
              {prop.regime && (
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                  {prop.regime}
                </span>
              )}
            </div>
            <p className="text-base leading-relaxed" style={{ color: "var(--text)" }}>{prop.ementa}</p>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <MonitorarButton proposicaoId={id} monitorando={!!monitoramento} />
            <a href={fonteUrl(prop.fonte, prop.fonte_id)} target="_blank" rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 capitalize"
              style={{ background: "var(--surface)", border: "1px solid var(--primary)", color: "var(--primary)" }}>
              {prop.fonte === "camara" ? "Câmara" : "Senado"} ↗
            </a>
            {prop.url_inteiro_teor && (
              <a href={prop.url_inteiro_teor} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: "var(--primary)" }}>
                📄 Inteiro teor
              </a>
            )}
          </div>
        </div>

        {prop.resumo_executivo && (
          <div className="mt-4 p-4 rounded-lg" style={{ background: "var(--surface-deep)", border: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Resumo executivo</p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{prop.resumo_executivo}</p>
          </div>
        )}

        {prop.temas_primarios?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {prop.temas_primarios?.map(t => (
              <span key={t} className="text-xs px-2.5 py-1 rounded-full" style={{ background: "var(--border)", color: "var(--text-muted)" }}>{t}</span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Alinhamento */}
        <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h2 className="font-semibold mb-4" style={{ color: "var(--text)" }}>Análise de Alinhamento</h2>
          {!prop.processado ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>⏳ Aguardando processamento pela IA</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Badge value={prop.alinhamento} />
                {score && (
                  <span className="text-sm font-semibold" style={{ color: score >= 70 ? "var(--red)" : "var(--yellow)" }}>
                    {score}% confiança
                  </span>
                )}
              </div>
              {prop.alinhamento_just && (
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{prop.alinhamento_just}</p>
              )}
              <div className="flex gap-3">
                <div className="flex-1 p-3 rounded-lg" style={{ background: "var(--surface-deep)" }}>
                  <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Risco político</p>
                  <Badge value={prop.risco_politico} />
                </div>
                <div className="flex-1 p-3 rounded-lg" style={{ background: "var(--surface-deep)" }}>
                  <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Impacto</p>
                  <Badge value={prop.impacto_estimado} />
                </div>
              </div>
              {prop.recomendacao && (
                <div className="p-3 rounded-lg" style={{ background: "var(--surface-deep)" }}>
                  <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Recomendação</p>
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>{prop.recomendacao}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Autores + Situação */}
        <div className="space-y-4">
          <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h2 className="font-semibold mb-3" style={{ color: "var(--text)" }}>Situação</h2>
            <div className="space-y-2 text-sm">
              {prop.situacao && <div className="flex justify-between"><span style={{ color: "var(--text-dim)" }}>Status</span><span style={{ color: "var(--text-muted)" }}>{prop.situacao}</span></div>}
              {prop.orgao_atual && <div className="flex justify-between gap-4"><span style={{ color: "var(--text-dim)" }}>Órgão</span><span className="text-right" style={{ color: "var(--text-muted)" }}>{prop.orgao_atual}</span></div>}
              {prop.data_apresentacao && <div className="flex justify-between"><span style={{ color: "var(--text-dim)" }}>Apresentação</span><span style={{ color: "var(--text-muted)" }}>{new Date(prop.data_apresentacao).toLocaleDateString("pt-BR")}</span></div>}
            </div>
          </div>

          {autores.length > 0 && (
            <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h2 className="font-semibold mb-3" style={{ color: "var(--text)" }}>Autores</h2>
              <div className="space-y-2">
                {autores.map((a, i) => {
                  const perfilHref = a.fonte_id
                    ? prop.fonte === "senado"
                      ? `/senadores/${a.fonte_id}`
                      : `/deputados/${a.fonte_id}`
                    : null
                  return (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        {perfilHref ? (
                          <Link href={perfilHref} className="hover:underline" style={{ color: "var(--text-muted)" }}>{a.nome}</Link>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>{a.nome}</span>
                        )}
                        {a.tipo_autoria && a.tipo_autoria !== "autor" && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-dim)" }}>
                            {a.tipo_autoria.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
                        {a.partido && <span style={{ color: "var(--yellow)" }}>{a.partido}</span>}
                        {a.uf && <span>{a.uf}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tramitação */}
      {tramitacoes.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
            <h2 className="font-semibold" style={{ color: "var(--text)" }}>Tramitação</h2>
          </div>
          <div>
            {tramitacoes.map((t, i) => (
              <div key={i} className="px-5 py-3 flex gap-4 text-sm" style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-deep)" }}>
                <span className="whitespace-nowrap shrink-0 text-xs pt-0.5" style={{ color: "var(--text-dim)" }}>
                  {t.data ? new Date(t.data).toLocaleDateString("pt-BR") : "—"}
                </span>
                <div>
                  {t.orgao && <span className="text-xs font-semibold mr-2" style={{ color: "var(--primary)" }}>{t.orgao}</span>}
                  <span style={{ color: "var(--text-muted)" }}>{t.descricao}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
