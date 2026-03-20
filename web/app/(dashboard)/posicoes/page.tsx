import { query } from "@/lib/db"

export default async function PosicoesPage() {
  const posicoes = await query<{ id: string; eixo: string; posicao: string; ativa: boolean }>(
    `SELECT id, eixo, posicao, ativa FROM posicoes_partido ORDER BY eixo, posicao`
  )

  const byEixo = posicoes.reduce<Record<string, typeof posicoes>>((acc, p) => {
    ;(acc[p.eixo] ??= []).push(p)
    return acc
  }, {})

  return (
    <div className="p-4 md:p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Posições do Partido</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Base ideológica usada pela IA para classificar o alinhamento das proposições
        </p>
      </div>

      <div className="space-y-4">
        {Object.entries(byEixo).map(([eixo, items]) => (
          <div key={eixo} className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            <div className="px-5 py-3" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
              <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>{eixo}</h2>
            </div>
            <div style={{ background: "var(--surface-deep)" }}>
              {items.map((p, i) => (
                <div key={p.id} className="px-5 py-3 flex items-center gap-3"
                  style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                  <span style={{ color: p.ativa ? "var(--green)" : "var(--text-dim)" }}>
                    {p.ativa ? "●" : "○"}
                  </span>
                  <span className="text-sm" style={{
                    color: p.ativa ? "var(--text-muted)" : "var(--text-dim)",
                    textDecoration: p.ativa ? "none" : "line-through"
                  }}>
                    {p.posicao}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        Para adicionar ou editar posições, use a tabela <code style={{ color: "var(--text-muted)" }}>posicoes_partido</code> no banco de dados.
      </p>
    </div>
  )
}
