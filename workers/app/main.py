import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, Header, HTTPException, Depends

from app.config import settings
from app.db import get_pool, close_pool, get_proposicoes_sem_processar
from app.ingestion.camara import ingest_camara
from app.ingestion.senado import ingest_senado
from app.ingestion.enricher import enrich_all
from app.ingestion.enricher_senado_autores import enrich_senado_autores
from app.ingestion.enricher_senado_votacoes import ingest_senado_votacoes
from app.ingestion.enricher_camara_votos import ingest_camara_votos
from app.ingestion.enricher_camara_autores import enrich_camara_autores
from app.ingestion.dou import ingest_dou
from app.jobs.check_tramitacoes import check_tramitacoes_monitoradas
from app.processing.classifier import classificar_proposicao, classificar_dou_ato
from app.processing.alignment import analisar_alinhamento, analisar_alinhamento_dou
from app.processing.alerter import check_dou_alerts
from app.processing.embedder import embed_dou_ato
from app.db import get_dou_atos_sem_processar


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    await close_pool()


app = FastAPI(title="Legislativo Workers", lifespan=lifespan)


def verify_secret(x_worker_secret: str = Header(default="")):
    if x_worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/ingest/camara", dependencies=[Depends(verify_secret)])
async def trigger_camara(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_camara)
    return {"status": "started", "job": "ingest_camara"}


@app.post("/ingest/senado", dependencies=[Depends(verify_secret)])
async def trigger_senado(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_senado)
    return {"status": "started", "job": "ingest_senado"}


@app.post("/enrich", dependencies=[Depends(verify_secret)])
async def trigger_enrich(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_enrich)
    return {"status": "started", "job": "enrich_all"}


@app.post("/enrich/senado-autores", dependencies=[Depends(verify_secret)])
async def trigger_enrich_senado_autores(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_enrich_senado_autores)
    return {"status": "started", "job": "enrich_senado_autores"}


@app.post("/ingest/senado-votacoes", dependencies=[Depends(verify_secret)])
async def trigger_senado_votacoes(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_senado_votacoes)
    return {"status": "started", "job": "ingest_senado_votacoes"}


@app.post("/ingest/senado-votacoes-historico", dependencies=[Depends(verify_secret)])
async def trigger_senado_votacoes_historico(background_tasks: BackgroundTasks, ano_inicio: int = 2023, ano_fim: int = 2025):
    background_tasks.add_task(_run_senado_votacoes_historico, ano_inicio, ano_fim)
    return {"status": "started", "job": "ingest_senado_votacoes_historico", "anos": list(range(ano_inicio, ano_fim + 1))}


@app.post("/ingest/dou", dependencies=[Depends(verify_secret)])
async def trigger_dou(background_tasks: BackgroundTasks, data: str = None):
    background_tasks.add_task(_run_dou, data)
    return {"status": "started", "job": "ingest_dou", "data": data}


@app.post("/enrich/camara-autores", dependencies=[Depends(verify_secret)])
async def trigger_enrich_camara_autores(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_enrich_camara_autores)
    return {"status": "started", "job": "enrich_camara_autores"}


@app.post("/ingest/camara-votos", dependencies=[Depends(verify_secret)])
async def trigger_camara_votos(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_camara_votos)
    return {"status": "started", "job": "ingest_camara_votos"}


@app.post("/jobs/check-tramitacoes", dependencies=[Depends(verify_secret)])
async def trigger_check_tramitacoes(background_tasks: BackgroundTasks):
    background_tasks.add_task(_check_tramitacoes)
    return {"status": "started", "job": "check_tramitacoes"}


@app.post("/process/pending", dependencies=[Depends(verify_secret)])
async def trigger_process(background_tasks: BackgroundTasks):
    background_tasks.add_task(_process_pending)
    return {"status": "started", "job": "process_pending"}


@app.post("/process/dou-pending", dependencies=[Depends(verify_secret)])
async def trigger_process_dou(background_tasks: BackgroundTasks):
    background_tasks.add_task(_process_dou_pending)
    return {"status": "started", "job": "process_dou_pending"}


async def _run_dou(data: str | None = None):
    result = await ingest_dou(data_override=data)
    print(f"[dou] {result.mensagem}")
    if result.inseridas > 0:
        await _process_dou_pending()


async def _run_enrich_camara_autores():
    result = await enrich_camara_autores()
    print(f"[camara-autores] {result}")


async def _run_camara_votos():
    result = await ingest_camara_votos()
    print(f"[camara-votos] {result}")


async def _check_tramitacoes():
    result = await check_tramitacoes_monitoradas()
    print(f"[check-tramitacoes] {result}")


async def _run_enrich_senado_autores():
    result = await enrich_senado_autores()
    print(f"[senado-autores] {result}")


async def _run_senado_votacoes():
    result = await ingest_senado_votacoes()
    print(f"[senado-votacoes] {result}")


async def _run_senado_votacoes_historico(ano_inicio: int, ano_fim: int):
    for ano in range(ano_inicio, ano_fim + 1):
        for mes_ini, mes_fim in [("01-01", "06-30"), ("07-01", "12-31")]:
            ini = f"{ano}-{mes_ini}"
            fim = f"{ano}-{mes_fim}"
            print(f"[senado-votacoes-historico] Processando {ini} → {fim}")
            try:
                result = await ingest_senado_votacoes(data_inicio_override=ini, data_fim_override=fim)
                print(f"[senado-votacoes-historico] {ini}: {result}")
            except Exception as e:
                print(f"[senado-votacoes-historico] ✗ {ini}: {e}")
            await __import__("asyncio").sleep(2)
    print(f"[senado-votacoes-historico] Concluído {ano_inicio}→{ano_fim}")


async def _run_enrich():
    result = await enrich_all()
    print(f"[enrich] {result}")


async def _run_camara():
    result = await ingest_camara()
    print(f"[camara] {result.mensagem}")
    await _process_pending()


async def _run_senado():
    result = await ingest_senado()
    print(f"[senado] {result.mensagem}")
    await _process_pending()


async def _process_dou_pending():
    atos = await get_dou_atos_sem_processar(limite=20)
    print(f"[process-dou] {len(atos)} atos para processar")
    for ato in atos:
        ato_id = str(ato["id"])
        try:
            classificacao = await classificar_dou_ato(
                ato_id,
                tipo_ato=ato["tipo_ato"],
                orgao=ato["orgao"],
                titulo=ato["titulo"],
                texto=ato["texto_completo"],
            )
            await asyncio.sleep(0.5)
            await analisar_alinhamento_dou(
                ato_id,
                tipo_ato=ato["tipo_ato"],
                orgao=ato["orgao"],
                titulo=ato["titulo"],
                temas=classificacao.get("temas_primarios", []),
                resumo=classificacao.get("resumo_executivo"),
            )
            await check_dou_alerts(ato_id)
            await asyncio.sleep(0.3)
            try:
                await embed_dou_ato(ato_id)
            except Exception as emb_err:
                print(f"[process-dou] embedding falhou {ato_id}: {emb_err}")
            print(f"[process-dou] ✓ {ato['orgao']} — {(ato['titulo'] or '')[:60]}")
        except Exception as e:
            print(f"[process-dou] ✗ {ato_id}: {e}")
        await asyncio.sleep(0.5)


async def _process_pending():
    proposicoes = await get_proposicoes_sem_processar(limite=20)
    print(f"[process] {len(proposicoes)} proposições para processar")

    for prop in proposicoes:
        prop_id = str(prop["id"])
        try:
            classificacao = await classificar_proposicao(
                prop_id,
                tipo=prop["tipo"],
                ementa=prop["ementa"],
            )
            await asyncio.sleep(0.5)
            await analisar_alinhamento(
                prop_id,
                tipo=prop["tipo"],
                ementa=prop["ementa"],
                temas=classificacao.get("temas_primarios", []),
                resumo=classificacao.get("resumo_executivo"),
            )
            print(f"[process] ✓ {prop['tipo']} {prop['numero']}/{prop['ano']}")
        except Exception as e:
            print(f"[process] ✗ {prop['tipo']} {prop['numero']}/{prop['ano']}: {e}")
        await asyncio.sleep(0.5)
