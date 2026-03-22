"""
Ingestão de votações nominais do plenário da Câmara por período.

API:
  GET /votacoes?siglaOrgao=PLEN&dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD&itens=200
  GET /votacoes/{id}          → proposicoesAfetadas
  GET /votacoes/{id}/votos    → votos individuais (placar calculado aqui)
"""
import asyncio
from datetime import date, timedelta
from datetime import datetime
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import get_pool, get_last_sync, set_last_sync, insert_proposicao
from app.models.schemas import ProposicaoNormalized

BASE_URL = "https://dadosabertos.camara.leg.br/api/v2"

TIPOS_VALIDOS = {
    "PL", "PEC", "PLP", "MPV", "PDC", "PDL", "PRC",
    "REQ", "MSC", "INC", "RIC", "RPD", "SBT", "PRS",
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str, params: dict = None) -> dict:
    resp = await client.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _to_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:19])
    except (ValueError, TypeError):
        return None


async def _resolve_proposicao(pool, client: httpx.AsyncClient, prop_data: dict) -> str | None:
    """
    Garante que a proposição existe no banco a partir dos dados de proposicoesAfetadas.
    Retorna o UUID interno ou None em caso de falha.
    """
    fonte_id = str(prop_data.get("id", ""))
    if not fonte_id:
        return None

    row = await pool.fetchrow(
        "SELECT id FROM proposicoes WHERE fonte = 'camara' AND fonte_id = $1", fonte_id
    )
    if row:
        return str(row["id"])

    tipo = prop_data.get("siglaTipo", "")
    numero_raw = prop_data.get("numero")
    ano_raw = prop_data.get("ano")
    ementa = (prop_data.get("ementa") or "").strip()

    if not ementa or not numero_raw or not ano_raw:
        # Tenta buscar detalhes na API
        try:
            det = (await _get(client, f"{BASE_URL}/proposicoes/{fonte_id}")).get("dados", {})
            ementa = (det.get("ementa") or "").strip()
            tipo = tipo or det.get("siglaTipo", "")
            numero_raw = numero_raw or det.get("numero")
            ano_raw = ano_raw or det.get("ano")
        except Exception:
            pass

    if not ementa:
        return None

    data_apres_str = prop_data.get("dataApresentacao")
    data_apres_dt = _to_dt(data_apres_str)

    norm = ProposicaoNormalized(
        fonte="camara",
        fonte_id=fonte_id,
        tipo=tipo or "PL",
        numero=int(numero_raw) if numero_raw else 0,
        ano=int(ano_raw) if ano_raw else 0,
        ementa=ementa,
        url_tramitacao=f"https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao={fonte_id}",
        data_apresentacao=data_apres_dt.date() if data_apres_dt else None,
    )
    try:
        return await insert_proposicao(norm.model_dump())
    except Exception as e:
        print(f"[camara-votacoes] ✗ Não conseguiu inserir proposição {fonte_id}: {e}")
        return None


async def ingest_camara_votacoes(
    data_inicio_override: str = None,
    data_fim_override: str = None,
) -> dict:
    pool = await get_pool()

    if data_inicio_override:
        data_ini = data_inicio_override
    else:
        last_sync = await get_last_sync("camara_votacoes")
        if last_sync:
            # Recua 2 dias para capturar votações com delay de publicação
            dt = datetime.fromisoformat(last_sync[:10]) - timedelta(days=2)
            data_ini = dt.strftime("%Y-%m-%d")
        else:
            data_ini = "2026-01-01"

    data_fim = data_fim_override or date.today().strftime("%Y-%m-%d")
    print(f"[camara-votacoes] Buscando {data_ini} → {data_fim}")

    ok = erros = inseridas = atualizadas = votos_inseridos = 0

    async with httpx.AsyncClient() as client:
        pagina = 1
        while True:
            params = {
                "siglaOrgao": "PLEN",
                "dataInicio": data_ini,
                "dataFim": data_fim,
                "itens": 200,
                "pagina": pagina,
                "ordenarPor": "dataHoraRegistro",
                "ordem": "ASC",
            }
            try:
                resp = await _get(client, f"{BASE_URL}/votacoes", params=params)
            except Exception as e:
                print(f"[camara-votacoes] ✗ Erro na paginação {pagina}: {e}")
                break

            votacoes_raw = resp.get("dados", [])
            if not votacoes_raw:
                break

            print(f"[camara-votacoes] Página {pagina}: {len(votacoes_raw)} votações")

            for v in votacoes_raw:
                votacao_id = v.get("id")
                if not votacao_id:
                    continue

                # Pula votações que não são do plenário
                if v.get("siglaOrgao") != "PLEN":
                    continue

                try:
                    # 1. Busca detalhes para obter proposicoesAfetadas
                    det = (await _get(client, f"{BASE_URL}/votacoes/{votacao_id}")).get("dados", {})
                    await asyncio.sleep(0.2)

                    props_afetadas = det.get("proposicoesAfetadas", [])
                    prop_id = None

                    if props_afetadas:
                        prop_id = await _resolve_proposicao(pool, client, props_afetadas[0])

                    # 2. Busca votos individuais
                    votos_raw = (await _get(client, f"{BASE_URL}/votacoes/{votacao_id}/votos")).get("dados", [])
                    await asyncio.sleep(0.2)

                    # 3. Calcula placar a partir dos votos
                    sim = nao = abst = 0
                    for voto in votos_raw:
                        sv = (voto.get("tipoVoto") or "").upper()
                        if sv in ("SIM", "YES"):
                            sim += 1
                        elif sv in ("NÃO", "NAO", "NO"):
                            nao += 1
                        elif sv in ("ABSTENCAO", "ABSTENÇÃO", "ABSTENTION"):
                            abst += 1

                    total = sim + nao + abst
                    # Se não tem votos nominais registrados, usa placar nulo
                    placar_sim = sim if total > 0 else None
                    placar_nao = nao if total > 0 else None
                    placar_abst = abst if total > 0 else None
                    placar_total = total if total > 0 else None

                    aprovacao_raw = v.get("aprovacao")
                    aprovacao = bool(aprovacao_raw) if aprovacao_raw is not None else None

                    data_dt = _to_dt(v.get("dataHoraRegistro") or v.get("data"))

                    # 4. Insere/atualiza votação
                    vot_row = await pool.fetchrow("""
                        INSERT INTO votacoes (
                            proposicao_id, votacao_id, data, data_hora,
                            sigla_orgao, descricao, aprovacao,
                            votos_sim, votos_nao, votos_abstencao, total_votos
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                        ON CONFLICT (votacao_id) DO UPDATE SET
                            proposicao_id   = COALESCE(EXCLUDED.proposicao_id, votacoes.proposicao_id),
                            aprovacao       = COALESCE(EXCLUDED.aprovacao, votacoes.aprovacao),
                            votos_sim       = COALESCE(EXCLUDED.votos_sim, votacoes.votos_sim),
                            votos_nao       = COALESCE(EXCLUDED.votos_nao, votacoes.votos_nao),
                            votos_abstencao = COALESCE(EXCLUDED.votos_abstencao, votacoes.votos_abstencao),
                            total_votos     = COALESCE(EXCLUDED.total_votos, votacoes.total_votos)
                        RETURNING id, (xmax = 0) AS inserted
                    """,
                        prop_id, votacao_id,
                        data_dt.date() if data_dt else None,
                        data_dt,
                        "PLEN",
                        (v.get("descricao") or "")[:500],
                        aprovacao,
                        placar_sim, placar_nao, placar_abst, placar_total,
                    )

                    vot_db_id = str(vot_row["id"])
                    if vot_row["inserted"]:
                        inseridas += 1
                    else:
                        atualizadas += 1

                    # 5. Insere votos individuais
                    for voto in votos_raw:
                        dep_id = str(voto.get("deputado_", {}).get("id", "") or "")
                        dep_nome = voto.get("deputado_", {}).get("nome", "") or ""
                        partido = voto.get("deputado_", {}).get("siglaPartido") or voto.get("siglaPartidoParlamentar")
                        uf = voto.get("deputado_", {}).get("siglaUf") or voto.get("siglaUFParlamentar")
                        tipo_voto = voto.get("tipoVoto", "")
                        data_reg = _to_dt(voto.get("dataRegistroVoto"))

                        if not dep_id and dep_nome:
                            dep_id = dep_nome[:50]

                        await pool.execute("""
                            INSERT INTO votos (votacao_id, deputado_id, deputado_nome, partido, uf, tipo_voto, data_registro)
                            VALUES ($1,$2,$3,$4,$5,$6,$7)
                            ON CONFLICT (votacao_id, deputado_id) DO NOTHING
                        """, vot_db_id, dep_id, dep_nome, partido, uf, tipo_voto, data_reg)
                        votos_inseridos += 1

                    ok += 1

                except Exception as e:
                    erros += 1
                    print(f"[camara-votacoes] ✗ votacao={votacao_id}: {e}")

                await asyncio.sleep(0.3)

            # Verifica se há próxima página
            links = resp.get("links", [])
            has_next = any(lk.get("rel") == "next" for lk in links)
            if not has_next or len(votacoes_raw) < 200:
                break
            pagina += 1
            await asyncio.sleep(0.5)

    await set_last_sync("camara_votacoes", records=inseridas + atualizadas)
    print(f"[camara-votacoes] Concluído: inseridas={inseridas} atualizadas={atualizadas} votos={votos_inseridos} erros={erros}")
    return {"ok": ok, "inseridas": inseridas, "atualizadas": atualizadas, "votos_inseridos": votos_inseridos, "erros": erros}
