import asyncio
import io
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.db import get_pool, get_last_sync, set_last_sync, insert_dou_ato
from app.models.schemas import DouAtoNormalized, IngestResult

INLABS_BASE = "https://inlabs.in.gov.br"

# ---------------------------------------------------------------------------
# Filtro de relevância pré-IA
# Padrões a descartar sem chamar Claude
# ---------------------------------------------------------------------------
_IRRELEVANT_TIPOS = re.compile(
    r"^(apostila|retifica[çc][aã]o|erratum|extrato de contrato|extrato de conv[eê]nio"
    r"|extrato de termo aditivo|extrato de chamamento p[uú]blico"
    r"|extrato de inexigibilidade|extrato de dispen[sc]a|pregão eletr[oô]nico"
    r"|resultado de julgamento|aviso de licita[çc][aã]o|aviso de chamamento"
    r"|portaria de lotação|portaria de designa[çc][aã]o|portaria de remo[çc][aã]o"
    r"|portaria de afastamento|portaria de licen[çc]a|portaria de férias"
    r"|portaria de exonera[çc][aã]o de cargo em comiss[aã]o dAS-[12]"
    r"|portaria de nomea[çc][aã]o.*DAS-[12])$",
    re.IGNORECASE,
)

_IRRELEVANT_TITULO = re.compile(
    r"(férias|afastamento|licen[çc]a m[eé]dica|nomeação.*DAS-[12]"
    r"|exoneração.*DAS-[12]|pregão eletrônico|licitação|resultado de pregão"
    r"|homologação.*licitação|apostila|retificação.*nome|retificação.*data"
    r"|convocação.*concurso|gabarito.*concurso)",
    re.IGNORECASE,
)


def _is_irrelevant(ato: DouAtoNormalized) -> bool:
    tipo = (ato.tipo_ato or "").strip()
    titulo = (ato.titulo or "").strip()
    if _IRRELEVANT_TIPOS.match(tipo):
        return True
    if _IRRELEVANT_TITULO.search(titulo):
        return True
    return False


# ---------------------------------------------------------------------------
# Autenticação INLABS
# ---------------------------------------------------------------------------
_token_cache: dict = {}


async def _get_token(client: httpx.AsyncClient) -> str:
    if _token_cache.get("token"):
        return _token_cache["token"]
    resp = await client.post(
        f"{INLABS_BASE}/acesso.php",
        data={"email": settings.inlabs_user, "password": settings.inlabs_password},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    token = body.get("token") or body.get("access_token") or ""
    _token_cache["token"] = token
    return token


# ---------------------------------------------------------------------------
# Download do ZIP diário do INLABS
# ---------------------------------------------------------------------------
@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=15))
async def _download_zip(client: httpx.AsyncClient, data_str: str, token: str) -> bytes:
    resp = await client.get(
        f"{INLABS_BASE}/index.php",
        params={"p": data_str},
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
        follow_redirects=True,
    )
    resp.raise_for_status()
    return resp.content


# ---------------------------------------------------------------------------
# Parsing do XML do DOU
# Os XMLs do INLABS contêm elementos <article> ou <item> por ato
# ---------------------------------------------------------------------------
def _parse_xml(xml_bytes: bytes, edicao: str) -> list[DouAtoNormalized]:
    atos = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return atos

    # Suporta tanto <article> quanto <item> dependendo da versão do XML
    for elem in root.iter():
        if elem.tag not in ("article", "item", "artigo"):
            continue

        def _text(tag: str) -> str | None:
            child = elem.find(tag)
            return child.text.strip() if child is not None and child.text else None

        secao = (
            _text("secao_dou_data") or _text("secao") or _text("pubname") or "1"
        )
        # pubname vem como "DO1", "DO2", "DO3" — normaliza para "1", "2", "3"
        secao = re.sub(r"^DO", "", secao).strip() or "1"

        pagina_str = _text("pagina_dou_data") or _text("pagina")
        try:
            pagina = int(pagina_str) if pagina_str else None
        except ValueError:
            pagina = None

        tipo_ato = (
            _text("art_type") or _text("tipoDoAto") or _text("tipo_ato") or _text("art_category")
        )
        orgao = (
            _text("orgao_dou_data") or _text("orgao") or _text("ato_orgao_lotacao")
        )
        titulo = _text("art_title") or _text("titulo") or _text("ementa")
        corpo = _text("art_body") or _text("corpo") or _text("texto")

        if not titulo and not orgao:
            continue

        atos.append(DouAtoNormalized(
            edicao=edicao,
            secao=secao,
            pagina=pagina,
            tipo_ato=tipo_ato,
            orgao=orgao,
            titulo=titulo,
            texto_completo=corpo,
        ))
    return atos


def _extract_atos_from_zip(zip_bytes: bytes, edicao: str) -> list[DouAtoNormalized]:
    atos = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in zf.namelist():
                if name.lower().endswith(".xml"):
                    with zf.open(name) as f:
                        atos.extend(_parse_xml(f.read(), edicao))
    except zipfile.BadZipFile:
        # Talvez a resposta já seja XML direto
        atos = _parse_xml(zip_bytes, edicao)
    return atos


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------
async def ingest_dou(data_override: str | None = None) -> IngestResult:
    """
    Baixa, parseia e persiste atos do DOU para uma data (padrão: hoje).
    Aplica filtro de relevância pré-IA antes de inserir.
    """
    edicao = data_override or date.today().isoformat()

    pool = await get_pool()
    inseridos = 0
    filtrados = 0
    erros = 0

    async with httpx.AsyncClient() as client:
        try:
            token = await _get_token(client)
        except Exception as e:
            await set_last_sync("dou", status="error", records=0, error=str(e))
            return IngestResult(fonte="dou", erros=1, mensagem=f"Falha de autenticação INLABS: {e}")

        try:
            zip_bytes = await _download_zip(client, edicao, token)
        except Exception as e:
            # Invalida token em cache para próxima tentativa
            _token_cache.clear()
            await set_last_sync("dou", status="error", records=0, error=str(e))
            return IngestResult(fonte="dou", erros=1, mensagem=f"Falha no download INLABS {edicao}: {e}")

    atos = _extract_atos_from_zip(zip_bytes, edicao)

    for ato in atos:
        if _is_irrelevant(ato):
            # Persiste mas marca como não relevante para não processar
            try:
                await pool.execute("""
                    INSERT INTO dou_atos (edicao, secao, pagina, tipo_ato, orgao, titulo, texto_completo, relevante)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
                    ON CONFLICT (edicao, secao, orgao, titulo) DO NOTHING
                """,
                    ato.edicao, ato.secao, ato.pagina,
                    ato.tipo_ato, ato.orgao, ato.titulo, ato.texto_completo,
                )
            except Exception:
                pass
            filtrados += 1
            continue

        try:
            ato_id, novo = await insert_dou_ato({
                "edicao": ato.edicao,
                "secao": ato.secao,
                "pagina": ato.pagina,
                "tipo_ato": ato.tipo_ato,
                "orgao": ato.orgao,
                "titulo": ato.titulo,
                "texto_completo": ato.texto_completo,
            })
            if ato_id and novo:
                # Marca como relevante para entrar no pipeline de IA
                await pool.execute(
                    "UPDATE dou_atos SET relevante = TRUE WHERE id = $1", ato_id
                )
                inseridos += 1
        except Exception as e:
            erros += 1
            print(f"[dou] erro ao inserir ato: {e}")

        await asyncio.sleep(0.01)

    total = len(atos)
    await set_last_sync("dou", status="success", records=inseridos)

    msg = (
        f"DOU {edicao}: {total} atos encontrados, "
        f"{inseridos} inseridos, {filtrados} filtrados (irrelevantes), {erros} erros"
    )
    print(f"[dou] {msg}")
    return IngestResult(fonte="dou", inseridas=inseridos, erros=erros, mensagem=msg)
