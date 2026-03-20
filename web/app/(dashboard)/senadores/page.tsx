import { query } from "@/lib/db"
import { ParlamentaresList } from "@/components/parlamentares-list"

async function getSenadores() {
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
    WHERE p.fonte = 'senado'
      AND a.fonte_id IS NOT NULL AND a.fonte_id != ''
    GROUP BY a.fonte_id, a.nome, a.partido, a.uf
    ORDER BY COUNT(DISTINCT p.id) DESC
  `)
}

async function getAlinhamentoVotos() {
  const rows = await query<{ fonte_id: string; total_votos: string; votos_alinhados: string }>(`
    SELECT
      v.deputado_id AS fonte_id,
      COUNT(*)::text AS total_votos,
      COUNT(*) FILTER (WHERE
        (UPPER(vt.orientacao_pl) = 'SIM' AND v.tipo_voto = 'Sim') OR
        (UPPER(vt.orientacao_pl) IN ('NÃO','NAO','CONTRÁRIO','CONTRARIO') AND v.tipo_voto = 'Não')
      )::text AS votos_alinhados
    FROM votos v
    JOIN votacoes vt ON vt.id = v.votacao_id
    WHERE vt.orientacao_pl IS NOT NULL
      AND UPPER(vt.orientacao_pl) NOT IN ('LIBERADO','LIBERAL')
      AND vt.fonte = 'senado'
    GROUP BY v.deputado_id
    HAVING COUNT(*) >= 3
  `)
  return Object.fromEntries(rows.map(r => [r.fonte_id, r]))
}


export default async function SenadoresPage() {
  const [senadores, alinhamentoVotos] = await Promise.all([getSenadores(), getAlinhamentoVotos()])

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Senadores</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {senadores.length} senadores com proposições monitoradas
        </p>
      </div>

      <ParlamentaresList
        parlamentares={senadores}
        alinhamentoVotos={alinhamentoVotos}
        linkBase="/senadores"
        memberLabel="senador"
        memberLabelPlural="senadores"
      />
    </div>
  )
}
