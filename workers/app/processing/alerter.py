from app.db import get_pool, insert_alerta


async def check_dou_alerts(ato_id: str):
    """
    Verifica se um ato do DOU processado merece gerar um alerta.
    Regras:
      - contrario + score >= 0.7           → severidade 'critica'
      - contrario + score < 0.7            → severidade 'alta'
      - ambiguo + impacto_estimado = 'alto' → severidade 'alta'
    """
    pool = await get_pool()
    ato = await pool.fetchrow("""
        SELECT id, tipo_ato, orgao, titulo, resumo_executivo,
               alinhamento, alinhamento_score, impacto_estimado
        FROM dou_atos WHERE id = $1
    """, ato_id)

    if not ato:
        return

    alinhamento = ato["alinhamento"]
    score = float(ato["alinhamento_score"] or 0)
    impacto = ato["impacto_estimado"]

    severidade = None
    if alinhamento == "contrario":
        severidade = "critica" if score >= 0.7 else "alta"
    elif alinhamento == "ambiguo" and impacto == "alto":
        severidade = "alta"

    if not severidade:
        return

    orgao = ato["orgao"] or ""
    tipo = ato["tipo_ato"] or "Ato"
    titulo = (ato["titulo"] or "")[:120]

    await insert_alerta({
        "tipo": "dou_relevante",
        "titulo": f"DOU — {tipo}: {orgao}" if orgao else f"DOU — {titulo}",
        "descricao": ato["resumo_executivo"] or titulo,
        "source_type": "dou",
        "source_id": ato_id,
        "severidade": severidade,
    })
    print(f"[alerter] ⚠ Alerta {severidade}: {tipo} — {orgao}")
