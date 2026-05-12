# Auditoria de Integrações Externas — Patrulheiro

Data: 2026-05-12
Escopo: integração com Câmara, Senado, INLABS/DOU, Anthropic/OpenAI e CDN de imagens (camara.leg.br / senado.leg.br).

---

## Sumário executivo

| # | Severidade | Tema | Arquivo:linha |
|---|---|---|---|
| 1 | ALTO | Provedor LLM divergente de CLAUDE.md (OpenAI em vez de Anthropic) | `workers/app/processing/classifier.py:2,6,45,62` ; `alignment.py:2,6,42,73` |
| 2 | ALTO | `tenacity` não trata 429/503 com `Retry-After` e re-tenta também 4xx irrecuperáveis | todos os módulos de ingestão (`camara.py:19`, `senado.py:50`, etc.) |
| 3 | ALTO | Nenhum tratamento explícito de `httpx.TimeoutException` ou `ConnectError` na retry policy — só `stop_after_attempt(3)` | mesmas refs do item 2 |
| 4 | ALTO | Paginação Senado `_fetch_proposicoes` NÃO PAGINA — apenas pega `itens=500` e termina | `workers/app/ingestion/senado.py:57-69` |
| 5 | ALTO | Paginação Senado `/votacao` NÃO PAGINA também | `workers/app/ingestion/enricher_senado_votacoes.py:51-61` |
| 6 | ALTO | Nenhum `max_concurrency` / semáforo — workflows ingerem sequencialmente, mas chamadas paralelas em ramos como `enrich_all` poderiam estourar | (estrutural, em todos os enrichers) |
| 7 | ALTO | INLABS: `_login` não trata expiração de cookie durante download (após N seções a sessão pode cair) | `workers/app/ingestion/dou.py:55-66, 180-194` |
| 8 | ALTO | INLABS: `_download_secao` usa `follow_redirects=True` mas o client é `follow_redirects=False` → comportamento inconsistente | `dou.py:78-91, 180` |
| 9 | ALTO | `_parse_xml` usa `ET.fromstring` sem tratar encoding latin-1; DOU/INLABS historicamente usa `iso-8859-1` para artigos antigos | `dou.py:97-148` |
| 10 | ALTO | `<img>` direto sem domínio whitelisted: tudo bem porque não usa `next/image`, mas perde otimização; FALTA fallback de logo de partido (passa `null` em logo 404, ok) — porém `Photo` não trata `src` vazio | `web/components/photo.tsx:20-25` |
| 11 | MÉDIO | Sem `max_tokens` em embeddings, mas há limite por chunk; CHUNK_SIZE de 1800 chars é seguro | `workers/app/processing/embedder.py:8-22` |
| 12 | MÉDIO | LLM: `max_tokens=512` pode truncar JSON em resumos longos → `json.loads` quebra sem fallback | `classifier.py:54,66` ; `alignment.py:54,84` |
| 13 | MÉDIO | `json.loads(resp.choices[0].message.content)` sem `try/except` na camada LLM — exceção sobe direto ao caller, derrubando o item do batch | `classifier.py:55,67` ; `alignment.py:56,86` |
| 14 | MÉDIO | Sem retry/backoff específico nas chamadas OpenAI: falha de rate-limit (429) interrompe um item por vez (não trava o pipeline mas perde) | `classifier.py:44-54` ; `alignment.py:41-55, 72-85` |
| 15 | MÉDIO | Sem `prompt caching` (Anthropic) e sem `seed` / determinismo configurado nas chamadas OpenAI; cada classificação gera tokens cheios | `classifier.py:44-54`, `alignment.py:41-55` |
| 16 | MÉDIO | `enricher.py:118` faz `DELETE FROM tramitacoes WHERE proposicao_id = $1` antes do INSERT → se houver falha entre DELETE e INSERT, perde histórico | `workers/app/ingestion/enricher.py:118-130` |
| 17 | MÉDIO | `_fetch_proposicoes` Câmara: condição de parada inclui `if len(items) < 100: break` ANTES de incrementar página — correto, mas falta proteção contra loop infinito em caso de bug na API | `workers/app/ingestion/camara.py:39-46` |
| 18 | MÉDIO | `_fetch_proposicoes` Senado considera apenas ano corrente + anterior; proposições antigas que retornem ao tramitar ficam fora | `workers/app/ingestion/senado.py:61-69` |
| 19 | MÉDIO | `_fetch_situacao` retorna `{}` em qualquer erro, mascarando 5xx do Senado (estado "desconhecido" silencioso) | `workers/app/ingestion/senado.py:72-102` |
| 20 | MÉDIO | `ingest_camara` loop principal usa `except Exception` swallowing — útil em desenvolvimento, perigoso em produção (engole bugs) | `camara.py:79-114` |
| 21 | MÉDIO | `set_last_sync("camara")` é chamado mesmo em sucesso parcial: se 100 proposições falharam mas 1 ok, watermark avança e elas nunca serão reprocessadas | `camara.py:116` ; `senado.py:250` |
| 22 | MÉDIO | DOU: `set_last_sync` com `status="error"` se nenhum ato encontrado — mas isso pode ser legítimo (fim de semana, feriado). Falsos positivos no widget de status | `dou.py:196-198` |
| 23 | MÉDIO | DOU: `_parse_xml` lê em `iter("article")` mas no DOU/INLABS o ATO é `article` ou pode haver `<articles><article>...`; root.iter cobre ambos — OK porém atributos podem variar (`pubName` vs `pubname`) | `dou.py:107-148` |
| 24 | MÉDIO | DOU `INSERT ... ON CONFLICT (edicao, secao, orgao, titulo)`: `titulo` pode ser NULL → conflito não dispara → duplicação | `workers/app/db.py:188-205` |
| 25 | MÉDIO | DOU: `dangerouslySetInnerHTML` (CLAUDE.md, fora deste módulo) consome `texto_completo` cru — XSS se INLABS injetar HTML malicioso (improvável mas válido) | (fora do escopo deste arquivo, mas relacionado a confiabilidade) |
| 26 | MÉDIO | `_fetch_deputados_cache` é chamado SEMPRE em `enrich_all` sem TTL — chamada extra à Câmara em cada execução | `workers/app/ingestion/enricher.py:43-60, 86-89` |
| 27 | MÉDIO | `enricher_senado_votacoes` busca TODAS as votações sem filtrar por `data_fim` quando não informado, mas a API Senado pode retornar erro 500 em janelas grandes | `enricher_senado_votacoes.py:51-61` |
| 28 | MÉDIO | `enricher_senado_votacoes.py:31` — `datetime.strptime(s[:19], fmt[:len(s[:19])])` é incorreto: trunca o format string, gerando matches falsos | `enricher_senado_votacoes.py:26-34` |
| 29 | MÉDIO | Sem timeout específico em chamadas OpenAI (httpx interno do SDK tem default, mas não há `timeout=` explícito) | `classifier.py`, `alignment.py`, `embedder.py` |
| 30 | MÉDIO | `_process_pending` busca apenas 20 itens por chamada — exige re-disparo manual; FastAPI BackgroundTasks não escala bem | `main.py:247-269` |
| 31 | BAIXO | `_get` Câmara recebe `timeout=30` no `.get()` mas o cliente `httpx.AsyncClient()` sem `Limits` nem `Transport(retries=...)` | global |
| 32 | BAIXO | `print(...)` como logging — sem nível, sem JSON estruturado, sem rotação | global |
| 33 | BAIXO | URL de foto/logo hardcoded em `photo.tsx` — se camara.leg.br renomear o caminho, quebra silenciosamente | `web/components/photo.tsx:21,33` |
| 34 | BAIXO | `Photo` cria `<img>` sem `loading="lazy"` e sem `referrerPolicy` (alguns CDNs públicos bloqueiam por Referer) | `web/components/photo.tsx:21` |
| 35 | BAIXO | Sem métricas (Prometheus / OTEL) — somente `print` e `sync_control.last_sync` | global |
| 36 | BAIXO | `requirements.txt` lista `anthropic==0.42.0` mas o pacote NÃO é importado em nenhum lugar — dead dependency | `workers/requirements.txt:7` |
| 37 | INFO | `IDENT_RE` Senado não casa `"PEC 003/2026"` com zeros à esquerda (testar) — regex `\d+` aceita, OK | `senado.py:19` |
| 38 | INFO | `_to_dt` parser de data: o regex `'^(\w+)\s+(\d+)/(\d{4})'` em `senado.py:19` casa só primeiro token; identificações como `"PL Complementar 1/2026"` não casariam (mas isso já não é tipo válido) | `senado.py:19` |

---

## Análise por API

### 1) Câmara dos Deputados — `https://dadosabertos.camara.leg.br/api/v2/`

Arquivos:
- `/home/user/patrulheiro/workers/app/ingestion/camara.py`
- `/home/user/patrulheiro/workers/app/ingestion/enricher.py`
- `/home/user/patrulheiro/workers/app/ingestion/enricher_camara_autores.py`
- `/home/user/patrulheiro/workers/app/ingestion/enricher_camara_votacoes.py`
- `/home/user/patrulheiro/workers/app/ingestion/enricher_camara_votos.py`

#### 1.1 Resiliência HTTP

- **Timeout:** `timeout=30` em todos os `_get` (camara.py:21, enricher.py:38, etc.). Falta `timeout` no read/connect separadamente — em redes lentas, conexão demorada pode esgotar.
- **Retry:** `@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))` — tentenacy padrão re-tenta QUALQUER exceção, incluindo `HTTPStatusError(404)` (que vem de `raise_for_status()`). Re-tentar 404 desperdiça quota.
- **Sem tratamento de 429 `Retry-After`:** tenacity `wait_exponential(min=1, max=10)` ignora cabeçalho — pode bater 429 em ~3s repetidamente. CENÁRIO: Câmara rate-limits, worker fica reciclando 3x e desiste, marcando `error` no `sync_control`. Próxima execução repete.
- **Sem distinção 5xx vs 4xx:** o decorator não tem `retry=retry_if_exception_type(...)`. 401/403/404 sobem para o caller e o `try/except Exception` engole.
- **Sem semáforo:** todos os enrichers iteram sequencialmente com `sleep(0.3)`. Bom para rate-limit, ruim para tempo de execução.

**Recomendação:**

```python
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

def _should_retry(exc):
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 500, 502, 503, 504)
    return isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError))

@retry(stop=stop_after_attempt(5),
       wait=wait_exponential(min=2, max=60),
       retry=retry_if_exception(_should_retry))
async def _get(...):
    resp = await client.get(...)
    if resp.status_code == 429:
        retry_after = float(resp.headers.get("Retry-After", "5"))
        await asyncio.sleep(retry_after)
        resp.raise_for_status()
    resp.raise_for_status()
    return resp.json()
```

#### 1.2 Paginação

`camara.py:26-47` itera por `pagina += 1` até `len(items) < 100`. Correto. Risco baixo: se a API repetir página, loop infinito (sem `max_paginas`).

`enricher_camara_votacoes.py:120-253` itera por `pagina` checando `links rel=next` E `len < 200`. Correto, mas critério duplo é defensivo.

`enricher_camara_autores.py:25-78` NÃO paginação — busca um único `dep_id` por chamada (correto, endpoint singleton).

#### 1.3 Schema drift

Não há `model_validate`/Pydantic na resposta da API. Tudo é `dict.get()` com fallback. **Pró:** resiliente a campos novos. **Contra:** se a Câmara renomear `siglaPartido` → `partido`, código silenciosamente perde a info.

`enricher.py:155-157` checa `votacao_id = v.get("id")` sem validar tipo. Se vier string em vez de int, o ON CONFLICT pode comportar diferente.

#### 1.4 Idempotência

- `proposicoes`: UNIQUE em `(fonte, tipo, numero, ano)` + `ON CONFLICT DO UPDATE` em `db.py:62-66`. OK.
- `votacoes`: UNIQUE em `votacao_id`, com `ON CONFLICT DO UPDATE` em `enricher.py:165-170`. OK.
- `votos`: UNIQUE em `(votacao_id, deputado_id)` + `DO NOTHING`. OK.
- `tramitacoes`: `DELETE WHERE proposicao_id` + `INSERT` em `enricher.py:118-130` → **não-atômico**, perde histórico se erro entre DELETE e INSERT.

**Recomendação:** envolver DELETE+INSERTs em `async with pool.transaction():` ou usar UPSERT por `(proposicao_id, fonte_id)`.

#### 1.5 Watermark `set_last_sync`

`camara.py:116`: `set_last_sync("camara", records=...)` é chamado sempre. Se 5 proposições falharam no enriquecimento, mesmo assim o watermark avança. Próximo run busca a partir de hoje e perde as 5.

**Recomendação:** só avançar `last_sync` para a maior `data_apresentacao` realmente persistida com sucesso.

---

### 2) Senado Federal — `https://legis.senado.leg.br/dadosabertos/`

Arquivos:
- `/home/user/patrulheiro/workers/app/ingestion/senado.py`
- `/home/user/patrulheiro/workers/app/ingestion/enricher_senado_autores.py`
- `/home/user/patrulheiro/workers/app/ingestion/enricher_senado_votacoes.py`

#### 2.1 Paginação — BUG ALTO

`senado.py:57-69`: `_fetch_proposicoes` faz UMA chamada por ano com `itens=500`. **Não pagina**. Se o Senado retornar 500 itens, há fortes chances de existirem mais. CENÁRIO: 600 proposições em 2026 → 100 ficam para trás na ingestão.

`enricher_senado_votacoes.py:51-61`: idem — `_get(/votacao?dataInicio=...)` única chamada. API pode limitar a janela ou paginar via query param que não está sendo enviado.

**Recomendação:** investigar paginação real da API do Senado (geralmente usa `inicio`/`fim` em intervalos menores).

#### 2.2 Schema drift / parsing

`senado.py:80-102` navega árvore JSON `data.get("SituacaoAtualMateria", {}).get("Materias", {}).get("Materia", [])` — Senado API retorna ora dict (1 item), ora list (N itens). Há `if isinstance(materias, dict): materias = [materias]` — bem tratado.

Porém em `_fetch_tramitacoes` (senado.py:121-140) e `_fetch_autores` (senado.py:105-118), o `except Exception` no `try` engole tudo silenciosamente. Não loga nada → debugging impossível.

**Recomendação:** logar com `print(f"[senado-fetch-x] erro={e}")` ao menos.

#### 2.3 Data parsing falho

`enricher_senado_votacoes.py:26-34`:
```python
def _to_dt(s):
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:19], fmt[:len(s[:19])])
        except ValueError:
            continue
```

**Bug:** `fmt[:len(s[:19])]` trunca o formato baseado no tamanho do input — se `s="2026-01-15"` (10 chars), o formato `"%Y-%m-%dT%H:%M:%S"` é cortado para `"%Y-%m-%dT"` que dá erro. O `for` continua, OK por acaso, mas o segundo formato `"%d/%m/%Y %H:%M:%S"` também é truncado e pode dar match espúrio. CENÁRIO: data 2026-01-15 parseada como 26-01-15 em formato dd/mm/yy.

**Recomendação:** simplificar para tentar cada formato cheio.

#### 2.4 Watermark — janela só de 2 anos

`senado.py:59-62`:
```python
anos = {ano_inicio, ano_inicio - 1} if ano_inicio > 2020 else {ano_inicio}
```

Proposições de 2023 que ainda tramitam em 2026 não serão pegas. CENÁRIO: PEC apresentada em 2022 e ainda em comissão hoje fica fora da lista.

#### 2.5 Resiliência HTTP

Mesmas notas do item 1.1. Acrescenta: `_fetch_situacao` `_fetch_autores` `_fetch_tramitacoes` retornam `{}` ou `[]` em qualquer erro → erros 500 do Senado são mascarados, dados de proposições fica `situacao=None, orgao_atual=None` sem registro do problema.

---

### 3) INLABS / DOU — `https://inlabs.in.gov.br`

Arquivo: `/home/user/patrulheiro/workers/app/ingestion/dou.py`

#### 3.1 Autenticação (cookie via `logar.php`)

`dou.py:55-66`:
```python
async def _login(client):
    resp = await client.post(f"{INLABS_BASE}/logar.php",
        data={"email": ..., "password": ...}, timeout=30)
    if resp.status_code not in (200, 302): raise
    if "inlabs_session_cookie" not in dict(client.cookies): raise
```

**Issues:**
- **Cookie reuse:** Login é feito uma vez em `ingest_dou` (linha 182). Se o cookie expirar durante o download das 5 seções (que podem demorar minutos para arquivos grandes), as próximas seções vão receber HTML de login. O check `content_type.startswith("text/html")` em `_download_secao` retorna `None` silenciosamente → seção é "pulada" sem aviso. CENÁRIO: DOU edição grande, login expira no DO2, perde DO2/DO3 silenciosamente.
- **Sem retry de login** em caso de expiração — falta `_login_if_expired(client)` wrapper.
- **Credenciais hardcoded como string vazia** em config (`inlabs_user: str = ""`): se não setado em produção, login falha silenciosamente em `dict(client.cookies)` (cookie não vem) e dispara exceção genérica.

**Recomendação:**
```python
async def _download_secao(client, data_str, secao):
    resp = await client.get(...)
    if resp.headers.get("content-type", "").startswith("text/html"):
        # pode ser página de login (cookie expirado) ou seção inexistente
        if b"<form" in resp.content[:500] and b"logar" in resp.content[:1000]:
            await _login(client)
            resp = await client.get(...)  # retry
            if resp.headers.get("content-type", "").startswith("text/html"):
                return None
        else:
            return None
    ...
```

#### 3.2 `follow_redirects` inconsistente

`dou.py:180`: `httpx.AsyncClient(follow_redirects=False)` — global.
`dou.py:78-83`: `_download_secao(...)` chama `client.get(..., follow_redirects=True)` — sobrescreve por chamada.

OK para download (que pode redirecionar para URL final). Mas o login (`_login`, linha 57) com `follow_redirects=False` espera 302 — se INLABS um dia mudar para 303 ou retornar 200 com Set-Cookie no JSON, falha.

#### 3.3 Encoding XML

`dou.py:97-148`: `ET.fromstring(xml_bytes)` confia no header XML interno. DOU/INLABS historicamente usa `<?xml version="1.0" encoding="ISO-8859-1"?>` em arquivos antigos. ElementTree honra o header — OK.

Porém, remove apenas BOM UTF-8 (`b"\xef\xbb\xbf"`). Se o XML vier sem header e for latin-1, `fromstring` assume UTF-8 e quebra caracteres acentuados (`ç`, `ã`). CENÁRIO: arquivo legado do INLABS sem header XML, parsing falha em `ç` retornando bytes inválidos.

**Recomendação:**
```python
try:
    root = ET.fromstring(xml_bytes)
except ET.ParseError:
    # tenta latin-1
    try:
        root = ET.fromstring(xml_bytes.decode("latin-1").encode("utf-8"))
    except Exception:
        return atos
```

#### 3.4 Parser por atributos

`dou.py:107-148`: usa `elem.attrib` para `pubName`, `numberPage`, `artType`, `artCategory`. CLAUDE.md confirma "Parser XML via atributos". 

`secao` é extraído de `pubName` (`"DO1"` → `"1"`, `"DO1E"` → `"1E"`). Linha 112: `secao = re.sub(r"^DO", "", secao_raw).strip() or "1"`. **Bug menor:** se `pubName="DO1-Extra"`, vira `"1-Extra"`. Inconsistente com o set `_SECOES = ["DO1", "DO1E", ...]`.

`titulo` é extraído de `_cdata("Identifica") or _cdata("Titulo") or _cdata("Ementa")`. Bom — múltiplos fallbacks.

#### 3.5 Conflito UPSERT com NULL

`db.py:188-205`:
```python
ON CONFLICT (edicao, secao, orgao, titulo) DO NOTHING
```

PostgreSQL trata `NULL` como distinto em UNIQUE por default (a menos que use `NULLS NOT DISTINCT`, PG 15+). Se `titulo` ou `orgao` for `NULL`, dois atos diferentes com mesmo NULL+NULL conflictam? **Não** — eles são considerados distintos → duplicação. CENÁRIO: dois atos com `orgao=NULL` na mesma edição → ambos inseridos.

#### 3.6 `_is_irrelevant` regex amplo

`dou.py:21-39`: regex grande, multi-alternativas, pode marcar como irrelevante coisas relevantes (ex: portaria sobre "férias" pode ser uma lei sobre férias). Custo: filtra antes do LLM, economiza tokens. Risco: falsos negativos no monitoramento.

#### 3.7 Sem retry em `_download_secao`

`_download_secao` NÃO tem decorator `@retry`. Se ZIP grande sofrer reset de conexão, falha sem retentar. Apenas o `for secao` envolto em `try/except` (linha 189-194) loga e continua.

---

### 4) LLM (CLAUDE.md diz Anthropic; código usa OpenAI)

Arquivos:
- `/home/user/patrulheiro/workers/app/processing/classifier.py`
- `/home/user/patrulheiro/workers/app/processing/alignment.py`
- `/home/user/patrulheiro/workers/app/processing/embedder.py`

#### 4.1 ALTO — Divergência fundamental com a documentação

CLAUDE.md afirma:
> classificação e análise de alinhamento via `anthropic 0.42` (Claude Haiku para classifier, Sonnet para alignment)

Mas o código importa `AsyncOpenAI` e usa `model="gpt-4.1-nano"` em ambos os pipelines. `anthropic_api_key` está em config mas nunca é usado.

CENÁRIO: time tem chave Anthropic configurada esperando que o código a use; produção dispara chamadas a OpenAI com chave OpenAI faltando ou trocada. Custos não rastreados, fatura inesperada.

**Recomendação:** decidir e:
- Atualizar CLAUDE.md para refletir uso de OpenAI; OU
- Migrar código para Anthropic conforme documentação (`anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)` com `claude-haiku-4-5`/`claude-sonnet-4-5`).

#### 4.2 Sem retry, sem timeout, sem rate-limit handling

`classifier.py:44-54`:
```python
resp = await _client.chat.completions.create(
    model="gpt-4.1-nano",
    messages=[...],
    response_format={"type": "json_object"},
    max_tokens=512,
)
```

- Sem `timeout=...` (OpenAI SDK default = 600s, demasiado longo).
- Sem retry com backoff para 429 Tier-1.
- Sem `try/except` ao redor de `json.loads(resp.choices[0].message.content)` — se modelo retornar texto malformado (raro com `json_object` mode, mas possível com `max_tokens=512` truncado), exceção sobe e item falha.

CENÁRIO: classificação de proposição longa com resumo extenso bate `max_tokens=512`, JSON corta no meio, `json.loads` quebra, item marcado como falha eterna (processado=FALSE).

**Recomendação:** wrap em tenacity para 429 + try/except em `json.loads` com fallback `{"erro": "json_parse_failed"}`.

#### 4.3 Sem prompt caching

OpenAI tem prompt caching automático para prompts > 1024 tokens. O prompt SYSTEM em `alignment.py:8-21` é fixo + `posicoes_partido` que muda raramente. Inserir as POSIÇÕES no início (system prompt) já habilita cache implícito da OpenAI — está OK.

Se migrar para Anthropic, precisará habilitar `cache_control: {type: "ephemeral"}` nos blocos do system com posicoes_partido (estável). Sem isso, cada chamada paga tokens cheios.

#### 4.4 Limite de itens por batch

`main.py:213,247`: `get_dou_atos_sem_processar(limite=20)` e `get_proposicoes_sem_processar(limite=20)`. OK para evitar runaway costs. Porém:
- não há "stop loss" se 20/20 falharem (sem circuit breaker)
- `BackgroundTasks` do FastAPI não tem retry: se o pod cair, batch perdido

**Recomendação:** mover para fila externa (Redis/SQS) com idempotência por ato_id e processar com worker dedicado.

#### 4.5 `update_classificacao`/`update_alinhamento` map gigante

`db.py:95-103, 120-133`: hashmaps para "consertar" outputs do LLM (`"contrasario": "contrario"`, `"baja": "baixa"`). Sintoma de que o LLM retorna inconsistências → ou prompt precisa ser mais firme, ou validação pós-LLM com Pydantic faria mais sentido (rejeitar e retentar).

---

### 5) Imagens externas

Arquivo: `/home/user/patrulheiro/web/components/photo.tsx`

#### 5.1 `<img>` direto — Next.js não otimiza

`<img>` em vez de `<Image>` é decisão consciente para evitar configurar `next.config.ts` com `remotePatterns`. Trade-offs:
- (+) zero config, sem rota `/_next/image`
- (−) sem otimização, sem `srcSet`, sem `placeholder`
- (−) sem lazy loading nativo do Next (precisa adicionar `loading="lazy"` manual)
- (−) sem prefetch de domínio

`next.config.ts` está apenas com `output: "standalone"`. OK para o padrão escolhido.

#### 5.2 Fallback

`Photo` (linha 4-25): on error, mostra iniciais — bom.
`PartidoLogo` (linha 27-37): on error, retorna `null` — bom. Mas se `sigla` for `"PT"` e a Câmara nunca teve esse logo, falta caching de falhas (cada render dispara um GET 404 antes do `onError`).

#### 5.3 URL hardcoded

Linha 21: `src` vem do caller. Linha 33: `https://www.camara.leg.br/internet/Deputado/img/partidos/${sigla}.gif` — hardcoded. Se Câmara migrar para `.png`/`.svg`, quebra silenciosamente.

#### 5.4 Sem `referrerPolicy`

CDN da Câmara historicamente NÃO bloqueia hotlinking, mas se um dia bloquear, todas as fotos quebram. Adicionar `referrerPolicy="no-referrer"` melhora robustez.

---

### 6) Concorrência / Asyncio

- **Sem `asyncio.gather`:** todos os enrichers iteram com `for ... in rows:` sequencial. Não há paralelismo, então não há risco de explodir a API. Mas leva horas.
- **Sem semáforo por hostname:** se algum dia for migrado para `gather`, vai precisar de `asyncio.Semaphore(5)`.
- **`return_exceptions`:** N/A — não usa gather.
- **Sleep entre chamadas:** `await asyncio.sleep(0.3)` em vários locais. Rate limit manual. Funcional.

---

### 7) Logs e métricas

Apenas `print(...)` espalhado. CENÁRIO em produção:
- Sem `logging.Logger`, sem nível, sem JSON estruturado.
- Tempo de execução não é medido — não há `start = time.time()`.
- Sucesso/falha são `int += 1` mantidos em memória e printados no fim. Se o pod cair antes do fim, métricas perdem.

`sync_control` tabela registra `last_sync, status, records_synced, error_message`. É o único observability layer. Status="error" não distingue tipos de erro (rede vs schema vs auth).

**Recomendação mínima:** trocar `print` por `logging` com `%(asctime)s %(levelname)s %(name)s %(message)s` e adicionar `logger.info("camara.fetch_proposicoes", extra={"duration_ms": ..., "items": ...})`.

---

## OK / Verificado

| Tópico | Status |
|---|---|
| Câmara: paginação correta (`while True` + `len < 100`) | OK |
| Câmara: idempotência em `proposicoes` (ON CONFLICT por `fonte,tipo,numero,ano`) | OK |
| Câmara: idempotência em `votacoes` (ON CONFLICT por `votacao_id`) | OK |
| Câmara: idempotência em `votos` (ON CONFLICT por `(votacao_id, deputado_id)`) | OK |
| Câmara: timeouts configurados (30s) | OK |
| Câmara: retry (tenacity 3x exponential) — embora amplo demais | OK (parcial) |
| Senado: lidar com Materia ora dict ora list (`isinstance(x, dict): x = [x]`) | OK |
| Senado: regex `IDENT_RE` cobre `PL 199/2026` e `PEC 3/2026` | OK |
| Senado: idempotência em proposições (mesmas regras) | OK |
| Senado: `_fetch_situacao` retorna fallback `{}` (não trava pipeline) | OK (mas mascarado) |
| INLABS: cookie-based auth via `logar.php` (alinhado a CLAUDE.md) | OK |
| INLABS: download por seção `DO1`, `DO1E`, `DO2`, `DO2E`, `DO3` | OK |
| INLABS: parser XML via atributos (`pubName`, `numberPage`, `artType`) | OK (CLAUDE.md confirma) |
| INLABS: BOM UTF-8 removido | OK |
| INLABS: extração de ZIP com fallback para XML direto | OK |
| DOU: filtro de relevância pré-IA (`_is_irrelevant`) economiza tokens | OK |
| DOU: `dou_atos.relevante` flag separa atos filtrados de processáveis | OK |
| Web: `Photo` com fallback de iniciais em `onError` | OK |
| Web: `PartidoLogo` retorna `null` em erro | OK |
| `Photo`/`PartidoLogo` marcados como `"use client"` (corretos para useState) | OK |
| `next.config.ts` minimal — não precisa de `remotePatterns` por usar `<img>` | OK |
| LLM: `response_format={"type": "json_object"}` reduz risco de output não-JSON | OK |
| LLM: `max_tokens=512` limita custo | OK (mas pode truncar) |
| LLM: `_process_pending` limite 20 itens | OK (controle de custo) |
| `sync_control` + `set_last_sync` rastreia execuções | OK (parcial) |
| `dou_atos` tem `processado` boolean para idempotência de processamento | OK |
| `tramitacoes` UPSERT por `(proposicao_id, fonte_id)` | OK |
| FastAPI endpoints protegidos por `X-Worker-Secret` header | OK |
| `embed_dou_ato`: chunks de 1800 chars com overlap 200 | OK |
| `embeddings` ON CONFLICT DO NOTHING | OK |
| `proposicao_autores` DELETE + INSERT em `insert_autores` (db.py:138-153) | OK (mas non-atomic — ver item 16) |

---

## Recomendações priorizadas

1. **Decidir provedor LLM** e alinhar código com CLAUDE.md (ALTO).
2. **Trocar tenacity para retry condicional** (apenas 429/5xx + erros de rede), com respeito a `Retry-After` (ALTO).
3. **Implementar paginação real para Senado** (`_fetch_proposicoes`, `_fetch_votacoes`) (ALTO).
4. **Auto-relogin INLABS** quando download retornar HTML (ALTO).
5. **Atomicidade `DELETE tramitacoes`+ INSERT** com transaction (MÉDIO).
6. **Watermark `set_last_sync` baseado em data real persistida** (MÉDIO).
7. **`try/except json.loads`** em classifier/alignment com retry/dead-letter (MÉDIO).
8. **Logging estruturado** + métricas (MÉDIO).
9. **Bug `_to_dt` em enricher_senado_votacoes** (MÉDIO).
10. **UNIQUE `dou_atos` com `NULLS NOT DISTINCT`** ou colunas NOT NULL (MÉDIO).
