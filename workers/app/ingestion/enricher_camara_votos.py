"""
Ingestão de votos individuais da Câmara para todas as votações sem votos.
API: GET https://dadosabertos.camara.leg.br/api/v2/votacoes/{id}/votos
"""
import asyncio
from datetime import datetime
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import get_pool

BASE_URL = "https://dadosabertos.camara.leg.br/api/v2"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str) -> dict:
    resp = await client.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _to_dt(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:19])
    except (ValueError, TypeError):
        return None


async def ingest_camara_votos() -> dict:
    """
    Busca votos individuais para votações da Câmara que ainda não têm votos.
    Idempotente: ON CONFLICT DO NOTHING garante segurança ao re-executar.
    """
    pool = await get_pool()

    rows = await pool.fetch("""
        SELECT v.id, v.votacao_id AS api_id
        FROM votacoes v
        WHERE v.fonte IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM votos vo WHERE vo.votacao_id = v.id
          )
        ORDER BY v.data DESC
    """)

    total = len(rows)
    print(f"[camara-votos] {total} votações sem votos")

    ok = erros = inseridos = 0

    async with httpx.AsyncClient() as client:
        for i, row in enumerate(rows):
            vot_db_id = row["id"]
            api_id = row["api_id"]

            try:
                await asyncio.sleep(0.3)
                votos_raw = (await _get(client, f"{BASE_URL}/votacoes/{api_id}/votos")).get("dados", [])

                for voto in votos_raw:
                    dep = voto.get("deputado_") or {}
                    dep_id = str(dep.get("id", ""))
                    await pool.execute("""
                        INSERT INTO votos (votacao_id, deputado_id, deputado_nome, partido, uf, tipo_voto, data_registro)
                        VALUES ($1,$2,$3,$4,$5,$6,$7)
                        ON CONFLICT (votacao_id, deputado_id) DO NOTHING
                    """,
                        vot_db_id,
                        dep_id,
                        dep.get("nome", ""),
                        dep.get("siglaPartido"),
                        dep.get("siglaUf"),
                        voto.get("tipoVoto", ""),
                        _to_dt(voto.get("dataRegistroVoto")),
                    )
                    inseridos += 1

                ok += 1
                if (i + 1) % 50 == 0:
                    print(f"[camara-votos] {i + 1}/{total} votações, {inseridos} votos inseridos")

            except Exception as e:
                erros += 1
                print(f"[camara-votos] ✗ {api_id}: {e}")

    print(f"[camara-votos] Concluído: {ok} votações ok, {inseridos} votos, {erros} erros")
    return {"ok": ok, "inseridos": inseridos, "erros": erros, "total": total}
