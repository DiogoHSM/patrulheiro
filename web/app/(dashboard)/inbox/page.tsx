import { query, queryOne } from "@/lib/db"
import Link from "next/link"
import { markAllRead } from "@/app/actions/monitoramentos"
import { markAlertasRead } from "@/app/actions/monitoramentos"

async function getAlertasDou() {
  return query<{
    id: string; tipo: string; titulo: string; descricao: string
    severidade: string; lida: boolean; created_at: string; source_id: string
  }>(`
    SELECT id, tipo, titulo, descricao, severidade, lida, created_at, source_id::text
    FROM alertas
    WHERE source_type = 'dou'
    ORDER BY created_at DESC
    LIMIT 50
  `)
}

async function getNotificacoes() {
  return query<{
    id: string; proposicao_id: string; tipo: string
    titulo: string; descricao: string; lida: boolean; created_at: string
    tipo_prop: string; numero: number; ano: number
  }>(`
    SELECT n.id, n.proposicao_id, n.tipo, n.titulo, n.descricao, n.lida, n.created_at,
           p.tipo AS tipo_prop, p.numero, p.ano
    FROM notificacoes n
    JOIN proposicoes p ON p.id = n.proposicao_id
    ORDER BY n.created_at DESC
    LIMIT 100
  `)
}

async function getMonitoramentos() {
  return query<{
    proposicao_id: string; tipo: string; numero: number; ano: number
    ementa: string; alinhamento: string; created_at: string
  }>(`
    SELECT m.proposicao_id, p.tipo, p.numero, p.ano, LEFT(p.ementa, 100) AS ementa,
           p.alinhamento, m.created_at
    FROM monitoramentos m
    JOIN proposicoes p ON p.id = m.proposicao_id
    ORDER BY m.created_at DESC
  `)
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h atrás`
  return `${Math.floor(hrs / 24)}d atrás`
}

export default async function InboxPage() {
  const [notificacoes, monitoramentos, alertasDou] = await Promise.all([
    getNotificacoes(),
    getMonitoramentos(),
    getAlertasDou(),
  ])

  const naoLidas = notificacoes.filter(n => !n.lida).length
  const alertasNaoLidos = alertasDou.filter(a => !a.lida).length

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Notificações</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {(naoLidas + alertasNaoLidos) > 0
              ? `${naoLidas + alertasNaoLidos} não lida${(naoLidas + alertasNaoLidos) > 1 ? "s" : ""}`
              : "Tudo em dia"}
          </p>
        </div>
        {naoLidas > 0 && (
          <form action={markAllRead}>
            <button
              type="submit"
              className="text-sm px-4 py-2 rounded-lg cursor-pointer transition-opacity hover:opacity-80"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              Marcar todas como lidas
            </button>
          </form>
        )}
      </div>

      {/* Notificações */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Atualizações recentes</h2>
        </div>
        <div style={{ background: "var(--surface-deep)" }}>
          {notificacoes.length === 0 ? (
            <p className="px-5 py-10 text-sm text-center" style={{ color: "var(--text-dim)" }}>
              Nenhuma notificação ainda. Monitore proposições para receber atualizações.
            </p>
          ) : notificacoes.map((n, i) => (
            <div
              key={n.id}
              className="px-5 py-3"
              style={{
                borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                background: n.lida ? undefined : "color-mix(in srgb, var(--primary) 5%, transparent)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    {!n.lida && (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--primary)" }} />
                    )}
                    <Link
                      href={`/proposicoes/${n.proposicao_id}`}
                      className="font-mono font-semibold text-xs hover:underline"
                      style={{ color: "var(--yellow)" }}
                    >
                      {n.tipo_prop} {n.numero}/{n.ano}
                    </Link>
                  </div>
                  <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{n.titulo}</p>
                  {n.descricao && (
                    <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>{n.descricao}</p>
                  )}
                </div>
                <span className="text-xs shrink-0 mt-0.5" style={{ color: "var(--text-dim)" }}>
                  {timeAgo(n.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas DOU */}
      {alertasDou.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
            <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>
              Alertas — Diário Oficial {alertasNaoLidos > 0 && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full" style={{ background: "var(--red)", color: "#fff" }}>{alertasNaoLidos}</span>}
            </h2>
            {alertasNaoLidos > 0 && (
              <form action={markAlertasRead}>
                <button type="submit" className="text-xs cursor-pointer hover:opacity-80" style={{ color: "var(--text-dim)" }}>
                  Marcar lidos
                </button>
              </form>
            )}
          </div>
          <div style={{ background: "var(--surface-deep)" }}>
            {alertasDou.map((a, i) => (
              <div
                key={a.id}
                className="px-5 py-3"
                style={{
                  borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                  background: a.lida ? undefined : "color-mix(in srgb, var(--red) 5%, transparent)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      {!a.lida && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--red)" }} />}
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: a.severidade === "critica" ? "var(--red)" : "color-mix(in srgb, var(--red) 50%, transparent)",
                          color: "#fff",
                        }}
                      >
                        {a.severidade}
                      </span>
                    </div>
                    <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{a.titulo}</p>
                    {a.descricao && (
                      <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>{a.descricao}</p>
                    )}
                  </div>
                  <span className="text-xs shrink-0 mt-0.5" style={{ color: "var(--text-dim)" }}>
                    {timeAgo(a.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monitoramentos */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>
            Proposições monitoradas ({monitoramentos.length})
          </h2>
        </div>
        <div style={{ background: "var(--surface-deep)" }}>
          {monitoramentos.length === 0 ? (
            <p className="px-5 py-8 text-sm text-center" style={{ color: "var(--text-dim)" }}>
              Nenhuma proposição monitorada. Abra uma proposição e clique em "Monitorar".
            </p>
          ) : monitoramentos.map((m, i) => (
            <div
              key={m.proposicao_id}
              className="px-5 py-3 flex items-center justify-between gap-3"
              style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/proposicoes/${m.proposicao_id}`}
                  className="font-mono font-semibold text-xs hover:underline"
                  style={{ color: "var(--yellow)" }}
                >
                  {m.tipo} {m.numero}/{m.ano}
                </Link>
                <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--text-muted)" }}>{m.ementa}</p>
              </div>
              <span className="text-xs shrink-0" style={{ color: "var(--text-dim)" }}>
                desde {new Date(m.created_at).toLocaleDateString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
