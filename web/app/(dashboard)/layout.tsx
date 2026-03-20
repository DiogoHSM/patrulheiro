import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { Sidebar } from "@/components/sidebar"
import { queryOne, query } from "@/lib/db"
import { StatusWidget, TaskStatus } from "@/components/status-widget"

async function getIngestionStatus(): Promise<TaskStatus[]> {
  const [camara, senado, enrich, votacoes] = await Promise.all([
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
  ])

  function toTask(label: string, done: number, total: number, error?: boolean): TaskStatus {
    if (total === 0) return { label, pct: 0, status: "pending" }
    if (error) return { label, pct: Math.floor((done / total) * 100), status: "failed" }
    const pct = Math.floor((done / total) * 100)
    return { label, pct, status: pct >= 100 ? "done" : "loading" }
  }

  const camaraTotal = Number(camara[0]?.total ?? 0)
  const senadoTotal = Number(senado[0]?.total ?? 0)
  const enrichTotal = Number(enrich[0]?.total ?? 0)

  return [
    toTask("Câmara — Classificação", Number(camara[0]?.processadas ?? 0), camaraTotal),
    toTask("Senado — Classificação", Number(senado[0]?.processadas ?? 0), senadoTotal),
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
      <main className="flex-1 overflow-y-auto pt-16 md:pt-0 relative" style={{ background: "var(--bg)" }}>
        <StatusWidget tasks={tasks} />
        {children}
      </main>
    </div>
  )
}
