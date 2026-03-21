import { query, queryOne } from "@/lib/db"
import { Badge } from "@/components/badge"
import Link from "next/link"
import { notFound } from "next/navigation"

// Normaliza o tipo_voto para uma das 3 categorias
function categorizaVoto(tipo: string): "sim" | "nao" | "outro" {
  const t = tipo.toLowerCase().trim()
  if (t === "sim") return "sim"
  if (t === "não" || t === "nao" || t === "nÃo") return "nao"
  return "outro"
}

function VotoBadge({ tipo }: { tipo: string }) {
  const cat = categorizaVoto(tipo)
  const cfg = {
    sim:   { bg: "color-mix(in srgb, var(--green) 15%, transparent)", color: "var(--green)",  label: "Sim" },
    nao:   { bg: "color-mix(in srgb, var(--red)   15%, transparent)", color: "var(--red)",    label: "Não" },
    outro: { bg: "color-mix(in srgb, var(--text-dim) 12%, transparent)", color: "var(--text-muted)", label: tipo },
  }[cat]
  return (
    <span className="px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

export default async function VotacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const votacao = await queryOne<{
    id: string; votacao_id: string; fonte: string | null; data: string
    sigla_orgao: string; descricao: string; aprovacao: number | null
    votos_sim: number | null; votos_nao: number | null; votos_abstencao: number | null
    orientacao_pl: string | null; prop_id: string; tipo: string; numero: number; ano: number
    alinhamento: string | null
  }>(`
    SELECT v.id, v.votacao_id, v.fonte, v.data, v.sigla_orgao, v.descricao,
           v.aprovacao, v.votos_sim, v.votos_nao, v.votos_abstencao, v.orientacao_pl,
           p.id AS prop_id, p.tipo, p.numero, p.ano, p.alinhamento
    FROM votacoes v
    JOIN proposicoes p ON p.id = v.proposicao_id
    WHERE v.id = $1
  `, [id])

  if (!votacao) notFound()

  // fonte da votação determina a origem dos votos — sem ambiguidade
  const fonteLabel = votacao.fonte === "senado" ? "Senado" : "Câmara"

  const votos = await query<{
    deputado_id: string; deputado_nome: string
    partido: string | null; uf: string | null; tipo_voto: string
  }>(`
    SELECT deputado_id, deputado_nome, partido, uf, tipo_voto
    FROM votos
    WHERE votacao_id = $1
    ORDER BY tipo_voto, partido NULLS LAST, deputado_nome
  `, [id])

  const sim   = votos.filter(v => categorizaVoto(v.tipo_voto) === "sim")
  const nao   = votos.filter(v => categorizaVoto(v.tipo_voto) === "nao")
  const outro = votos.filter(v => categorizaVoto(v.tipo_voto) === "outro")

  const isAprovado = votacao.aprovacao === 1
  const isRejeitado = votacao.aprovacao === 0

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      <Link href="/votacoes" className="text-sm" style={{ color: "var(--text-muted)" }}>← Votações</Link>

      {/* Header */}
      <div className="rounded-xl p-6 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/proposicoes/${votacao.prop_id}`}
                className="font-mono font-bold text-lg hover:underline"
                style={{ color: "var(--yellow)" }}>
                {votacao.tipo} {votacao.numero}/{votacao.ano}
              </Link>
              <span className="text-xs px-2 py-0.5 rounded capitalize font-semibold"
                style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                {fonteLabel}
              </span>
              {votacao.sigla_orgao && (
                <span className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
                  {votacao.sigla_orgao}
                </span>
              )}
            </div>
            {votacao.descricao && (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>{votacao.descricao}</p>
            )}
          </div>
          <span className="text-sm shrink-0" style={{ color: "var(--text-dim)" }}>
            {votacao.data ? new Date(votacao.data).toLocaleDateString("pt-BR") : "—"}
          </span>
        </div>

        {/* Resultado + orientação */}
        <div className="flex items-center gap-3 flex-wrap">
          {votacao.aprovacao !== null && (
            <span className="px-3 py-1 rounded-lg text-sm font-semibold"
              style={{
                background: isAprovado
                  ? "color-mix(in srgb, var(--green) 15%, transparent)"
                  : "color-mix(in srgb, var(--red) 15%, transparent)",
                color: isAprovado ? "var(--green)" : "var(--red)",
              }}>
              {isAprovado ? "✓ Aprovado" : "✗ Rejeitado"}
            </span>
          )}
          {votacao.orientacao_pl && (
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              Orientação PL: <span className="font-semibold" style={{ color: "var(--text)" }}>{votacao.orientacao_pl}</span>
            </span>
          )}
          {votacao.alinhamento && <Badge value={votacao.alinhamento} />}
        </div>

        {/* Placar */}
        {votos.length > 0 && (
          <div className="flex items-center gap-6 pt-2">
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "var(--green)" }}>{sim.length}</p>
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>Sim</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "var(--red)" }}>{nao.length}</p>
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>Não</p>
            </div>
            {outro.length > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: "var(--text-muted)" }}>{outro.length}</p>
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>Outros</p>
              </div>
            )}
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: "var(--text)" }}>{votos.length}</p>
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>Total</p>
            </div>
          </div>
        )}

        {votos.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Votos individuais não disponíveis para esta votação.
          </p>
        )}
      </div>

      {/* Lista de votos */}
      {votos.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
            <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>
              Votos nominais — {fonteLabel} ({votos.length})
            </h2>
          </div>
          <div style={{ background: "var(--surface-deep)" }}>
            {votos.map((v, i) => (
              <div key={`${i}-${v.deputado_id}`} className="px-5 py-2.5 row-hover"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                        {v.deputado_nome}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {v.partido && (
                          <span className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
                            {v.partido}
                          </span>
                        )}
                        {v.uf && (
                          <span className="text-xs" style={{ color: "var(--text-dim)" }}>{v.uf}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <VotoBadge tipo={v.tipo_voto} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
