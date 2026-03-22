"""
Backfill de partido e flag em_exercicio para autores da Câmara sem partido.

Para cada autor com fonte_id preenchido e partido NULL/vazio em proposições da Câmara,
busca GET /deputados/{id} e extrai:
  - ultimoStatus.siglaPartido → partido
  - ultimoStatus.situacao     → em_exercicio (TRUE se "Exercício")
"""
import asyncio
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import get_pool

BASE_URL = "https://dadosabertos.camara.leg.br/api/v2"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str) -> dict:
    resp = await client.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


async def enrich_camara_autores() -> dict:
    pool = await get_pool()

    # IDs únicos de deputados sem partido em proposições da Câmara
    rows = await pool.fetch("""
        SELECT DISTINCT fonte_id
        FROM proposicao_autores
        WHERE (partido IS NULL OR partido = '')
          AND fonte_id IS NOT NULL
          AND fonte_id <> ''
          AND proposicao_id IN (SELECT id FROM proposicoes WHERE fonte = 'camara')
    """)

    deputado_ids = [r["fonte_id"] for r in rows]
    total = len(deputado_ids)
    print(f"[camara-autores] {total} deputados sem partido para enriquecer")

    ok = erros = atualizados = 0

    async with httpx.AsyncClient() as client:
        for i, dep_id in enumerate(deputado_ids):
            try:
                data = await _get(client, f"{BASE_URL}/deputados/{dep_id}")
                dados = data.get("dados", {})
                ultimo = dados.get("ultimoStatus", {})

                partido = ultimo.get("siglaPartido") or None
                situacao = (ultimo.get("situacao") or "").strip()
                em_exercicio = situacao.lower() == "exercício" or situacao.lower() == "exercicio"

                result = await pool.execute("""
                    UPDATE proposicao_autores SET
                        partido      = COALESCE($2, partido),
                        em_exercicio = $3
                    WHERE fonte_id = $1
                      AND (partido IS NULL OR partido = '')
                      AND proposicao_id IN (SELECT id FROM proposicoes WHERE fonte = 'camara')
                """, dep_id, partido, em_exercicio)

                if result != "UPDATE 0":
                    atualizados += 1

                ok += 1
                if (i + 1) % 100 == 0:
                    print(f"[camara-autores] {i + 1}/{total} — ok={ok} atualizados={atualizados} erros={erros}")

            except Exception as e:
                erros += 1
                print(f"[camara-autores] ✗ dep {dep_id}: {e}")

            await asyncio.sleep(0.3)

    print(f"[camara-autores] Concluído: ok={ok} atualizados={atualizados} erros={erros} total={total}")
    return {"ok": ok, "atualizados": atualizados, "erros": erros, "total": total}
