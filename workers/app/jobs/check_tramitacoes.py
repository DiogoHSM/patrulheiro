"""
Job: verifica novas tramitações para proposições monitoradas
e cria notificações para cada nova tramitação encontrada.
"""
from app.db import get_pool


async def check_tramitacoes_monitoradas() -> dict:
    pool = await get_pool()

    # Busca proposições monitoradas com suas tramitações mais recentes
    monitoradas = await pool.fetch("""
        SELECT
            m.proposicao_id,
            p.tipo, p.numero, p.ano,
            COALESCE(
                (SELECT MAX(n.created_at) FROM notificacoes n WHERE n.proposicao_id = m.proposicao_id),
                m.created_at
            ) AS ultima_notificacao
        FROM monitoramentos m
        JOIN proposicoes p ON p.id = m.proposicao_id
    """)

    if not monitoradas:
        print("[check-tramitacoes] Nenhuma proposição monitorada")
        return {"criadas": 0}

    criadas = 0

    for row in monitoradas:
        prop_id = str(row["proposicao_id"])
        ultima = row["ultima_notificacao"]

        # Tramitações inseridas após a última notificação
        novas = await pool.fetch("""
            SELECT descricao, orgao, data
            FROM tramitacoes
            WHERE proposicao_id = $1
              AND created_at > $2
            ORDER BY data DESC
        """, row["proposicao_id"], ultima)

        for t in novas:
            orgao_prefix = f"[{t['orgao']}] " if t["orgao"] else ""
            titulo = f"{row['tipo']} {row['numero']}/{row['ano']} — Nova tramitação"
            descricao = f"{orgao_prefix}{t['descricao']}"

            await pool.execute("""
                INSERT INTO notificacoes (proposicao_id, tipo, titulo, descricao)
                VALUES ($1, 'tramitacao', $2, $3)
            """, row["proposicao_id"], titulo, descricao[:500])

            criadas += 1

    print(f"[check-tramitacoes] {criadas} notificacoes criadas para {len(monitoradas)} proposições monitoradas")
    return {"criadas": criadas, "monitoradas": len(monitoradas)}
