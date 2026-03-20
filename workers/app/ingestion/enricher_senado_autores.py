"""
Backfill de partido, UF e url_perfil para autores já inseridos do Senado.
Faz re-fetch de /materia/autoria/{codigo} para cada proposição senado.
"""
import asyncio
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import get_pool

BASE_URL = "https://legis.senado.leg.br/dadosabertos"
HEADERS = {"Accept": "application/json"}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str) -> dict:
    resp = await client.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _ensure_list(v):
    if isinstance(v, list):
        return v
    return [v] if v else []


async def enrich_senado_autores() -> dict:
    pool = await get_pool()

    rows = await pool.fetch(
        "SELECT id, fonte_id FROM proposicoes WHERE fonte = 'senado' ORDER BY created_at"
    )
    total = len(rows)
    print(f"[senado-autores] {total} proposições para processar")

    ok = erros = atualizados = 0

    async with httpx.AsyncClient() as client:
        for i, row in enumerate(rows):
            prop_id = str(row["id"])
            codigo = row["fonte_id"]

            try:
                await asyncio.sleep(0.3)
                data = await _get(client, f"{BASE_URL}/materia/autoria/{codigo}")
                autoria = (
                    data.get("AutoriaMateria", {})
                    .get("Materia", {})
                    .get("Autoria", {})
                    .get("Autor", [])
                )
                autoria = _ensure_list(autoria)

                for a in autoria:
                    nome = a.get("NomeAutor", "")
                    if not nome:
                        continue
                    ident = a.get("IdentificacaoParlamentar", {})
                    partido = ident.get("SiglaPartidoParlamentar")
                    uf = a.get("UfAutor") or ident.get("UfParlamentar")
                    url_perfil = ident.get("UrlPaginaParlamentar")
                    fonte_id = str(ident.get("CodigoParlamentar", "") or "")

                    result = await pool.execute("""
                        UPDATE proposicao_autores SET
                            partido    = COALESCE($3, partido),
                            uf         = COALESCE($4, uf),
                            url_perfil = COALESCE($5, url_perfil),
                            fonte_id   = CASE WHEN fonte_id = '' THEN $6 ELSE fonte_id END
                        WHERE proposicao_id = $1 AND nome = $2
                    """, prop_id, nome, partido, uf, url_perfil, fonte_id)

                    if result != "UPDATE 0":
                        atualizados += 1

                ok += 1
                if (i + 1) % 100 == 0:
                    print(f"[senado-autores] {i + 1}/{total} — ok={ok} atualizados={atualizados} erros={erros}")

            except Exception as e:
                erros += 1
                print(f"[senado-autores] ✗ {codigo}: {e}")

    print(f"[senado-autores] Concluído: ok={ok} atualizados={atualizados} erros={erros}")
    return {"ok": ok, "atualizados": atualizados, "erros": erros, "total": total}
