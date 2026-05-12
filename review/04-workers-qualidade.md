# 04 — Qualidade: Workers Python

> Escopo: tratamento de erros, robustez, race conditions, idempotência, lógica incompleta.
> Diretório: `/home/user/patrulheiro/workers`. Stack: Python 3.12, FastAPI, asyncpg, httpx, OpenAI.

## Sumário executivo

| Severidade | Quantidade |
|---|---|
| ALTO | 8 |
| MÉDIO | 13 |
| BAIXO | 6 |
| INFO | 3 |

Mais críticos: **(A-1)** `except Exception: pass` em pontos onde dados são silenciosamente perdidos (autores/tramitações de novas proposições da Câmara); **(A-2)** ausência de transação atômica em `enricher.py` ao reescrever histórico de tramitações; **(A-3)** falta de paginação em `_fetch_proposicoes` do Senado e da rotação `/votacao` quando a API retorna mais de uma página; **(A-4)** processamento sequencial em LLM (uma proposição por vez, com `sleep(0.5)`) gargala a esteira; **(A-5)** sem watermark/lock entre execuções concorrentes — dois `/ingest/camara` simultâneos podem duplicar trabalho.

Há também debt técnico significativa: mapas de normalização com chaves duplicadas, parsing de datas que silenciosamente quebra, código de processamento que mistura responsabilidades (`db.py` faz normalização que devia ser do classifier), `print()` em vez de logger estruturado em todos os pontos.

---

## ALTO

### A-1 — `except Exception: pass` engole erros críticos de ingestão
- **Arquivos:**
  - `workers/app/ingestion/camara.py:109-110` — após inserir proposição, tentar buscar detalhes/autores/tramitações; se qualquer chamada falhar, **toda a tripla é abandonada silenciosamente**:
    ```python
    try:
        detalhes = await _fetch_detalhes(client, raw["id"])
        autores_raw = await _fetch_autores(client, raw["id"])
        tramitacoes_raw = await _fetch_tramitacoes(client, raw["id"])
        ...
    except Exception:
        pass
    ```
  - `workers/app/ingestion/dou.py:212-213` — falha ao inserir ato irrelevante simplesmente ignora.
  - `workers/app/ingestion/enricher.py:200-201` — falha em buscar votos individuais é `pass`. Comentário diz "votos são best-effort" mas não há telemetria, nem retry separado.
  - `workers/app/ingestion/senado.py:101-102,117-118,139-140` — `_fetch_situacao`, `_fetch_autores`, `_fetch_tramitacoes` retornam `{}` ou `[]` em qualquer erro.
- **Problema:** se a API da Câmara cair por 5 minutos durante uma ingestão de 1000 proposições, todas as 1000 ficam sem autores/tramitações e ninguém é avisado. Não há tabela `ingest_errors` para reprocessamento posterior. Cada execução é destrutiva nesse sentido.
- **Recomendação:**
  - Logar com nível ERROR e capturar exception type/message.
  - Marcar a proposição com `enrich_pending=TRUE` no banco para retry futuro.
  - Sentry / equivalente.

### A-2 — `enricher.py` apaga `tramitacoes` antes de re-inserir, fora de transação
- **Arquivo:** `workers/app/ingestion/enricher.py:117-130`
- Já documentado em `02-seguranca-workers.md` A-6. Repete aqui pela perspectiva de qualidade: este é o pior cenário de data loss silencioso.
- **Recomendação:** ver A-6 do 02.

### A-3 — Paginação não-implementada na ingestão do Senado
- **Arquivo:** `workers/app/ingestion/senado.py:57-69`
  ```python
  data = await _get(client, f"{BASE_URL}/processo", params={"ano": ano, "tramitando": "S", "itens": 500})
  ```
- **Problema:** uma única chamada com `itens=500`. Se houver >500 matérias tramitando no ano, **o resto é silenciosamente perdido**. Não há loop `while True`. Comparar com a Câmara (`camara.py:30-45`) que faz paginação correta.
- O agente que escreveu `08-integracoes-externas.md` já apontou isto também.
- **Recomendação:** loop por página até `len(items) < 500`.

### A-4 — Pipeline de processing LLM puramente serial, sem batching
- **Arquivos:**
  - `workers/app/main.py:212-269` — `_process_pending` e `_process_dou_pending` iteram proposições uma a uma, fazem `classificar → sleep(0.5) → alinhamento → sleep(0.5)` em série.
- **Problema:** a ~5s/proposição com sleeps + 2 chamadas LLM, 1000 proposições levam ~80 minutos. Pior: cada chamada LLM bloqueia o event loop **da task** mas não há paralelismo. Não há prompt caching (modelo `gpt-4.1-nano` recebe a mesma SYSTEM prompt grande toda vez).
- **Recomendação:**
  - Usar `asyncio.gather` com `Semaphore(5)`.
  - Adicionar prompt caching (Anthropic) ou batches OpenAI.
  - Reduzir `sleep` ou removê-lo (httpx já tem timeout).

### A-5 — Sem lock entre ingestões concorrentes
- **Arquivo:** `workers/app/main.py:44-54,62-66,68-77` — endpoints `/ingest/*` simplesmente disparam BackgroundTasks. Se chamados duas vezes, dois jobs rodam em paralelo.
- **Problema:** dois `/ingest/camara` simultâneos consomem cota de API da Câmara em dobro, podem fazer UPSERT no mesmo registro em race, e duplicar autores (linhas 138-152 do `db.py` fazem `DELETE WHERE proposicao_id = $1` seguido de inserts — sem transação, segunda corrida pode apagar inserts da primeira).
- **Recomendação:** lock em `sync_control` (advisory lock do Postgres `pg_try_advisory_lock`) ou Redis SETNX.

### A-6 — `_run_*_historico` em `main.py` itera décadas sem verificar se já existe
- **Arquivos:** `workers/app/main.py:74-77,104-107,150-162,180-192`.
- **Problema:** disparar `/ingest/camara-votacoes-historico?ano_inicio=2010&ano_fim=2026` faz 17 anos × 2 semestres = 34 chamadas pesadas. Cada uma se baseia em paginação completa. Não há checkpoint nem retomada parcial — se cair na metade, recomeça do zero.
- **Recomendação:** salvar progresso em `sync_control` por ano+semestre. Permitir resume.

### A-7 — `_run_senado_votacoes_historico` usa `__import__("asyncio").sleep` em vez do `asyncio` já importado
- **Arquivo:** `workers/app/main.py:191`
  ```python
  await __import__("asyncio").sleep(2)
  ```
- **Problema:** `asyncio` já está importado no topo (`main.py:1`). Esse é um cheiro de copy-paste e debug deixado pra trás. Não quebra mas é uma red flag de revisão de código.
- **Recomendação:** `await asyncio.sleep(2)` direto.

### A-8 — Auth INLABS quebra silenciosamente entre seções DO1/DO2/DO3
- **Arquivo:** `workers/app/ingestion/dou.py:75-90`
- Já documentado no relatório `08-integracoes-externas.md` (auditoria que rodou). Cookie pode expirar entre seções, `_download_secao` retorna `None`, sem alerta ou re-login.
- **Recomendação:** re-login em caso de `content-type: text/html` (sinal de redirect ao login).

---

## MÉDIO

### M-1 — Funções `_to_dt` / `_to_date` duplicadas em 4+ arquivos
- `workers/app/ingestion/senado.py:32-47`
- `workers/app/ingestion/enricher.py:10-27`
- `workers/app/ingestion/enricher_camara_votos.py:22-28`
- `workers/app/ingestion/enricher_camara_votacoes.py:33-39`
- `workers/app/ingestion/enricher_senado_votacoes.py:26-34` (com bug, ver M-6 de `02`)
- **Recomendação:** mover para `workers/app/utils/datetime.py`.

### M-2 — `IngestResult` não inclui `mensagem` específica em falha por proposição
- **Arquivo:** `workers/app/models/schemas.py:38-43`. O campo `mensagem` é único agregado. Erros por item são apenas contados em `erros`.
- **Recomendação:** adicionar `errors: list[dict]` opcional para debug.

### M-3 — `update_classificacao` em `db.py` mistura responsabilidades
- **Arquivo:** `workers/app/db.py:77-103`.
- **Problema:** o banco normaliza typos do LLM ("medio", "mediano", "alta" → "media"). Isso devia ser feito no `classifier.py` ou em uma camada de validação Pydantic. Misturar normalização com persistência:
  1. Mascarar bugs do LLM (dificulta detectar prompt drift);
  2. Imposibilita auditoria do raw output;
  3. Acumular casos novos é manual.
- **Recomendação:** mover mapeamentos para `processing/normalize_llm.py` e usar Pydantic Literal.

### M-4 — `update_classificacao` tem duplicate keys em dict
- **Arquivo:** `workers/app/db.py:95-97,99-101`. Dois `"alto": "alta"`, `"medio": "media"` repetidos. Já documentado em 02-M-5.

### M-5 — `db.py:get_posicoes_partido` retorna string vazia se tabela vazia
- **Arquivo:** `workers/app/db.py:168-183`. Se sem posições, `alignment.analisar_alinhamento` linha 38-39 retorna `{}` e a proposição NÃO é marcada como `processado=TRUE`. Fica para sempre no estado pendente.
- **Recomendação:** logar warning explícito e marcar `processado=TRUE` com `alinhamento=NULL` para parar o loop.

### M-6 — Pipeline DOU em `main.py:212-244` chama `embed_dou_ato` em try/except aninhado dentro do outer try
- **Problema:** se `classificar_dou_ato` falhar, `analisar_alinhamento_dou` não é chamado, mas o `try/except` outer captura tudo e dá `print` apenas. Não há `processado_classificacao=TRUE/FALSE` separado.

### M-7 — `alerter.py:23` parse `score` com `float(... or 0)`, sem tratar None vs invalid
- Se `alinhamento_score` for `"abc"` no banco (improvável, é NUMERIC), `float()` lança TypeError. Defesa em profundidade.

### M-8 — `embedder.py:18-22` chunking não respeita boundaries de sentença
- `text[start:end]` pode cortar palavra/frase no meio, degradando embeddings.
- **Recomendação:** chunkar por sentença/parágrafo com `langchain.text_splitter` ou simples regex.

### M-9 — `check_tramitacoes.py` não filtra tramitações antigas marcadas como `created_at > last_notif`
- **Arquivo:** `workers/app/jobs/check_tramitacoes.py:35-41`.
- **Problema:** `created_at > ultima` cobre criação no banco, não a data real da tramitação. Se `enricher.py` re-popular tramitações antigas (linha 118 do enricher faz DELETE + INSERT), todas viram "novas" pela `created_at` reinsertado. Notificações em massa de tramitações antigas.
- **Recomendação:** filtrar por `data > ultima` (data real da tramitação) ou rastrear `fonte_id` da última notificada.

### M-10 — `alerter.py:8-9` regra "ambiguo + impacto_alto → alta" não considera score
- Pode gerar muitos falsos positivos. Adicionar gate por confiança.

### M-11 — Não há `unsubscribe`/limite no número de notificações criadas
- `check_tramitacoes.py:43-51` insere uma notificação por tramitação nova. Se uma proposição tiver 50 novas (lote represado), o usuário recebe 50 entradas. Sem agrupamento por dia.

### M-12 — `dou.py:_is_irrelevant` é regex grande e frágil
- Linhas 21-39. Pode haver falso negativo (ato relevante categorizado como "extrato de inexigibilidade") e falso positivo.
- **Recomendação:** medir taxa atual e considerar classificador zero-shot para essa decisão.

### M-13 — `enricher_camara_votacoes.py:229-230` fallback `dep_id = dep_nome[:50]` para evitar PK nula
- **Problema:** isso colide com PK `(votacao_id, deputado_id)` se houver dois deputados com o mesmo nome truncado. Improvável mas existe. Melhor pular voto sem id (ou logar).

---

## BAIXO

### B-1 — Logging via `print()` em 64 lugares
Sem timestamps padrão, sem níveis, sem PII redaction.

### B-2 — Imports não-utilizados em `main.py`
`from app.processing.alerter import check_dou_alerts` e `from app.processing.embedder import embed_dou_ato` são usados — OK. `Header`/`Depends` usados — OK. Verifiquei: nenhum import morto.

### B-3 — Constantes string repetidas (`'camara'`, `'senado'`) sem Enum
Aceitável.

### B-4 — `httpx.AsyncClient()` sem `base_url` configurado
Cada `_get` repete `f"{BASE_URL}/..."`. Pode usar `httpx.AsyncClient(base_url=BASE_URL)`.

### B-5 — `enricher_camara_autores.py:55-62` query `UPDATE` com subquery `SELECT id FROM proposicoes`
Roda por dep_id. Para muitos deputados, isso é O(n²). Usar JOIN.

### B-6 — Variáveis não-usadas em loops
`workers/app/ingestion/enricher.py:91` — `i` em `enumerate` só é usado para `if (i+1) % 100 == 0` (linha 204). OK.

---

## INFO

### I-1 — Idempotência via `ON CONFLICT` é o padrão consistente
Todas as inserts críticas (proposicoes, votacoes, votos, tramitacoes, embeddings) usam `ON CONFLICT (...) DO UPDATE/NOTHING`. Bem feito.

### I-2 — Retry com `tenacity` aplicado a todas chamadas `_get`
Embora a config seja agressiva (re-tenta qualquer exceção incluindo 4xx). Vide 08.

### I-3 — Schemas Pydantic em uso para `ProposicaoNormalized`, `DouAtoNormalized`, etc
Bom padrão. Apenas falta usar para output do LLM.

---

## Verificado / OK

- `httpx.AsyncClient()` sempre dentro de `async with` — não vaza conexões.
- `asyncpg.create_pool` com `min_size=2, max_size=10` — razoável.
- Sem `eval`, `exec`, `pickle`.
- Sem hardcoded paths sensíveis.

## Arquivos auditados

Idêntico à lista de `02-seguranca-workers.md`.
