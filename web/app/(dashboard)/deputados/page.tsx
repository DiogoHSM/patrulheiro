import { query } from "@/lib/db"
import { ParlamentaresList } from "@/components/parlamentares-list"

async function getDeputados() {
  return query<{
    fonte_id: string; nome: string; partido: string; uf: string
    total: string; favoraveis: string; contrarias: string; pendentes: string
  }>(`
    SELECT
      a.fonte_id,
      a.nome,
      a.partido,
      a.uf,
      COUNT(DISTINCT p.id)::text                                             AS total,
      COUNT(DISTINCT p.id) FILTER (WHERE p.alinhamento = 'favoravel')::text AS favoraveis,
      COUNT(DISTINCT p.id) FILTER (WHERE p.alinhamento = 'contrario')::text AS contrarias,
      COUNT(DISTINCT p.id) FILTER (WHERE p.processado = FALSE)::text        AS pendentes
    FROM proposicao_autores a
    JOIN proposicoes p ON p.id = a.proposicao_id
    WHERE p.fonte = 'camara'
      AND a.fonte_id IS NOT NULL AND a.fonte_id != ''
    GROUP BY a.fonte_id, a.nome, a.partido, a.uf
    ORDER BY COUNT(DISTINCT p.id) DESC
  `)
}

export default async function DeputadosPage() {
  const deputados = await getDeputados()

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Deputados</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {deputados.length} deputados com proposições monitoradas
        </p>
      </div>

      <ParlamentaresList
        parlamentares={deputados}
        linkBase="/deputados"
        memberLabel="dep."
        memberLabelPlural="dep."
        fonte="camara"
      />
    </div>
  )
}
