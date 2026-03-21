import { query } from "@/lib/db"
import Link from "next/link"
import { Badge } from "@/components/badge"

async function getVotacoes() {
  return query<{
    id: string; votacao_id: string; fonte: string | null
    data: string; sigla_orgao: string; descricao: string
    aprovacao: number | null; votos_sim: number | null; votos_nao: number | null
    votos_abstencao: number | null; orientacao_pl: string | null
    prop_id: string; tipo: string; numero: number; ano: number; alinhamento: string | null
  }>(`
    SELECT v.id, v.votacao_id, v.fonte, v.data, v.sigla_orgao, v.descricao,
           v.aprovacao, v.votos_sim, v.votos_nao, v.votos_abstencao, v.orientacao_pl,
           p.id AS prop_id, p.tipo, p.numero, p.ano, p.alinhamento
    FROM votacoes v
    JOIN proposicoes p ON p.id = v.proposicao_id
    ORDER BY v.data DESC NULLS LAST
    LIMIT 200
  `)
}

function ResultadoBadge({ aprovacao }: { aprovacao: number | null }) {
  if (aprovacao === null) return null
  return (
    <span className="text-xs px-2 py-0.5 rounded font-semibold"
      style={{
        background: aprovacao === 1
          ? "color-mix(in srgb, var(--green) 15%, transparent)"
          : "color-mix(in srgb, var(--red) 15%, transparent)",
        color: aprovacao === 1 ? "var(--green)" : "var(--red)",
      }}>
      {aprovacao === 1 ? "Aprovado" : "Rejeitado"}
    </span>
  )
}

function OrientacaoBadge({ orientacao }: { orientacao: string | null }) {
  if (!orientacao) return null
  const isContra = orientacao.toLowerCase().includes("não") || orientacao.toLowerCase().includes("nao") || orientacao.toLowerCase() === "contrário"
  const isFavor = orientacao.toLowerCase() === "sim" || orientacao.toLowerCase().includes("favor")
  return (
    <span className="text-xs px-2 py-0.5 rounded font-semibold"
      style={{
        background: isFavor
          ? "color-mix(in srgb, var(--green) 15%, transparent)"
          : isContra
            ? "color-mix(in srgb, var(--red) 15%, transparent)"
            : "color-mix(in srgb, var(--yellow) 15%, transparent)",
        color: isFavor ? "var(--green)" : isContra ? "var(--red)" : "var(--yellow)",
      }}>
      PL: {orientacao}
    </span>
  )
}

export default async function VotacoesPage() {
  const votacoes = await getVotacoes()

  const nominais = votacoes.filter(v => v.votos_sim !== null || v.votos_nao !== null)
  const procedurais = votacoes.filter(v => v.votos_sim === null && v.votos_nao === null)

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Votações</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {nominais.length} nominais · {procedurais.length} procedurais
        </p>
      </div>

      {/* Votações nominais — Senado */}
      {nominais.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
            <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Votações nominais</h2>
          </div>
          <div style={{ background: "var(--surface-deep)" }}>
            {nominais.map((v, i) => (
              <div key={v.id} className="px-5 py-4 row-hover"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Link href={`/votacoes/${v.id}`}
                        className="font-mono font-semibold text-sm hover:underline"
                        style={{ color: "var(--primary)" }}>
                        Ver votos ↗
                      </Link>
                      <Link href={`/proposicoes/${v.prop_id}`}
                        className="font-mono font-semibold text-sm hover:underline"
                        style={{ color: "var(--yellow)" }}>
                        {v.tipo} {v.numero}/{v.ano}
                      </Link>
                      <span className="text-xs px-1.5 py-0.5 rounded capitalize"
                        style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                        {v.fonte ?? "câmara"}
                      </span>
                      {v.sigla_orgao && (
                        <span className="text-xs font-semibold" style={{ color: "var(--primary)" }}>{v.sigla_orgao}</span>
                      )}
                      <ResultadoBadge aprovacao={v.aprovacao} />
                      <OrientacaoBadge orientacao={v.orientacao_pl} />
                      {v.alinhamento && <Badge value={v.alinhamento} />}
                    </div>
                    {v.descricao && (
                      <p className="text-xs leading-relaxed line-clamp-2 mb-2" style={{ color: "var(--text-muted)" }}>{v.descricao}</p>
                    )}
                    {/* Placar */}
                    {(v.votos_sim !== null || v.votos_nao !== null) && (
                      <div className="flex items-center gap-4 text-xs">
                        {v.votos_sim !== null && (
                          <span className="font-semibold" style={{ color: "var(--green)" }}>✓ {v.votos_sim} sim</span>
                        )}
                        {v.votos_nao !== null && (
                          <span className="font-semibold" style={{ color: "var(--red)" }}>✗ {v.votos_nao} não</span>
                        )}
                        {v.votos_abstencao !== null && v.votos_abstencao > 0 && (
                          <span style={{ color: "var(--text-dim)" }}>{v.votos_abstencao} abstenção</span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "var(--text-dim)" }}>
                    {v.data ? new Date(v.data).toLocaleDateString("pt-BR") : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Votações procedurais — Câmara */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>
            Votações procedurais — Câmara
            <span className="ml-2 font-normal text-xs" style={{ color: "var(--text-dim)" }}>
              (requerimentos de urgência, alterações de regime)
            </span>
          </h2>
        </div>
        <div style={{ background: "var(--surface-deep)" }}>
          {procedurais.map((v, i) => (
            <div key={v.id} className="px-5 py-3 row-hover"
              style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <Link href={`/proposicoes/${v.prop_id}`}
                      className="font-mono font-semibold text-xs hover:underline"
                      style={{ color: "var(--yellow)" }}>
                      {v.tipo} {v.numero}/{v.ano}
                    </Link>
                    {v.sigla_orgao && (
                      <span className="text-xs font-semibold" style={{ color: "var(--primary)" }}>{v.sigla_orgao}</span>
                    )}
                    <ResultadoBadge aprovacao={v.aprovacao} />
                    {v.alinhamento && <Badge value={v.alinhamento} />}
                  </div>
                  {v.descricao && (
                    <p className="text-xs line-clamp-1" style={{ color: "var(--text-muted)" }}>{v.descricao}</p>
                  )}
                </div>
                <span className="text-xs shrink-0" style={{ color: "var(--text-dim)" }}>
                  {v.data ? new Date(v.data).toLocaleDateString("pt-BR") : "—"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
