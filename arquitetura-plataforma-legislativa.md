# Plataforma de Inteligência Legislativa — Documento de Arquitetura

> **Versão:** 2.0
> **Data:** 2026-03-19
> **Autor:** Data4ward
> **Status:** Ativo
> **Cliente:** Partido Liberal

---

## 1. Visão geral

### 1.1 Objetivo

Plataforma de monitoramento e análise legislativa que permite ao partido:

- **Monitorar** projetos de lei em tempo real (Câmara e Senado) em qualquer status de tramitação
- **Classificar automaticamente** proposições como favoráveis, contrárias, neutras ou ambíguas em relação às posições do partido
- **Alertar** assessores e liderança sobre proposições críticas
- **Acompanhar tramitações** de proposições específicas via sistema de monitoramento com inbox de notificações
- **Analisar votações nominais** com orientação da bancada PL e votos individuais

### 1.2 Público-alvo

- Assessores parlamentares do partido
- Liderança partidária (bancada, presidente, secretário-geral)
- Equipe jurídica / consultoria legislativa

### 1.3 Premissas

- Volume atual: ~6.000+ proposições monitoradas (Câmara + Senado, jan–mar 2026)
- Usuários simultâneos: 10–50
- Dados públicos — todas as fontes são abertas e gratuitas
- Foco federal (Câmara + Senado), com DOU previsto para fase seguinte

---

## 2. Stack tecnológico

| Camada | Tecnologia | Observação |
|---|---|---|
| Frontend | **Next.js 15** (App Router) | SSR, Server Actions, Server Components |
| Backend / Workers | **Python FastAPI** | Jobs de ingestão e processamento |
| Infraestrutura | **VPS dedicada** | Dois containers Docker: `web` e `workers` |
| DNS / Proxy / CDN | **Cloudflare** | Proxy reverso, SSL, proteção DDoS |
| Banco de dados | **PostgreSQL + pgvector** | Na VPS — asyncpg nos workers, pg no frontend |
| Cache / filas | **Redis** | Na VPS — opcional, previsto para evolução |
| IA / LLM | **Claude API** (Anthropic) | Sonnet para alinhamento; GPT-4.1-nano para classificação |
| Storage de arquivos | **Cloudflare R2** | PDFs de inteiro teor (previsto — DAT-116) |
| E-mail / alertas | **Resend** | Previsto — ainda não ativo |

> **Nota:** O projeto **não usa Supabase, Vercel nem Railway**. Toda a infraestrutura roda em VPS própria com Docker, atrás do Cloudflare.

### 2.1 Decisões arquiteturais

**Por que VPS em vez de cloud gerenciada?**
Custo previsível, sem lock-in, controle total sobre dados sensíveis do partido. Cloudflare cuida de SSL, CDN e proteção sem overhead operacional.

**Por que dois containers separados?**
`web` (Next.js) e `workers` (FastAPI) têm ciclos de deploy e requisitos de recursos diferentes. Separados é mais fácil escalar e reiniciar independentemente.

**Por que sem fila Redis/BullMQ por enquanto?**
O volume atual (~400 proposições/mês) é gerenciado com `BackgroundTasks` do FastAPI sem necessidade de fila distribuída. Redis está na VPS e pronto para uso quando o volume justificar.

**Por que autenticação por senha única?**
MVP interno — usuários são assessores do partido. JWT assinado com `SESSION_SECRET`, cookie `pl_session`, 7 dias de validade. Sem tabela de usuários.

---

## 3. Fontes de dados

### 3.1 API Dados Abertos da Câmara dos Deputados

- **Base URL:** `https://dadosabertos.camara.leg.br/api/v2`
- **Formato:** REST / JSON
- **Autenticação:** Nenhuma
- **Rate limit:** ~1 req/s respeitado

| Endpoint | Uso |
|---|---|
| `GET /proposicoes` | Listar proposições com filtros (tipo, data) |
| `GET /proposicoes/{id}` | Detalhes de uma proposição |
| `GET /proposicoes/{id}/tramitacoes` | Histórico de tramitação |
| `GET /proposicoes/{id}/autores` | Autores da proposição |
| `GET /votacoes/{id}/votos` | Votos individuais |

- **Tipos monitorados:** PL, PEC, PLP, MPV, PDL, PRC
- **dataInicio padrão:** 2026-01-01 (filtra por última atualização, não por apresentação)

### 3.2 API Dados Abertos do Senado Federal

- **Base URL:** `https://legis.senado.leg.br/dadosabertos`
- **Formato:** REST / JSON (header `Accept: application/json`)
- **Swagger:** `https://legis.senado.leg.br/dadosabertos/api-docs/swagger-ui/index.html`
- **Spec completa:** `GET /dadosabertos/v3/api-docs`

| Endpoint | Uso | Status |
|---|---|---|
| `GET /processo` | Listar matérias por período | Ativo — ingestão principal |
| `GET /processo/{id}` | Detalhes e tramitações de uma matéria | Ativo |
| `GET /materia/autoria/{codigo}` | Autores de uma matéria | Ativo (deprecado mas funcional) |
| `GET /votacao` | Votações nominais com votos individuais | Ativo |
| `GET /plenario/votacao/orientacaoBancada/{ini}/{fim}` | Orientações por partido | Ativo |
| `GET /senador/lista/atual` | Lista de senadores com partido/UF | Ativo |

> **Atenção:** Os endpoints `/materia/votacoes`, `/materia/relatorias` foram desativados em 2026-02-01. Usar os novos equivalentes acima.

### 3.3 DOU — Diário Oficial da União (previsto)

- **INLABS** (`inlabs.in.gov.br`): XMLs diários completos — cadastro necessário (gratuito)
- **API Imprensa Nacional**: busca por palavra-chave — sem documentação oficial (ver projeto Ro-DOU)
- **Credenciais INLABS** já configuradas no `.env` (`INLABS_USER`, `INLABS_PASSWORD`)

### 3.4 Fontes futuras

- **LexML** (`lexml.gov.br/busca/SRU`): legislação correlata em outras esferas
- **Querido Diário** (OKBR): diários municipais
- **Gastos de Senadores** (`docs.apis.codante.io/gastos-senadores`): dashboard complementar

---

## 4. Arquitetura de ingestão

### 4.1 Fluxo geral

```
Vercel Cron (trigger HTTP)
    │
    ▼
Railway Workers (Python/FastAPI)
    │
    ├── POST /ingest/camara          → API Câmara → normaliza → PostgreSQL
    ├── POST /ingest/senado          → API Senado → normaliza → PostgreSQL
    ├── POST /enrich                 → Enriquece tramitações/situação (Câmara)
    ├── POST /enrich/senado-autores  → Backfill autores Senado com partido/UF
    ├── POST /ingest/senado-votacoes → Votações nominais + orientação PL
    ├── POST /process/pending        → Classificação + alinhamento (Claude)
    └── POST /jobs/check-tramitacoes → Notificações para proposições monitoradas
```

### 4.2 Estrutura do projeto workers

```
workers/
├── app/
│   ├── main.py                          # FastAPI app, endpoints, BackgroundTasks
│   ├── config.py                        # Pydantic Settings (env vars)
│   ├── db.py                            # asyncpg pool, funções de acesso ao banco
│   ├── ingestion/
│   │   ├── camara.py                    # Ingestão de proposições da Câmara
│   │   ├── senado.py                    # Ingestão de proposições do Senado
│   │   ├── enricher.py                  # Enriquecimento Câmara (tramitações, situação)
│   │   ├── enricher_senado_autores.py   # Backfill autores do Senado
│   │   ├── enricher_senado_votacoes.py  # Votações nominais do Senado
│   │   └── normalizer.py                # Schema unificado
│   ├── processing/
│   │   ├── classifier.py                # Classificação temática (Claude Haiku)
│   │   └── alignment.py                 # Análise de alinhamento (Claude Sonnet)
│   ├── jobs/
│   │   └── check_tramitacoes.py         # Notificações de tramitações monitoradas
│   └── models/
│       └── schemas.py                   # Pydantic models (ProposicaoNormalized, etc.)
├── requirements.txt
├── Dockerfile
└── .env
```

### 4.3 Lógica de ingestão incremental

Cada worker mantém um cursor em `sync_control`:

```python
last_sync = await get_last_sync("camara")       # busca último timestamp
data_inicio = last_sync[:10] if last_sync else "2026-01-01"

# Câmara: filtra por dataInicio (= última atualização, não data de apresentação)
# Senado: filtra por dataApresentacaoInicio via /processo

await set_last_sync("camara", records=inseridas + atualizadas)
```

### 4.4 Endpoints e schedule

| Endpoint | Frequência sugerida | Descrição |
|---|---|---|
| `POST /ingest/camara` | 3x/dia | Proposições novas + atualizadas |
| `POST /ingest/senado` | 3x/dia | Matérias novas via `/processo` |
| `POST /enrich` | 2x/dia | Tramitações e situação (Câmara) |
| `POST /enrich/senado-autores` | 1x (backfill) | Partido/UF/url para autores |
| `POST /ingest/senado-votacoes` | 1x/dia | Votações nominais do Senado |
| `POST /process/pending` | Contínuo | Classifica lotes de 20 proposições |
| `POST /jobs/check-tramitacoes` | 2x/dia | Notificações para monitorados |

Autenticação: header `X-Worker-Secret` validado em todos os endpoints.

---

## 5. Processamento e enriquecimento

### 5.1 Pipeline de classificação + alinhamento

```
[Proposição inserida com processado=FALSE]
        │
        ▼
    ┌─────────────────────┐
    │ 1. CLASSIFICAÇÃO    │  Claude Haiku 4.5
    │    Temas, entidades,│  ~$0.001/proposição
    │    resumo executivo │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │ 2. ALINHAMENTO      │  Claude Sonnet 4.6
    │    favoravel /      │  ~$0.01/proposição
    │    contrario /      │
    │    neutro / ambiguo │
    └─────────┬───────────┘
              │
              ▼
    [processado = TRUE]
```

### 5.2 Prompt de classificação

```python
# Claude Haiku — alto throughput, baixo custo
CLASSIFICATION_PROMPT = """
Você é um analista legislativo especializado.
Classifique a proposição abaixo extraindo informações estruturadas.

<proposicao>
Tipo: {tipo}
Ementa: {ementa}
</proposicao>

Responda APENAS com JSON válido:
{
  "temas_primarios": ["string"],      // máx 3
  "temas_secundarios": ["string"],    // máx 5
  "entidades_citadas": ["string"],
  "resumo_executivo": "string",       // 2-3 frases
  "impacto_estimado": "alto|medio|baixo",
  "urgencia": "alta|media|baixa"
}
"""
```

### 5.3 Prompt de alinhamento

```python
# Claude Sonnet — maior qualidade analítica
# O documento de posições é cacheado (prompt caching Anthropic)
ALIGNMENT_PROMPT = """
Você é um analista político especializado em análise legislativa.

<posicoes_partido>
{documento_posicoes}   ← cacheado entre chamadas
</posicoes_partido>

<proposicao>
Tipo: {tipo}
Ementa: {ementa}
Resumo: {resumo}
Temas: {temas}
</proposicao>

Responda APENAS com JSON válido:
{
  "alinhamento": "favoravel|contrario|neutro|ambiguo",
  "confianca": 0.0-1.0,
  "justificativa": "string",
  "risco_politico": "alto|medio|baixo",
  "recomendacao": "string"
}
"""
```

### 5.4 Posições do partido

Armazenadas na tabela `posicoes_partido` (6 eixos, 25 posições ativas). Editáveis via interface `/posicoes`. Cada atualização requer re-classificação de todas as proposições (`processado = FALSE`).

**Eixos atuais:** Economia e tributação, Governança e Estado, Família e costumes e valores, Segurança, Meio ambiente e agronegócio, Educação e cultura.

---

## 6. Modelo de dados (PostgreSQL)

### 6.1 Extensões

```sql
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector (busca semântica)
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- busca textual fuzzy
CREATE EXTENSION IF NOT EXISTS unaccent;  -- normalização de acentos
```

### 6.2 Schema completo

```sql
-- ============================================================
-- PROPOSIÇÕES
-- ============================================================
CREATE TABLE proposicoes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fonte             TEXT NOT NULL CHECK (fonte IN ('camara', 'senado')),
    fonte_id          TEXT NOT NULL,
    tipo              TEXT NOT NULL,        -- PL, PEC, PLP, MPV, PDL, PRC, PRS
    numero            INTEGER NOT NULL,
    ano               INTEGER NOT NULL,
    ementa            TEXT NOT NULL,
    resumo_executivo  TEXT,                 -- gerado por IA
    url_tramitacao    TEXT,
    url_inteiro_teor  TEXT,
    storage_path      TEXT,                 -- path no R2 (inteiro teor PDF)
    data_apresentacao DATE,
    situacao          TEXT,
    regime            TEXT,
    orgao_atual       TEXT,

    temas_primarios   TEXT[],
    temas_secundarios TEXT[],
    entidades_citadas TEXT[],
    impacto_estimado  TEXT CHECK (impacto_estimado IN ('alto', 'medio', 'baixo')),
    urgencia_ia       TEXT CHECK (urgencia_ia IN ('alta', 'media', 'baixa')),

    alinhamento       TEXT CHECK (alinhamento IN ('favoravel', 'contrario', 'neutro', 'ambiguo')),
    alinhamento_score NUMERIC(3,2),
    alinhamento_just  TEXT,
    risco_politico    TEXT CHECK (risco_politico IN ('alto', 'medio', 'baixo')),
    recomendacao      TEXT,

    processado        BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(fonte, tipo, numero, ano)
);

-- ============================================================
-- AUTORES DAS PROPOSIÇÕES
-- ============================================================
CREATE TABLE proposicao_autores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    nome            TEXT NOT NULL,
    partido         TEXT,
    uf              TEXT,
    fonte_id        TEXT,           -- ID do parlamentar na API de origem
    tipo_autoria    TEXT DEFAULT 'autor',
    url_perfil      TEXT,           -- URL da página do parlamentar
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TRAMITAÇÕES
-- ============================================================
CREATE TABLE tramitacoes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    data            TIMESTAMPTZ,
    descricao       TEXT NOT NULL,
    orgao           TEXT,
    situacao        TEXT,
    url             TEXT,
    fonte_id        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VOTAÇÕES NOMINAIS
-- ============================================================
CREATE TABLE votacoes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    votacao_id      TEXT UNIQUE NOT NULL,   -- ID externo da votação
    data            DATE,
    data_hora       TIMESTAMPTZ,
    sigla_orgao     TEXT,                   -- ex: "SF", "PLEN"
    descricao       TEXT,
    aprovacao       BOOLEAN,                -- TRUE=aprovado, FALSE=rejeitado, NULL=s/d
    votos_sim       INTEGER,
    votos_nao       INTEGER,
    votos_abstencao INTEGER,
    total_votos     INTEGER,
    orientacao_pl   TEXT,                   -- orientação da liderança do PL
    fonte           TEXT,                   -- 'camara' ou 'senado'
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VOTOS INDIVIDUAIS
-- ============================================================
CREATE TABLE votos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    votacao_id      UUID REFERENCES votacoes(id) ON DELETE CASCADE,
    deputado_id     TEXT NOT NULL,          -- ID na API ou nome como fallback
    deputado_nome   TEXT,
    partido         TEXT,
    uf              TEXT,
    tipo_voto       TEXT,                   -- Sim, Não, Abstenção, etc.
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(votacao_id, deputado_id)
);

-- ============================================================
-- POSIÇÕES DO PARTIDO
-- ============================================================
CREATE TABLE posicoes_partido (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eixo            TEXT NOT NULL,
    posicao         TEXT NOT NULL,
    ativa           BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MONITORAMENTOS (favoritos de proposições)
-- ============================================================
CREATE TABLE monitoramentos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(proposicao_id)
);

-- ============================================================
-- NOTIFICAÇÕES (inbox de mudanças para monitorados)
-- ============================================================
CREATE TABLE notificacoes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    tipo            TEXT NOT NULL DEFAULT 'tramitacao',
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    lida            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ALERTAS (sistema interno de severidade)
-- ============================================================
CREATE TABLE alertas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            TEXT NOT NULL,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    source_type     TEXT,
    source_id       UUID,
    severidade      TEXT CHECK (severidade IN ('critica', 'alta', 'media', 'baixa')),
    lido            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EMBEDDINGS (pgvector — previsto para RAG)
-- ============================================================
CREATE TABLE embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type     TEXT NOT NULL CHECK (source_type IN ('proposicao', 'dou')),
    source_id       UUID NOT NULL,
    chunk_index     INTEGER DEFAULT 0,
    content         TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_embeddings_vector ON embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================
-- SYNC CONTROL
-- ============================================================
CREATE TABLE sync_control (
    fonte           TEXT PRIMARY KEY,
    last_sync       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT DEFAULT 'success',
    records_synced  INTEGER DEFAULT 0,
    error_message   TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Frontend (Next.js / Vercel)

### 7.1 Estrutura de páginas

```
web/
├── app/
│   ├── login/page.tsx                    # Login por senha única
│   ├── (dashboard)/
│   │   ├── layout.tsx                    # Sidebar + auth check + unread count
│   │   ├── dashboard/page.tsx            # Análise de Proposições (home)
│   │   ├── proposicoes/
│   │   │   ├── page.tsx                  # Lista com filtros
│   │   │   └── [id]/page.tsx             # Detalhe + botão Monitorar
│   │   ├── posicoes/page.tsx             # Editor de posições do partido
│   │   └── inbox/page.tsx                # Notificações + proposições monitoradas
│   └── actions/
│       ├── auth.ts                       # login / logout
│       └── monitoramentos.ts             # toggleMonitoramento / markAllRead / markRead
├── components/
│   ├── sidebar.tsx                       # Nav + bell icon com badge
│   ├── badge.tsx                         # Badge de alinhamento/risco
│   ├── monitorar-button.tsx              # Toggle monitoramento (client component)
│   └── theme-toggle.tsx
└── lib/
    ├── db.ts                             # Pool pg, query(), queryOne()
    └── session.ts                        # JWT cookie pl_session
```

### 7.2 Autenticação

- Senha única via variável `ADMIN_PASSWORD`
- JWT assinado com `SESSION_SECRET`, expiração 7 dias
- Cookie `pl_session` (httpOnly)
- Layout `(dashboard)` redireciona para `/login` se sessão inválida

### 7.3 Funcionalidades implementadas

**Dashboard (Análise de Proposições):**
- KPI cards: total, favoráveis, contrárias, ambíguas, neutras, pendentes
- Radar: contrárias ativas ordenadas por risco político
- Recém analisadas (últimas 6)
- Temas com mais contrárias

**Lista de proposições:**
- Filtros: alinhamento, tipo, busca textual
- Paginação
- Links para fonte (Câmara ↗ / Senado ↗)

**Detalhe da proposição:**
- Análise de alinhamento com justificativa e score
- Autores com partido/UF
- Histórico de tramitação
- Botão "Monitorar" (toggle)

**Inbox / Notificações:**
- Lista de notificações de tramitações para proposições monitoradas
- Marcação em lote como lidas
- Lista das proposições monitoradas
- Badge no sininho da sidebar

---

## 8. Sistema de monitoramento

### 8.1 Fluxo

```
Usuário clica "Monitorar" na proposição
    → Server Action: INSERT INTO monitoramentos
    → Badge no sininho atualiza (próximo render do layout)

Worker: POST /jobs/check-tramitacoes (2x/dia)
    → Busca proposições em monitoramentos
    → Para cada uma: tramitacoes com created_at > última notificação
    → INSERT INTO notificacoes para cada nova tramitação

Usuário abre /inbox
    → Vê notificações agrupadas por data
    → Marcar como lida via Server Action
```

### 8.2 Implementação

- `monitoramentos` é app-wide (sem per-user — autenticação é senha única)
- Notificações criadas pelo job `check_tramitacoes_monitoradas()` em `workers/app/jobs/check_tramitacoes.py`
- Contagem de não lidas: query no layout server component, passada como prop para sidebar

---

## 9. Camada de IA (Claude API)

### 9.1 Modelos utilizados

| Tarefa | Modelo | Custo estimado |
|---|---|---|
| Classificação temática | `claude-haiku-4-5-20251001` | ~$0.001/proposição |
| Análise de alinhamento | `claude-sonnet-4-6` | ~$0.01/proposição |
| Chat RAG (previsto) | `claude-sonnet-4-6` | ~$0.02/query |
| Briefings (previsto) | `claude-opus-4-6` | ~$0.10/briefing |

### 9.2 Estimativa de consumo mensal

| Atividade | Volume | Custo |
|---|---|---|
| Classificação de novas proposições | ~400/mês | ~$0.40 |
| Análise de alinhamento | ~400/mês | ~$4.00 |
| Reclassificação (mudança de posições) | ~1x/mês × ~6.000 | ~$60 |
| Chat RAG (previsto) | ~500 queries | ~$10 |
| **Total estimado** | | **~$75-120/mês** |

### 9.3 Prompt caching

O documento de posições do partido (~2–3k tokens) é constante em todas as chamadas de alinhamento. Usar `cache_control: ephemeral` no system prompt para reduzir custo de input em ~90%.

---

## 10. Infraestrutura e variáveis de ambiente

### 10.1 Variáveis — Workers

```env
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
R2_ENDPOINT=https://...r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=patrulheiro
WORKER_SECRET=...
INLABS_USER=...
INLABS_PASSWORD=...
REDIS_URL=redis://localhost:6379
PARTIDO_SIGLA=PL
```

### 10.2 Variáveis — Web

```env
DATABASE_URL=postgresql://...
ADMIN_PASSWORD=...
SESSION_SECRET=...
WORKER_URL=http://workers:8000   # nome do container no docker network
WORKER_SECRET=...
```

### 10.3 Infraestrutura na VPS

```
VPS
├── Cloudflare (DNS + proxy reverso + SSL)
│
├── container: web         (Next.js — porta 3000)
│   └── variáveis: DATABASE_URL, SESSION_SECRET, ADMIN_PASSWORD,
│                  WORKER_URL, WORKER_SECRET
│
├── container: workers     (FastAPI — porta 8000, interno apenas)
│   └── variáveis: DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY,
│                  R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
│                  R2_BUCKET, WORKER_SECRET, INLABS_USER, INLABS_PASSWORD
│
├── PostgreSQL + pgvector  (porta 5432, interno)
└── Redis                  (porta 6379, interno)
```

### 10.4 Deploy

```
Push to main
    └── VPS: git pull + docker compose up --build -d
```

### 10.5 Agendamento de jobs (cron na VPS)

Os jobs de ingestão são disparados por crontab na VPS via chamadas HTTP ao worker:

```cron
# Ingestão Câmara — 3x/dia
0 7,13,19 * * *  curl -s -X POST http://localhost:8000/ingest/camara -H "X-Worker-Secret: $SECRET"

# Ingestão Senado — 3x/dia
30 7,13,19 * * * curl -s -X POST http://localhost:8000/ingest/senado -H "X-Worker-Secret: $SECRET"

# Enrich Câmara (tramitações/situação) — 2x/dia
0 9,17 * * *     curl -s -X POST http://localhost:8000/enrich -H "X-Worker-Secret: $SECRET"

# Votações Senado — 1x/dia
0 8 * * *        curl -s -X POST http://localhost:8000/ingest/senado-votacoes -H "X-Worker-Secret: $SECRET"

# Classificação pendentes — a cada 30min
*/30 * * * *     curl -s -X POST http://localhost:8000/process/pending -H "X-Worker-Secret: $SECRET"

# Check tramitações monitoradas — 2x/dia
0 9,18 * * *     curl -s -X POST http://localhost:8000/jobs/check-tramitacoes -H "X-Worker-Secret: $SECRET"
```

---

## 11. Roadmap

### Concluído

- [x] Ingestão Câmara (proposições + tramitações + autores + votações)
- [x] Ingestão Senado via API nova `/processo` (proposições + tramitações + autores)
- [x] Enriquecimento de autores do Senado com partido/UF/url_perfil
- [x] Votações nominais do Senado com orientação da bancada PL e votos individuais
- [x] Pipeline de classificação temática (Claude Haiku)
- [x] Pipeline de análise de alinhamento (Claude Sonnet) com posições do partido
- [x] Dashboard principal (Análise de Proposições)
- [x] Lista de proposições com filtros
- [x] Detalhe de proposição com autores, tramitações, análise de alinhamento
- [x] Editor de posições do partido
- [x] Autenticação por senha única (JWT cookie)
- [x] Tema claro/escuro
- [x] Sistema de monitoramento (favoritos) + inbox de notificações
- [x] Renomeação: Patrulheiro → Inteligência Legislativa

### Backlog

| Issue | Descrição | Prioridade |
|---|---|---|
| DAT-116 | Download PDF inteiro teor + extração texto + upload R2 | Alta |
| DAT-106 | Enrich Senado: indexação/temas via `/processo/{id}` | Média |
| DAT-109 | Votações históricas por senador + índice de alinhamento PL | Alta |
| DAT-113 | Proposições de autoria por senador | Média |
| DAT-114 | Dashboard geral de entrada (multi-área) | Alta |
| DAT-115 | Logos dos partidos + fotos dos parlamentares | Baixa |
| DAT-98–103 | Ingestão DOU (INLABS + API Imprensa Nacional) | Alta |
| — | Chat RAG (busca semântica + Claude) | Alta |
| — | Alertas por e-mail/WhatsApp (Resend + Twilio) | Média |
| — | Briefings semanais automáticos | Média |
| — | Filiação partidária histórica de parlamentares | Baixa |
| — | Dashboard de gastos de senadores | Baixa |

---

## 12. Apêndice — APIs de referência

| API | URL | Observação |
|---|---|---|
| Câmara dos Deputados | `dadosabertos.camara.leg.br/api/v2` | [Swagger](https://dadosabertos.camara.leg.br/swagger/api.html) |
| Senado Federal | `legis.senado.leg.br/dadosabertos` | [Swagger](https://legis.senado.leg.br/dadosabertos/api-docs/swagger-ui/index.html) |
| DOU — INLABS | `inlabs.in.gov.br` | Cadastro necessário |
| DOU — Imprensa Nacional | `www.in.gov.br/consulta` | Não documentada (ver Ro-DOU) |
| LexML | `www.lexml.gov.br/busca/SRU` | Protocolo SRU |
| Querido Diário | `queridodiario.ok.org.br/api` | Diários municipais |
| Gastos Senadores | `docs.apis.codante.io/gastos-senadores` | Dashboard complementar |
| Ro-DOU (referência) | `github.com/gestaogovbr/Ro-dou` | Engenharia reversa API IN |
