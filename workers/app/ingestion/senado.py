import asyncio
import re
from datetime import datetime
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import (
    get_last_sync, set_last_sync,
    proposicao_exists, insert_proposicao,
    insert_autores, insert_tramitacoes,
)
from app.models.schemas import IngestResult, ProposicaoNormalized, AutorNormalized, TramitacaoNormalized

BASE_URL = "https://legis.senado.leg.br/dadosabertos"
HEADERS = {"Accept": "application/json"}
TIPOS_VALIDOS = {"PL", "PEC", "PLP", "MPV", "PDL", "PRC", "PRS"}

# Regex para parsear "PL 199/2026" ou "PEC 3/2026"
IDENT_RE = re.compile(r'^(\w+)\s+(\d+)/(\d{4})')


def _parse_ident(identificacao: str) -> tuple[str, int, int] | None:
    m = IDENT_RE.match((identificacao or "").strip())
    if not m:
        return None
    tipo, numero, ano = m.group(1), int(m.group(2)), int(m.group(3))
    if tipo not in TIPOS_VALIDOS:
        return None
    return tipo, numero, ano


def _to_date(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:10]).date()
    except (ValueError, TypeError):
        return None


def _to_dt(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:19])
    except (ValueError, TypeError):
        return None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str, params: dict = None) -> dict:
    resp = await client.get(url, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


async def _fetch_proposicoes(client: httpx.AsyncClient, data_inicio: str) -> list[dict]:
    """Busca proposições tramitando no Senado desde data_inicio."""
    ano_inicio = int(data_inicio[:4])
    # Busca por ano corrente e anterior (proposições apresentadas antes mas ainda tramitando)
    anos = {ano_inicio, ano_inicio - 1} if ano_inicio > 2020 else {ano_inicio}
    todos = []
    for ano in anos:
        data = await _get(client, f"{BASE_URL}/processo", params={
            "ano": ano, "tramitando": "S", "itens": 500,
        })
        if isinstance(data, list):
            todos.extend(data)
    return todos


async def _fetch_situacao(client: httpx.AsyncClient, codigo: str) -> dict:
    """Retorna situação atual e órgão da matéria."""
    try:
        data = await _get(client, f"{BASE_URL}/materia/situacaoatual/{codigo}")
        materias = (
            data.get("SituacaoAtualMateria", {})
            .get("Materias", {})
            .get("Materia", [])
        )
        if isinstance(materias, dict):
            materias = [materias]
        if not materias:
            return {}
        mat = materias[0]
        sit = (
            mat.get("SituacaoAtual", {})
            .get("Autuacoes", {})
            .get("Autuacao", {})
        )
        if isinstance(sit, list):
            sit = sit[0] if sit else {}
        situacoes = sit.get("Situacoes", {}).get("Situacao", [])
        if isinstance(situacoes, dict):
            situacoes = [situacoes]
        desc_sit = situacoes[-1].get("DescricaoSituacao") if situacoes else None
        # Local atual
        local = sit.get("Local", {})
        orgao = local.get("SiglaLocal") or local.get("NomeLocal")
        return {"situacao": desc_sit, "orgao_atual": orgao}
    except Exception:
        return {}


async def _fetch_autores(client: httpx.AsyncClient, codigo: str) -> list[dict]:
    try:
        data = await _get(client, f"{BASE_URL}/materia/autoria/{codigo}")
        autoria = (
            data.get("AutoriaMateria", {})
            .get("Materia", {})
            .get("Autoria", {})
            .get("Autor", [])
        )
        if isinstance(autoria, dict):
            autoria = [autoria]
        return autoria
    except Exception:
        return []


async def _fetch_tramitacoes(client: httpx.AsyncClient, codigo: str) -> list[dict]:
    try:
        data = await _get(client, f"{BASE_URL}/materia/movimentacoes/{codigo}")
        autuacoes = (
            data.get("MovimentacaoMateria", {})
            .get("Materia", {})
            .get("Autuacoes", {})
            .get("Autuacao", [])
        )
        if isinstance(autuacoes, dict):
            autuacoes = [autuacoes]
        informes = []
        for aut in autuacoes:
            for inf in _ensure_list(
                aut.get("InformesLegislativos", {}).get("InformeLegislativo", [])
            ):
                informes.append(inf)
        return informes
    except Exception:
        return []


def _ensure_list(v):
    if isinstance(v, list):
        return v
    if v:
        return [v]
    return []


async def ingest_senado() -> IngestResult:
    result = IngestResult(fonte="senado")

    last_sync = await get_last_sync("senado")
    data_inicio = last_sync[:10] if last_sync else "2026-01-01"

    async with httpx.AsyncClient() as client:
        try:
            proposicoes = await _fetch_proposicoes(client, data_inicio)
        except Exception as e:
            await set_last_sync("senado", status="error", error=str(e))
            result.mensagem = f"Erro ao buscar proposições: {e}"
            return result

        for raw in proposicoes:
            parsed = _parse_ident(raw.get("identificacao", ""))
            if not parsed:
                continue
            tipo, numero, ano = parsed

            ementa = (raw.get("ementa") or "").strip()
            if not ementa:
                continue

            codigo = str(raw.get("codigoMateria", ""))
            url_senado = f"https://www25.senado.leg.br/web/atividade/materias/-/materia/{codigo}"

            try:
                # Busca situação e órgão atual
                await asyncio.sleep(0.3)
                sit = await _fetch_situacao(client, codigo)

                normalized = ProposicaoNormalized(
                    fonte="senado",
                    fonte_id=codigo,
                    tipo=tipo,
                    numero=numero,
                    ano=ano,
                    ementa=ementa,
                    url_tramitacao=url_senado,
                    url_inteiro_teor=raw.get("urlDocumento"),
                    data_apresentacao=_to_date(raw.get("dataApresentacao")),
                    situacao=sit.get("situacao"),
                    regime=raw.get("objetivo"),  # "Iniciadora", "Revisora", etc.
                    orgao_atual=sit.get("orgao_atual"),
                )

                exists_id = await proposicao_exists("senado", tipo, numero, ano)
                prop_id = await insert_proposicao(normalized.model_dump())

                if exists_id:
                    result.atualizadas += 1
                else:
                    result.inseridas += 1
                    # Autores — apenas para novas proposições
                    await asyncio.sleep(0.3)
                    autores_raw = await _fetch_autores(client, codigo)
                    autores = []
                    for a in autores_raw:
                        nome = a.get("NomeAutor", "")
                        if not nome:
                            continue
                        ident = a.get("IdentificacaoParlamentar", {})
                        autor = AutorNormalized(
                            nome=nome,
                            partido=ident.get("SiglaPartidoParlamentar"),
                            uf=a.get("UfAutor") or ident.get("UfParlamentar"),
                            fonte_id=str(ident.get("CodigoParlamentar", "") or ""),
                            tipo_autoria=a.get("SiglaTipoAutor", "autor").lower(),
                        ).model_dump()
                        autor["url_perfil"] = ident.get("UrlPaginaParlamentar")
                        autores.append(autor)
                    if autores:
                        await insert_autores(prop_id, autores)

                # Tramitações — sempre (idempotente via ON CONFLICT DO NOTHING)
                await asyncio.sleep(0.3)
                trams_raw = await _fetch_tramitacoes(client, codigo)
                trams = []
                for t in trams_raw:
                    local = t.get("Local", {})
                    tram = TramitacaoNormalized(
                        data=t.get("Data"),
                        descricao=t.get("Descricao") or "",
                        orgao=local.get("SiglaLocal") or local.get("NomeLocal"),
                        situacao=None,
                        url=None,
                        fonte_id=str(t.get("IdInformeLegislativo", "")),
                    ).model_dump()
                    tram["data"] = _to_dt(t.get("Data"))
                    trams.append(tram)
                if trams:
                    await insert_tramitacoes(prop_id, trams)

            except Exception as e:
                result.erros += 1
                print(f"[senado] ✗ {raw.get('identificacao')}: {e}")
                continue

    await set_last_sync("senado", records=result.inseridas + result.atualizadas)
    result.mensagem = f"{result.inseridas} inseridas, {result.atualizadas} atualizadas, {result.erros} erros"
    return result
