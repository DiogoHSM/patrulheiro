import asyncpg
from app.config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=10)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_last_sync(fonte: str) -> str | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT last_sync FROM sync_control WHERE fonte = $1", fonte
    )
    return row["last_sync"].isoformat() if row else None


async def set_last_sync(fonte: str, status: str = "success", records: int = 0, error: str = None):
    pool = await get_pool()
    await pool.execute("""
        INSERT INTO sync_control (fonte, last_sync, status, records_synced, error_message, updated_at)
        VALUES ($1, NOW(), $2, $3, $4, NOW())
        ON CONFLICT (fonte) DO UPDATE SET
            last_sync = NOW(),
            status = $2,
            records_synced = $3,
            error_message = $4,
            updated_at = NOW()
    """, fonte, status, records, error)


async def proposicao_exists(fonte: str, tipo: str, numero: int, ano: int) -> str | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id FROM proposicoes WHERE fonte = $1 AND tipo = $2 AND numero = $3 AND ano = $4",
        fonte, tipo, numero, ano
    )
    return str(row["id"]) if row else None


async def insert_proposicao(data: dict) -> str:
    pool = await get_pool()
    row = await pool.fetchrow("""
        INSERT INTO proposicoes (
            fonte, fonte_id, tipo, numero, ano, ementa,
            url_tramitacao, url_inteiro_teor, storage_path,
            data_apresentacao, situacao, regime, orgao_atual
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        ON CONFLICT (fonte, tipo, numero, ano) DO UPDATE SET
            situacao = EXCLUDED.situacao,
            orgao_atual = EXCLUDED.orgao_atual,
            updated_at = NOW()
        RETURNING id
    """,
        data["fonte"], data["fonte_id"], data["tipo"], data["numero"],
        data["ano"], data["ementa"], data.get("url_tramitacao"),
        data.get("url_inteiro_teor"), data.get("storage_path"),
        data.get("data_apresentacao"), data.get("situacao"),
        data.get("regime"), data.get("orgao_atual")
    )
    return str(row["id"])


async def update_classificacao(proposicao_id: str, data: dict):
    pool = await get_pool()
    await pool.execute("""
        UPDATE proposicoes SET
            temas_primarios = $2,
            temas_secundarios = $3,
            entidades_citadas = $4,
            resumo_executivo = $5,
            impacto_estimado = $6,
            urgencia_ia = $7,
            updated_at = NOW()
        WHERE id = $1
    """,
        proposicao_id,
        data.get("temas_primarios", []),
        data.get("temas_secundarios", []),
        data.get("entidades_citadas", []),
        data.get("resumo_executivo"),
        {"mediano": "medio", "médio": "medio", "medio": "medio", "alta": "alto", "baixa": "baixo",
         "meio": "medio", "m medio": "medio", "m alto": "alto", "m baixo": "baixo"}.get(
            (data.get("impacto_estimado") or "").lower().strip(), data.get("impacto_estimado")
        ),
        {"alto": "alta", "baixo": "baixa", "mediano": "media", "médio": "media", "medio": "media",
         "média": "media", "media": "media", "baja": "baixa", "bajo": "baixa", "alto": "alta"}.get(
            (data.get("urgencia_ia") or "").lower().strip(), data.get("urgencia_ia")
        )
    )


async def update_alinhamento(proposicao_id: str, data: dict):
    pool = await get_pool()
    await pool.execute("""
        UPDATE proposicoes SET
            alinhamento = $2,
            alinhamento_score = $3,
            alinhamento_just = $4,
            risco_politico = $5,
            recomendacao = $6,
            processado = TRUE,
            updated_at = NOW()
        WHERE id = $1
    """,
        proposicao_id,
        {
            "contra": "contrario", "contrario": "contrario", "contrário": "contrario",
            "constrario": "contrario", "contario": "contrario", "contral": "contrario",
            "contrasario": "contrario", "contraro": "contrario",
            "favor": "favoravel", "favoravel": "favoravel", "favorável": "favoravel",
            "neutro": "neutro", "neutral": "neutro",
            "ambiguo": "ambiguo", "ambíguo": "ambiguo",
            "parcialmente favoravel": "ambiguo", "parcialmente contrario": "ambiguo",
        }.get((data.get("alinhamento") or "").lower().strip(), data.get("alinhamento")),
        min(float(data.get("confianca") or 0), 1.0),
        data.get("justificativa"),
        {"médio": "medio", "mediano": "medio", "medio": "medio", "alta": "alto", "baixa": "baixo"}.get(
            (data.get("risco_politico") or "").lower().strip(), data.get("risco_politico")
        ),
        data.get("recomendacao")
    )


async def insert_autores(proposicao_id: str, autores: list[dict]):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM proposicao_autores WHERE proposicao_id = $1",
        proposicao_id
    )
    for autor in autores:
        await pool.execute("""
            INSERT INTO proposicao_autores (proposicao_id, nome, partido, uf, fonte_id, tipo_autoria, url_perfil)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
            proposicao_id, autor.get("nome"), autor.get("partido"),
            autor.get("uf"), autor.get("fonte_id"), autor.get("tipo_autoria", "autor"),
            autor.get("url_perfil")
        )


async def insert_tramitacoes(proposicao_id: str, tramitacoes: list[dict]):
    pool = await get_pool()
    for t in tramitacoes:
        await pool.execute("""
            INSERT INTO tramitacoes (proposicao_id, data, descricao, orgao, situacao, url, fonte_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (proposicao_id, fonte_id) DO NOTHING
        """,
            proposicao_id, t.get("data"), t.get("descricao"),
            t.get("orgao"), t.get("situacao"), t.get("url"), t.get("fonte_id")
        )


async def get_posicoes_partido() -> str:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT eixo, posicao FROM posicoes_partido WHERE ativa = TRUE ORDER BY eixo"
    )
    if not rows:
        return ""
    eixos: dict[str, list] = {}
    for row in rows:
        eixos.setdefault(row["eixo"], []).append(row["posicao"])
    lines = []
    for eixo, posicoes in eixos.items():
        lines.append(f"\n{eixo}:")
        for p in posicoes:
            lines.append(f"  - {p}")
    return "\n".join(lines)


async def get_proposicoes_sem_processar(limite: int = 50) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT id, tipo, numero, ano, ementa, resumo_executivo, temas_primarios
        FROM proposicoes
        WHERE processado = FALSE
        ORDER BY created_at ASC
        LIMIT $1
    """, limite)
    return [dict(r) for r in rows]
