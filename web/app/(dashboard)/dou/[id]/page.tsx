import { queryOne } from "@/lib/db"
import { Badge } from "@/components/badge"
import Link from "next/link"
import { notFound } from "next/navigation"
import { TextoCompleto } from "./texto-completo"

export default async function DouAtoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const ato = await queryOne<{
    id: string; edicao: string; secao: string; pagina: number
    tipo_ato: string; orgao: string; titulo: string; texto_completo: string
    resumo_executivo: string; temas_primarios: string[]; temas_secundarios: string[]
    impacto_estimado: string; alinhamento: string; alinhamento_score: number
    alinhamento_just: string; risco_politico: string; recomendacao: string
    processado: boolean
  }>(`SELECT * FROM dou_atos WHERE id = $1`, [id])

  if (!ato) notFound()

  const score = ato.alinhamento_score ? Math.round(Math.min(ato.alinhamento_score, 1) * 100) : null

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      <Link href="/dou" className="text-sm transition-colors" style={{ color: "var(--text-muted)" }}>← Diário Oficial</Link>

      {/* Header */}
      <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-muted)" }}>
            Edição {ato.edicao}
          </span>
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-muted)" }}>
            Seção {ato.secao}
          </span>
          {ato.pagina && (
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-muted)" }}>
              p. {ato.pagina}
            </span>
          )}
        </div>

        {ato.tipo_ato && (
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--primary)" }}>{ato.tipo_ato}</p>
        )}
        {ato.orgao && (
          <p className="font-semibold text-base" style={{ color: "var(--text)" }}>{ato.orgao}</p>
        )}
        {ato.titulo && (
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{ato.titulo}</p>
        )}

        {ato.resumo_executivo && (
          <div className="p-4 rounded-lg" style={{ background: "var(--surface-deep)", border: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>Resumo executivo</p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{ato.resumo_executivo}</p>
          </div>
        )}

        {ato.temas_primarios?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {ato.temas_primarios.map(t => (
              <span key={t} className="text-xs px-2.5 py-1 rounded-full" style={{ background: "var(--border)", color: "var(--text-muted)" }}>{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Alinhamento */}
      <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h2 className="font-semibold mb-4" style={{ color: "var(--text)" }}>Análise de Alinhamento</h2>
        {!ato.processado ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>⏳ Aguardando processamento pela IA</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge value={ato.alinhamento} />
              {score !== null && (
                <span className="text-sm font-semibold" style={{ color: score >= 70 ? "var(--red)" : "var(--yellow)" }}>
                  {score}% confiança
                </span>
              )}
            </div>
            {ato.alinhamento_just && (
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>{ato.alinhamento_just}</p>
            )}
            <div className="flex gap-3">
              <div className="flex-1 p-3 rounded-lg" style={{ background: "var(--surface-deep)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Risco político</p>
                <Badge value={ato.risco_politico} />
              </div>
              <div className="flex-1 p-3 rounded-lg" style={{ background: "var(--surface-deep)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Impacto</p>
                <Badge value={ato.impacto_estimado} />
              </div>
            </div>
            {ato.recomendacao && (
              <div className="p-3 rounded-lg" style={{ background: "var(--surface-deep)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--text-dim)" }}>Recomendação</p>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{ato.recomendacao}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Texto completo */}
      {ato.texto_completo && <TextoCompleto texto={ato.texto_completo} />}
    </div>
  )
}
