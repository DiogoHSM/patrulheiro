import asyncio
import re
from datetime import datetime
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.db import get_pool


def _to_date(s: str | None):
    """Converte string ISO (com ou sem hora) para date."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:19]).date()
    except (ValueError, TypeError):
        return None


def _to_dt(s: str | None):
    """Converte string ISO para datetime."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s[:19])
    except (ValueError, TypeError):
        return None

BASE_URL = "https://dadosabertos.camara.leg.br/api/v2"
PLACAR_RE = re.compile(
    r'Sim[:\s]+(\d+)[;\s]*N[ãa]o[:\s]+(\d+)[;\s]*Absten[çc][ãa]o[:\s]+(\d+)[;\s]*Total[:\s]+(\d+)',
    re.IGNORECASE,
)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
async def _get(client: httpx.AsyncClient, url: str, params: dict = None) -> dict:
    resp = await client.get(url, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


async def _fetch_deputados_cache(client: httpx.AsyncClient) -> dict[str, dict]:
    """Retorna dict {dep_id: {partido, uf}} para todos os deputados da 57ª legislatura."""
    cache: dict[str, dict] = {}
    pagina = 1
    while True:
        data = await _get(client, f"{BASE_URL}/deputados", params={
            "idLegislatura": 57, "itens": 100, "pagina": pagina, "ordenarPor": "nome",
        })
        items = data.get("dados", [])
        if not items:
            break
        for d in items:
            cache[str(d["id"])] = {"partido": d.get("siglaPartido"), "uf": d.get("siglaUf")}
        if len(items) < 100:
            break
        pagina += 1
        await asyncio.sleep(0.3)
    return cache


def _parse_placar(descricao: str) -> dict:
    m = PLACAR_RE.search(descricao or "")
    if m:
        return {
            "votos_sim": int(m.group(1)),
            "votos_nao": int(m.group(2)),
            "votos_abstencao": int(m.group(3)),
            "total_votos": int(m.group(4)),
        }
    return {}


async def enrich_all() -> dict:
    pool = await get_pool()

    rows = await pool.fetch(
        "SELECT id, fonte_id FROM proposicoes WHERE fonte = 'camara' AND orgao_atual IS NULL AND regime IS NULL ORDER BY data_apresentacao ASC"
    )
    total = len(rows)
    print(f"[enrich] {total} proposições sem enriquecimento")

    ok = erros = 0

    async with httpx.AsyncClient() as client:
        print("[enrich] Carregando cache de deputados...")
        deputados = await _fetch_deputados_cache(client)
        print(f"[enrich] {len(deputados)} deputados em cache")

        for i, row in enumerate(rows):
            prop_id = str(row["id"])
            fonte_id = row["fonte_id"]

            try:
                await asyncio.sleep(0.4)

                # 1. Detalhes completos
                det = (await _get(client, f"{BASE_URL}/proposicoes/{fonte_id}")).get("dados", {})
                status = det.get("statusProposicao") or {}
                await pool.execute("""
                    UPDATE proposicoes SET
                        situacao        = $2,
                        orgao_atual     = $3,
                        regime          = $4,
                        url_inteiro_teor = COALESCE($5, url_inteiro_teor),
                        updated_at      = NOW()
                    WHERE id = $1
                """, prop_id,
                    status.get("descricaoSituacao"),
                    status.get("siglaOrgao"),
                    status.get("regime"),
                    det.get("urlInteiroTeor"),
                )

                # 2. Tramitações (histórico completo — apaga e reinserere)
                trams = (await _get(client, f"{BASE_URL}/proposicoes/{fonte_id}/tramitacoes")).get("dados", [])
                await pool.execute("DELETE FROM tramitacoes WHERE proposicao_id = $1", prop_id)
                for t in trams:
                    await pool.execute("""
                        INSERT INTO tramitacoes (proposicao_id, data, descricao, orgao, situacao, url, fonte_id)
                        VALUES ($1,$2,$3,$4,$5,$6,$7)
                    """, prop_id,
                        _to_dt(t.get("dataHora")),
                        t.get("descricaoSituacao") or t.get("despacho") or "",
                        t.get("siglaOrgao"),
                        t.get("descricaoSituacao"),
                        t.get("url"),
                        str(t.get("sequencia", "")),
                    )

                # 3. Autores — atualiza partido/uf/url_perfil via cache de deputados
                autores = (await _get(client, f"{BASE_URL}/proposicoes/{fonte_id}/autores")).get("dados", [])
                for a in autores:
                    uri = a.get("uri", "")
                    m = re.search(r"/deputados/(\d+)", uri)
                    dep_id = m.group(1) if m else None
                    url_perfil = f"https://www.camara.leg.br/deputados/{dep_id}" if dep_id else None
                    dep_info = deputados.get(dep_id, {}) if dep_id else {}
                    await pool.execute("""
                        UPDATE proposicao_autores SET
                            fonte_id   = COALESCE($3, fonte_id),
                            url_perfil = COALESCE($4, url_perfil),
                            partido    = COALESCE($5, partido),
                            uf         = COALESCE($6, uf)
                        WHERE proposicao_id = $1 AND nome = $2
                    """, prop_id, a.get("nome", ""),
                        dep_id, url_perfil,
                        dep_info.get("partido"), dep_info.get("uf"),
                    )

                # 4. Votações + votos individuais
                votacoes = (await _get(client, f"{BASE_URL}/proposicoes/{fonte_id}/votacoes")).get("dados", [])
                for v in votacoes:
                    votacao_id = v.get("id")
                    if not votacao_id:
                        continue
                    placar = _parse_placar(v.get("descricao", ""))
                    vot_row = await pool.fetchrow("""
                        INSERT INTO votacoes (
                            proposicao_id, votacao_id, data, data_hora,
                            sigla_orgao, descricao, aprovacao,
                            votos_sim, votos_nao, votos_abstencao, total_votos
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                        ON CONFLICT (votacao_id) DO UPDATE SET
                            votos_sim       = EXCLUDED.votos_sim,
                            votos_nao       = EXCLUDED.votos_nao,
                            votos_abstencao = EXCLUDED.votos_abstencao,
                            total_votos     = EXCLUDED.total_votos
                        RETURNING id
                    """, prop_id, votacao_id,
                        _to_date(v.get("data")),
                        _to_dt(v.get("dataHoraRegistro")),
                        v.get("siglaOrgao"),
                        v.get("descricao"),
                        v.get("aprovacao"),
                        placar.get("votos_sim"),
                        placar.get("votos_nao"),
                        placar.get("votos_abstencao"),
                        placar.get("total_votos"),
                    )

                    await asyncio.sleep(0.3)
                    try:
                        votos_raw = (await _get(client, f"{BASE_URL}/votacoes/{votacao_id}/votos")).get("dados", [])
                        for voto in votos_raw:
                            dep = voto.get("deputado_") or {}
                            await pool.execute("""
                                INSERT INTO votos (votacao_id, deputado_id, deputado_nome, partido, uf, tipo_voto, data_registro)
                                VALUES ($1,$2,$3,$4,$5,$6,$7)
                                ON CONFLICT (votacao_id, deputado_id) DO NOTHING
                            """, str(vot_row["id"]),
                                str(dep.get("id", "")),
                                dep.get("nome", ""),
                                dep.get("siglaPartido"),
                                dep.get("siglaUf"),
                                voto.get("tipoVoto", ""),
                                _to_dt(voto.get("dataRegistroVoto")),
                            )
                    except Exception:
                        pass  # votos são best-effort

                ok += 1
                if (i + 1) % 100 == 0:
                    print(f"[enrich] {i + 1}/{total} — {ok} ok, {erros} erros")

            except Exception as e:
                erros += 1
                print(f"[enrich] ✗ {fonte_id}: {e}")

    print(f"[enrich] Concluído: {ok} ok, {erros} erros")
    return {"ok": ok, "erros": erros, "total": total}
