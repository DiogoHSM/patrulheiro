import asyncio
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import (
    get_last_sync, set_last_sync,
    proposicao_exists, insert_proposicao,
    insert_autores, insert_tramitacoes,
)
from app.ingestion.normalizer import (
    normalizar_camara, normalizar_autor_camara, normalizar_tramitacao_camara
)
from app.models.schemas import IngestResult

BASE_URL = "https://dadosabertos.camara.leg.br/api/v2"
TIPOS = ["PL", "PEC", "PLP", "MPV", "PDL"]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str, params: dict = None) -> dict:
    resp = await client.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


async def _fetch_proposicoes(client: httpx.AsyncClient, data_inicio: str) -> list[dict]:
    proposicoes = []
    for tipo in TIPOS:
        pagina = 1
        while True:
            data = await _get(client, f"{BASE_URL}/proposicoes", params={
                "siglaTipo": tipo,
                "dataInicio": data_inicio,
                "ordenarPor": "id",
                "ordem": "DESC",
                "itens": 100,
                "pagina": pagina,
            })
            items = data.get("dados", [])
            if not items:
                break
            proposicoes.extend(items)
            if len(items) < 100:
                break
            pagina += 1
            await asyncio.sleep(0.5)
    return proposicoes


async def _fetch_detalhes(client: httpx.AsyncClient, prop_id: str) -> dict:
    data = await _get(client, f"{BASE_URL}/proposicoes/{prop_id}")
    return data.get("dados", {})


async def _fetch_autores(client: httpx.AsyncClient, prop_id: str) -> list[dict]:
    data = await _get(client, f"{BASE_URL}/proposicoes/{prop_id}/autores")
    return data.get("dados", [])


async def _fetch_tramitacoes(client: httpx.AsyncClient, prop_id: str) -> list[dict]:
    data = await _get(client, f"{BASE_URL}/proposicoes/{prop_id}/tramitacoes")
    return data.get("dados", [])


async def ingest_camara() -> IngestResult:
    result = IngestResult(fonte="camara")

    last_sync = await get_last_sync("camara")
    data_inicio = last_sync[:10] if last_sync else "2026-01-01"

    async with httpx.AsyncClient() as client:
        try:
            proposicoes = await _fetch_proposicoes(client, data_inicio)
        except Exception as e:
            await set_last_sync("camara", status="error", error=str(e))
            result.mensagem = f"Erro ao buscar proposições: {e}"
            return result

        for raw in proposicoes:
            try:
                normalized = normalizar_camara(raw)
                if not normalized:
                    continue

                exists_id = await proposicao_exists(
                    "camara", normalized.tipo, normalized.numero, normalized.ano
                )

                prop_id = await insert_proposicao(normalized.model_dump())

                if exists_id:
                    result.atualizadas += 1
                    continue

                result.inseridas += 1

                # Buscar detalhes, autores e tramitações para proposições novas
                await asyncio.sleep(0.3)
                try:
                    detalhes = await _fetch_detalhes(client, raw["id"])
                    autores_raw = await _fetch_autores(client, raw["id"])
                    tramitacoes_raw = await _fetch_tramitacoes(client, raw["id"])

                    autores = [normalizar_autor_camara(a).model_dump() for a in autores_raw]
                    tramitacoes = [normalizar_tramitacao_camara(t).model_dump() for t in tramitacoes_raw]

                    await insert_autores(prop_id, autores)
                    await insert_tramitacoes(prop_id, tramitacoes)
                except Exception:
                    pass

            except Exception as e:
                result.erros += 1
                continue

    await set_last_sync("camara", records=result.inseridas + result.atualizadas)
    result.mensagem = f"{result.inseridas} inseridas, {result.atualizadas} atualizadas, {result.erros} erros"
    return result
