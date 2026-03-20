import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { Sidebar } from "@/components/sidebar"
import { queryOne, query } from "@/lib/db"
import { StatusWidget, TaskStatus } from "@/components/status-widget"

function fmtDate(d: Date | null): string {
  if (!d) return "?"
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

async function getIngestionStatus(): Promise<TaskStatus[]> {
  const [camara, senado, enrich, votacoes, ranges] = await Promise.all([
    query<{ processadas: string; total: string }>(`
      SELECT COUNT(*) FILTER (WHERE processado = TRUE)::text AS processadas,
             COUNT(*)::text AS total
      FROM proposicoes WHERE fonte = 'camara'
    `),
    query<{ processadas: string; total: string }>(`
      SELECT COUNT(*) FILTER (WHERE processado = TRUE)::text AS processadas,
             COUNT(*)::text AS total
      FROM proposicoes WHERE fonte = 'senado'
    `),
    query<{ enriquecidas: string; total: string }>(`
      SELECT COUNT(*) FILTER (WHERE orgao_atual IS NOT NULL OR regime IS NOT NULL)::text AS enriquecidas,
             COUNT(*)::text AS total
      FROM proposicoes WHERE fonte = 'camara'
    `),
    queryOne<{ status: string; error: string | null }>(
      "SELECT status, error_message AS error FROM sync_control WHERE fonte = 'senado_votacoes'"
    ),
    query<{ fonte: string; min_data: Date | null; max_data: Date | null }>(`
      SELECT fonte,
             MIN(data_apresentacao) AS min_data,
             MAX(data_apresentacao) AS max_data
      FROM proposicoes
      WHERE data_apresentacao IS NOT NULL
      GROUP BY fonte
    `),
  ])

  const rangeMap = Object.fromEntries(ranges.map(r => [r.fonte, r]))

  function dateRange(fonte: string): string | undefined {
    const r = rangeMap[fonte]
    if (!r) return undefined
    return `${fmtDate(r.min_data)} – ${fmtDate(r.max_data)}`
  }

  function toTask(label: string, done: number, total: number, sub?: string, error?: boolean): TaskStatus {
    if (total === 0) return { label, pct: 0, status: "pending", sub }
    if (error) return { label, pct: Math.floor((done / total) * 100), status: "failed", sub }
    const pct = Math.floor((done / total) * 100)
    return { label, pct, status: pct >= 100 ? "done" : "loading", sub }
  }

  const camaraTotal = Number(camara[0]?.total ?? 0)
  const senadoTotal = Number(senado[0]?.total ?? 0)
  const enrichTotal = Number(enrich[0]?.total ?? 0)

  return [
    toTask("Câmara — Classificação", Number(camara[0]?.processadas ?? 0), camaraTotal, dateRange("camara")),
    toTask("Senado — Classificação", Number(senado[0]?.processadas ?? 0), senadoTotal, dateRange("senado")),
    toTask("Enriquecimento Câmara", Number(enrich[0]?.enriquecidas ?? 0), enrichTotal),
    {
      label: "Votações Senado",
      pct: 100,
      status: votacoes?.status === "success" ? "done" : votacoes?.error ? "failed" : "pending",
    },
  ]
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ok = await getSession()
  if (!ok) redirect("/login")

  const [row, tasks] = await Promise.all([
    queryOne<{ count: string }>("SELECT COUNT(*)::text AS count FROM notificacoes WHERE lida = FALSE"),
    getIngestionStatus(),
  ])
  const unreadCount = Number(row?.count ?? 0)

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <Sidebar unreadCount={unreadCount} />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0 relative" style={{ background: "var(--bg)" }}>
        <StatusWidget tasks={tasks} />
        {children}
      </main>
    </div>
  )
}
