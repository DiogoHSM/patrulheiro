"""
Ingestão de votações nominais do Senado com orientação de bancada e votos individuais.
Endpoints:
  GET /votacao?dataInicio=YYYY-MM-DD        -> lista votações com votos individuais
  GET /plenario/votacao/orientacaoBancada/{ini}/{fim} -> orientação por partido
"""
import asyncio
from datetime import datetime
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import get_pool, get_last_sync, set_last_sync, insert_proposicao
from app.models.schemas import ProposicaoNormalized

BASE_URL = "https://legis.senado.leg.br/dadosabertos"
HEADERS = {"Accept": "application/json"}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str, params: dict = None) -> dict | list:
    resp = await client.get(url, headers=HEADERS, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _to_dt(s: str | None):
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:19], fmt[:len(s[:19])])
        except ValueError:
            continue
    return None


async def ingest_senado_votacoes(data_inicio_override: str = None, data_fim_override: str = None) -> dict:
    pool = await get_pool()

    if data_inicio_override:
        data_inicio_fmt = data_inicio_override
    else:
        last_sync = await get_last_sync("senado_votacoes")
        data_inicio = last_sync[:10].replace("-", "") if last_sync else "20260101"
        data_inicio_fmt = f"{data_inicio[:4]}-{data_inicio[4:6]}-{data_inicio[6:]}"

    print(f"[senado-votacoes] Buscando {data_inicio_fmt} → {data_fim_override or 'hoje'}")

    ok = erros = inseridas = atualizadas = 0

    async with httpx.AsyncClient() as client:
        # 1. Busca lista de votações (inclui votos individuais)
        params = {"dataInicio": data_inicio_fmt}
        if data_fim_override:
            params["dataFim"] = data_fim_override
        votacoes_raw = await _get(client, f"{BASE_URL}/votacao", params=params)
        if not isinstance(votacoes_raw, list):
            print(f"[senado-votacoes] Resposta inesperada: {votacoes_raw}")
            return {"ok": 0, "erros": 1}

        print(f"[senado-votacoes] {len(votacoes_raw)} votações encontradas")

        # 2. Busca orientações de bancada para o mesmo período
        ini_sem_hifen = data_inicio_fmt.replace("-", "")
        fim_sem_hifen = data_fim_override.replace("-", "") if data_fim_override else datetime.now().strftime("%Y%m%d")
        try:
            orient_data = await _get(
                client,
                f"{BASE_URL}/plenario/votacao/orientacaoBancada/{ini_sem_hifen}/{fim_sem_hifen}"
            )
            orient_list = orient_data.get("votacoes", []) if isinstance(orient_data, dict) else []
        except Exception:
            orient_list = []

        # Indexa orientações por codigoVotacaoSve
        orientacoes_idx = {v["codigoVotacaoSve"]: v for v in orient_list if "codigoVotacaoSve" in v}
        print(f"[senado-votacoes] {len(orientacoes_idx)} orientações de bancada")

        TIPOS_VALIDOS = {"PL", "PEC", "PLP", "MPV", "PDL", "PRC", "PRS"}

        for v in votacoes_raw:
            codigo_materia = str(v.get("codigoMateria", ""))
            codigo_votacao = str(v.get("codigoVotacaoSve", v.get("codigoSessaoVotacao", "")))
            tipo = v.get("sigla", "")

            if not codigo_materia or not codigo_votacao or tipo not in TIPOS_VALIDOS:
                continue

            try:
                # Busca proposição no banco pelo fonte_id (codigoMateria)
                prop = await pool.fetchrow(
                    "SELECT id FROM proposicoes WHERE fonte = 'senado' AND fonte_id = $1",
                    codigo_materia
                )

                # Se não encontrou, insere via /processo/{idProcesso}
                if not prop:
                    id_processo = v.get("idProcesso")
                    if not id_processo:
                        continue
                    try:
                        proc = await _get(client, f"{BASE_URL}/processo/{id_processo}")
                        ementa = proc.get("conteudo", {}).get("ementa", "").strip()
                        if not ementa:
                            continue
                        numero = int(v.get("numero", 0))
                        ano = int(v.get("ano", 0))
                        data_apres = proc.get("documento", {}).get("dataApresentacao")
                        norm = ProposicaoNormalized(
                            fonte="senado",
                            fonte_id=codigo_materia,
                            tipo=tipo,
                            numero=numero,
                            ano=ano,
                            ementa=ementa,
                            url_tramitacao=f"https://www25.senado.leg.br/web/atividade/materias/-/materia/{codigo_materia}",
                            data_apresentacao=_to_dt(data_apres).date() if data_apres and _to_dt(data_apres) else None,
                        )
                        prop_id_str = await insert_proposicao(norm.model_dump())
                        prop = await pool.fetchrow("SELECT id FROM proposicoes WHERE id = $1::uuid", prop_id_str)
                        print(f"[senado-votacoes] Inserida proposição {tipo} {numero}/{ano}")
                    except Exception as e:
                        print(f"[senado-votacoes] ✗ Não conseguiu inserir materia={codigo_materia}: {e}")
                        continue

                prop_id = str(prop["id"])

                # Orientação do PL nessa votação
                orient = orientacoes_idx.get(int(codigo_votacao) if codigo_votacao.isdigit() else -1, {})
                orientacao_pl = next(
                    (o["voto"] for o in orient.get("orientacoesLideranca", []) if o.get("partido") == "PL"),
                    None
                )

                # Insere/atualiza votação
                data_sessao = _to_dt(v.get("dataSessao"))
                vot_row = await pool.fetchrow("""
                    INSERT INTO votacoes (
                        proposicao_id, votacao_id, data, data_hora,
                        sigla_orgao, descricao, aprovacao,
                        votos_sim, votos_nao, votos_abstencao, total_votos,
                        orientacao_pl, fonte
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    ON CONFLICT (votacao_id) DO UPDATE SET
                        votos_sim      = EXCLUDED.votos_sim,
                        votos_nao      = EXCLUDED.votos_nao,
                        votos_abstencao= EXCLUDED.votos_abstencao,
                        total_votos    = EXCLUDED.total_votos,
                        orientacao_pl  = EXCLUDED.orientacao_pl
                    RETURNING id, (xmax = 0) AS inserted
                """,
                    prop_id, codigo_votacao,
                    data_sessao.date() if data_sessao else None,
                    data_sessao,
                    v.get("siglaTipoSessao") or "SF",
                    v.get("descricaoVotacao", "")[:500],
                    {"A": True, "R": False}.get(v.get("resultadoVotacao", ""), None),
                    orient.get("qtdVotosSim") if orient.get("qtdVotosSim") is not None else v.get("totalVotosSim"),
                    orient.get("qtdVotosNao") if orient.get("qtdVotosNao") is not None else v.get("totalVotosNao"),
                    orient.get("qtdVotosAbstencao") if orient.get("qtdVotosAbstencao") is not None else v.get("totalVotosAbstencao"),
                    (orient.get("qtdVotosSim") or 0) + (orient.get("qtdVotosNao") or 0) + (orient.get("qtdVotosAbstencao") or 0) or None,
                    orientacao_pl,
                    "senado",
                )

                vot_db_id = str(vot_row["id"])
                if vot_row["inserted"]:
                    inseridas += 1
                else:
                    atualizadas += 1

                # Votos individuais — da lista /votacao (tem codigoParlamentar)
                votos = v.get("votos", [])
                # Se não, usa votosParlamentar do orient (sem ID, só nome)
                if not votos and orient:
                    votos_orient = orient.get("votosParlamentar", [])
                    for vp in votos_orient:
                        await pool.execute("""
                            INSERT INTO votos (votacao_id, deputado_id, deputado_nome, partido, uf, tipo_voto)
                            VALUES ($1,$2,$3,$4,$5,$6)
                            ON CONFLICT (votacao_id, deputado_id) DO NOTHING
                        """,
                            vot_db_id,
                            vp.get("nomeParlamentar", "")[:50],  # sem ID, usa nome como chave
                            vp.get("nomeParlamentar", ""),
                            vp.get("partido"),
                            vp.get("uf"),
                            vp.get("voto", ""),
                        )
                else:
                    for voto in votos:
                        parl_id = str(voto.get("codigoParlamentar", ""))
                        await pool.execute("""
                            INSERT INTO votos (votacao_id, deputado_id, deputado_nome, partido, uf, tipo_voto)
                            VALUES ($1,$2,$3,$4,$5,$6)
                            ON CONFLICT (votacao_id, deputado_id) DO NOTHING
                        """,
                            vot_db_id,
                            parl_id or voto.get("nomeParlamentar", "")[:50],
                            voto.get("nomeParlamentar", ""),
                            voto.get("siglaPartidoParlamentar"),
                            voto.get("siglaUFParlamentar"),
                            voto.get("siglaVotoParlamentar", ""),
                        )

                ok += 1

            except Exception as e:
                erros += 1
                print(f"[senado-votacoes] ✗ materia={codigo_materia} votacao={codigo_votacao}: {e}")

    await set_last_sync("senado_votacoes", records=inseridas + atualizadas)
    print(f"[senado-votacoes] Concluído: inseridas={inseridas} atualizadas={atualizadas} erros={erros}")
    return {"ok": ok, "inseridas": inseridas, "atualizadas": atualizadas, "erros": erros}
