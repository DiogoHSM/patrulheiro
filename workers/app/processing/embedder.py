import json
from openai import AsyncOpenAI
from app.config import settings
from app.db import get_pool, insert_embedding

_client = AsyncOpenAI(api_key=settings.openai_api_key)

EMBEDDING_MODEL = "text-embedding-3-small"
CHUNK_SIZE = 1800   # chars (~450 tokens) com margem de segurança
CHUNK_OVERLAP = 200


def _chunk_text(text: str) -> list[str]:
    if len(text) <= CHUNK_SIZE:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


async def _embed(text: str) -> list[float]:
    resp = await _client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
    )
    return resp.data[0].embedding


async def embed_dou_ato(ato_id: str):
    """Gera embeddings para um ato do DOU e persiste na tabela embeddings."""
    pool = await get_pool()
    ato = await pool.fetchrow(
        "SELECT titulo, orgao, tipo_ato, resumo_executivo, texto_completo, "
        "       alinhamento, temas_primarios, edicao "
        "FROM dou_atos WHERE id = $1",
        ato_id,
    )
    if not ato:
        return

    # Texto base: título + órgão + resumo (sempre disponível após classificação)
    base = " | ".join(filter(None, [
        ato["tipo_ato"], ato["orgao"], ato["titulo"], ato["resumo_executivo"]
    ]))

    # Se há texto completo, chunka; senão usa apenas o base
    texto_completo = ato["texto_completo"] or ""
    chunks = _chunk_text(texto_completo) if texto_completo else [base]

    metadata = {
        "source_type": "dou",
        "tipo_ato": ato["tipo_ato"],
        "orgao": ato["orgao"],
        "edicao": ato["edicao"],
        "alinhamento": ato["alinhamento"],
        "temas_primarios": ato["temas_primarios"] or [],
    }

    for i, chunk in enumerate(chunks):
        content = chunk if i > 0 else base + ("\n\n" + chunk if chunk != base else "")
        embedding = await _embed(content)
        await insert_embedding({
            "source_type": "dou",
            "source_id": ato_id,
            "chunk_index": i,
            "content": content,
            "embedding": embedding,
            "metadata": json.dumps(metadata),
        })
