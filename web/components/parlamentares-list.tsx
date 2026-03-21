"use client"
import { useState } from "react"
import Link from "next/link"
import { Photo, PartidoLogo } from "@/components/photo"

export interface Parlamentar {
  fonte_id: string; nome: string; partido: string; uf: string
  total: string; favoraveis: string; contrarias: string; pendentes: string
}

export interface AlinhamentoVoto {
  fonte_id: string; total_votos: string; votos_alinhados: string
}

interface Props {
  parlamentares: Parlamentar[]
  alinhamentoVotos?: Record<string, AlinhamentoVoto>
  linkBase: string
  memberLabel: string
  memberLabelPlural: string
  fonte: "camara" | "senado"
}

const PARTIDO_CORES: Record<string, string> = {
  PL: "#004f9f", PT: "#cc0000", UNIÃO: "#e87722", PSD: "#005ba1",
  MDB: "#009c3b", REPUBLICANOS: "#1e3a6e", PP: "#0066cc", PODEMOS: "#00aaff",
  PSDB: "#0060a8", NOVO: "#f58220", PSB: "#ff6600", PDT: "#0077b6", PRD: "#003580",
}

function alinhamentoPct(fav: number, cont: number): number | null {
  const total = fav + cont
  return total >= 2 ? Math.round((fav / total) * 100) : null
}

const selectStyle = {
  background: "var(--surface-deep)",
  border: "1px solid var(--border)",
  color: "var(--text)",
}

function fotoUrl(fonte: "camara" | "senado", fonteId: string) {
  return fonte === "camara"
    ? `https://www.camara.leg.br/internet/deputado/bandep/${fonteId}.jpg`
    : `https://www.senado.leg.br/senadores/img/fotos-oficiais/senador${fonteId}.jpg`
}

export function ParlamentaresList({ parlamentares, alinhamentoVotos, linkBase, memberLabel, memberLabelPlural, fonte }: Props) {
  const [sort, setSort] = useState("alinhamento")
  const [order, setOrder] = useState<"asc" | "desc">("desc")
  const [partido, setPartido] = useState<string | null>(null)

  const partidos = [...new Set(parlamentares.map(p => p.partido).filter(Boolean))]
    .map(pt => {
      const membros = parlamentares.filter(p => p.partido === pt)
      const totalFav = membros.reduce((acc, p) => acc + Number(p.favoraveis), 0)
      const totalCont = membros.reduce((acc, p) => acc + Number(p.contrarias), 0)
      return { partido: pt, membros, pctAlinhamento: alinhamentoPct(totalFav, totalCont), contrarias: totalCont }
    })
    .sort((a, b) => (b.pctAlinhamento ?? -1) - (a.pctAlinhamento ?? -1))

  const filtered = partido ? parlamentares.filter(p => p.partido === partido) : parlamentares

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

  return (
    <div className="space-y-6">
      {/* Partido cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {partidos.map(({ partido: pt, membros, pctAlinhamento, contrarias }) => {
          const ativo = pt === partido
          return (
            <button key={pt} type="button" onClick={() => setPartido(ativo ? null : pt)}
              className="rounded-xl p-4 text-left transition-all cursor-pointer"
              style={{
                background: ativo ? "var(--primary)" : "var(--surface)",
                border: `1px solid ${ativo ? "var(--primary)" : "var(--border)"}`,
              }}>
              <div className="flex items-center gap-2 mb-2">
                {!ativo && <PartidoLogo sigla={pt} size={24} />}
                {ativo && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#fff" }} />}
                <span className="font-bold text-sm" style={{ color: ativo ? "#fff" : "var(--text)" }}>{pt}</span>
              </div>
              <p className="text-xs" style={{ color: ativo ? "rgba(255,255,255,0.75)" : "var(--text-muted)" }}>
                {membros.length} {membros.length === 1 ? memberLabel : memberLabelPlural}
              </p>
              {pctAlinhamento !== null && (
                <p className="text-xs mt-0.5 font-semibold" style={{
                  color: ativo ? "#fff" : (pctAlinhamento >= 60 ? "var(--green)" : pctAlinhamento <= 30 ? "var(--red)" : "var(--yellow)")
                }}>{pctAlinhamento}% alinhado</p>
              )}
              {contrarias > 0 && (
                <p className="text-xs mt-0.5" style={{ color: ativo ? "rgba(255,255,255,0.6)" : "var(--text-dim)" }}>
                  {contrarias} contrária{contrarias !== 1 ? "s" : ""}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* Lista */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-4 flex items-center gap-4 flex-wrap"
          style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>
              {partido ? `${sorted.length} de ${parlamentares.length}` : `Todos (${parlamentares.length})`}
            </h2>
            {partido && (
              <button type="button" onClick={() => setPartido(null)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer"
                style={{ background: "var(--primary)", color: "#fff" }}>
                {partido} ✕
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {(["alinhamento", "nome", "total"] as const).map(opt => (
              <button key={opt} type="button" onClick={() => { setSort(opt); setOrder(opt === "nome" ? "asc" : "desc") }}
                className="px-2 py-1 rounded-lg text-xs cursor-pointer"
                style={{
                  ...selectStyle,
                  background: sort === opt ? "var(--primary)" : selectStyle.background,
                  color: sort === opt ? "#fff" : selectStyle.color,
                  border: sort === opt ? "1px solid var(--primary)" : selectStyle.border,
                }}>
                {opt === "alinhamento" ? "Alinhamento" : opt === "nome" ? "Nome" : "Qtd."}
              </button>
            ))}
            <button type="button" onClick={() => setOrder(o => o === "desc" ? "asc" : "desc")}
              className="px-2 py-1 rounded-lg text-xs cursor-pointer ml-1" style={selectStyle}>
              {order === "desc" ? "↓ Desc" : "↑ Asc"}
            </button>
          </div>
        </div>

        <div key={`${partido ?? "all"}-${sort}-${order}`} style={{ background: "var(--surface-deep)" }}>
          {sorted.map((p, i) => {
            const total = Number(p.total)
            const contrarias = Number(p.contrarias)
            const favoraveis = Number(p.favoraveis)
            const pendentes = Number(p.pendentes)
            const pctAlin = alinhamentoPct(favoraveis, contrarias)
            const voto = alinhamentoVotos?.[p.fonte_id]
            const pctVoto = voto
              ? Math.round((Number(voto.votos_alinhados) / Number(voto.total_votos)) * 100)
              : null

            return (
              <div key={p.fonte_id} className="px-5 py-3 row-hover"
                style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Photo src={fotoUrl(fonte, p.fonte_id)} nome={p.nome} size={32} />
                    <div className="min-w-0">
                      <Link href={`${linkBase}/${p.fonte_id}`}
                        className="font-medium text-sm hover:underline"
                        style={{ color: "var(--text)" }}>
                        {p.nome}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-semibold"
                          style={{ color: PARTIDO_CORES[p.partido] ?? "var(--text-dim)" }}>{p.partido}</span>
                        {p.uf && <span className="text-xs" style={{ color: "var(--text-dim)" }}>{p.uf}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs">
                    <span style={{ color: "var(--text-dim)" }}>{total} prop.</span>
                    {favoraveis > 0 && <span className="font-semibold" style={{ color: "var(--green)" }}>+{favoraveis}</span>}
                    {contrarias > 0 && <span className="font-semibold" style={{ color: "var(--red)" }}>−{contrarias}</span>}
                    {pendentes > 0 && <span style={{ color: "var(--text-dim)" }}>⏳{pendentes}</span>}
                    {pctAlin !== null && (
                      <span className="px-1.5 py-0.5 rounded font-semibold"
                        style={{
                          background: pctAlin >= 60
                            ? "color-mix(in srgb, var(--green) 15%, transparent)"
                            : pctAlin <= 30
                              ? "color-mix(in srgb, var(--red) 15%, transparent)"
                              : "color-mix(in srgb, var(--yellow) 15%, transparent)",
                          color: pctAlin >= 60 ? "var(--green)" : pctAlin <= 30 ? "var(--red)" : "var(--yellow)",
                        }}>
                        {pctAlin}%
                      </span>
                    )}
                    {pctVoto !== null && (
                      <span className="px-1.5 py-0.5 rounded font-semibold hidden sm:inline"
                        style={{
                          background: pctVoto >= 70
                            ? "color-mix(in srgb, var(--green) 15%, transparent)"
                            : pctVoto <= 40
                              ? "color-mix(in srgb, var(--red) 15%, transparent)"
                              : "color-mix(in srgb, var(--yellow) 15%, transparent)",
                          color: pctVoto >= 70 ? "var(--green)" : pctVoto <= 40 ? "var(--red)" : "var(--yellow)",
                        }}>
                        {pctVoto}% votos
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
