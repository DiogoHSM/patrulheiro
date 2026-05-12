# 05 — Banco de Dados, Schema e Migrations

> Escopo: `/home/user/patrulheiro/infra/migrations/*.sql` + todas as queries em `web/**` e `workers/**`.
> Stack: PostgreSQL 16 com extensões `vector`, `pg_trgm`, `unaccent`.

## Sumário executivo

| Severidade | Quantidade |
|---|---|
| CRÍTICO | 2 |
| ALTO | 6 |
| MÉDIO | 8 |
| BAIXO | 5 |
| INFO | 4 |

Achados mais graves: **(C-1)** tabelas `votacoes` e `votos` são amplamente referenciadas no código (web + workers) mas **não há migration que as crie**. A migration `002_monitoramentos.sql:33-35` faz `ALTER TABLE votacoes ADD COLUMN IF NOT EXISTS ...` presumindo que a tabela já existe. **Qualquer reset/clonagem do banco produz erro imediato.** **(C-2)** Inconsistência de naming entre `alertas.lido` e `notificacoes.lida` confunde toda a base de código e gerou ao menos um bug 500 já corrigido.

A qualidade da modelagem é boa para um MVP (chaves estrangeiras com `ON DELETE CASCADE`, CHECK em enums, UNIQUE em `(fonte, tipo, numero, ano)`), mas a falta da migration crítica é bloqueador para uma reimplantação limpa.

---

## CRÍTICO

### C-1 — Migrations para `votacoes` e `votos` AUSENTES
- **Evidência:**
  ```
  $ grep -n "CREATE TABLE" infra/migrations/*.sql
  002_monitoramentos.sql:4  CREATE TABLE monitoramentos
  002_monitoramentos.sql:16 CREATE TABLE notificacoes
  003_dou_atos.sql:4        CREATE TABLE dou_atos
  001_initial.sql:9         CREATE TABLE proposicoes
  001_initial.sql:59        CREATE TABLE proposicao_autores
  001_initial.sql:76        CREATE TABLE tramitacoes
  001_initial.sql:94        CREATE TABLE embeddings
  001_initial.sql:114       CREATE TABLE posicoes_partido
  001_initial.sql:126       CREATE TABLE alertas
  001_initial.sql:144       CREATE TABLE sync_control
  ```
  **Não há `CREATE TABLE votacoes` em parte alguma.** No entanto, o código depende dela:
  - `web/app/(dashboard)/votacoes/page.tsx:13-22` faz SELECT em `votacoes JOIN proposicoes`
  - `web/app/(dashboard)/votacoes/[id]/page.tsx:42-44` `SELECT v.id, v.votacao_id, v.fonte, ...`
  - `web/app/(dashboard)/senadores/page.tsx:36-42` JOIN com `votacoes`
  - `workers/app/ingestion/enricher.py:159-181` INSERT/UPDATE em `votacoes`
  - `workers/app/ingestion/enricher_senado_votacoes.py:137-164` INSERT em `votacoes` com 13 colunas
  - `workers/app/ingestion/enricher_camara_votacoes.py:190-212` idem
  - `workers/app/ingestion/enricher_camara_votos.py:65-77` INSERT em `votos`
  - `migration 002_monitoramentos.sql:34-35` `ALTER TABLE votacoes ADD COLUMN IF NOT EXISTS orientacao_pl/fonte` — presume existência.

  Colunas inferidas a partir dos INSERTs:
  ```sql
  CREATE TABLE votacoes (
      id              UUID PRIMARY KEY,
      proposicao_id   UUID REFERENCES proposicoes(id),
      votacao_id      TEXT,                  -- ID na API externa
      data            DATE,
      data_hora       TIMESTAMPTZ,
      sigla_orgao     TEXT,
      descricao       TEXT,
      aprovacao       BOOLEAN OR INT (0/1),
      votos_sim       INT,
      votos_nao       INT,
      votos_abstencao INT,
      total_votos     INT,
      orientacao_pl   TEXT,        -- de 002
      fonte           TEXT,        -- de 002, NULL = camara, 'senado' = senado
      UNIQUE (votacao_id)
  );
  CREATE TABLE votos (
      id              UUID PRIMARY KEY,
      votacao_id      UUID REFERENCES votacoes(id),
      deputado_id     TEXT,          -- mal-nomeado: guarda codigoParlamentar do Senado também
      deputado_nome   TEXT,
      partido         TEXT,
      uf              TEXT,
      tipo_voto       TEXT,
      data_registro   TIMESTAMPTZ,
      UNIQUE (votacao_id, deputado_id)
  );
  ```
- **Impacto:** clone do repositório → `psql -f 001_initial.sql 002_*.sql 003_*.sql 004_*.sql` quebra em 002 com `ERROR: relation "votacoes" does not exist`. O banco hoje em produção foi populado por um caminho não-rastreado (possivelmente comandos manuais ou migration excluída).
- **Recomendação imediata:** criar `infra/migrations/000_votacoes_votos.sql` ou `005_votacoes_votos.sql` com os `CREATE TABLE` deduzidos, e índices em `proposicao_id`, `votacao_id`, `(votacao_id, deputado_id)`, `deputado_id` para queries de alinhamento.

### C-2 — Inconsistência de naming `alertas.lido` vs `notificacoes.lida`
- **Arquivos:**
  - `infra/migrations/001_initial.sql:134` — `lido BOOLEAN DEFAULT FALSE` em `alertas`.
  - `infra/migrations/002_monitoramentos.sql:22` — `lida BOOLEAN DEFAULT FALSE` em `notificacoes`.
- **Problema:** o CLAUDE.md (histórico de 2026-03-22) documenta um bug 500 no dashboard por essa confusão. O fix foi pontual mas a inconsistência permanece. Toda nova query que mexer com qualquer das duas tabelas tem chance de inverter o nome. Reading code:
  - `web/app/actions/monitoramentos.ts:18` — `notificacoes SET lida = TRUE WHERE lida = FALSE` — OK.
  - `web/app/actions/monitoramentos.ts:28` — `alertas SET lido = TRUE WHERE lido = FALSE` — OK.
  - `web/app/(dashboard)/inbox/page.tsx:10,16` — `lido` na select de alertas — OK.
  - `web/app/(dashboard)/inbox/page.tsx:26,30,32` — `lida` em notificacoes — OK.
  - `web/app/(dashboard)/layout.tsx:75-76` — usa ambos corretamente.
- **Recomendação:** migration renomeando `alertas.lido` → `alertas.lida` (ou o contrário), com `ALTER TABLE ... RENAME COLUMN`. Custo: precisa atualizar 4 arquivos do frontend.

---

## ALTO

### A-1 — `proposicoes` sem índice em `processado` + `fonte` combinado
- **Existente:** `idx_proposicoes_processado ON (processado) WHERE processado = FALSE` e separado `idx_proposicoes_fonte_id` (composite `(fonte, fonte_id)`).
- **Queries em produção:**
  - `web/app/(dashboard)/layout.tsx:13-28` — `COUNT(*) FROM proposicoes WHERE fonte = 'camara'` (3×) usado em cada page-load do dashboard.
  - `workers/app/db.py:294-303` — `get_proposicoes_sem_processar` faz `WHERE processado = FALSE ORDER BY created_at LIMIT 50`. Sem `(processado, created_at)` cluster, faz seq scan em tabela grande.
- **Recomendação:**
  ```sql
  CREATE INDEX idx_proposicoes_fonte_proc ON proposicoes(fonte, processado);
  CREATE INDEX idx_proposicoes_proc_created ON proposicoes(created_at) WHERE processado = FALSE;
  ```

### A-2 — `proposicao_autores` sem índice em `(fonte_id, proposicao_id)`
- **Queries:**
  - `web/app/(dashboard)/deputados/page.tsx:4-25` — `GROUP BY a.fonte_id, a.nome, a.partido, a.uf`. Sem índice em `fonte_id`, faz scan.
  - `web/app/(dashboard)/deputados/[id]/page.tsx:18-23` `WHERE fonte_id = $1`.
- **Existente:** `idx_autores_proposicao (proposicao_id)`, `idx_autores_partido (partido)`. **Não há índice em `fonte_id` isolado.**
- **Recomendação:**
  ```sql
  CREATE INDEX idx_autores_fonte_id ON proposicao_autores(fonte_id) WHERE fonte_id IS NOT NULL AND fonte_id <> '';
  ```

### A-3 — `tramitacoes` sem UNIQUE em `(proposicao_id, fonte_id)` — mas o INSERT depende
- **Arquivo:** `workers/app/db.py:158-164` — `ON CONFLICT (proposicao_id, fonte_id) DO NOTHING`.
- **Migration:** `001_initial.sql:76-86` define a tabela **sem** UNIQUE em `(proposicao_id, fonte_id)`. Sem essa UNIQUE, o `ON CONFLICT` quebra:
  ```
  ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification
  ```
- **Confirmar em produção:** se o INSERT está rodando, a UNIQUE foi criada manualmente fora das migrations.
- **Recomendação:** migration:
  ```sql
  ALTER TABLE tramitacoes ADD CONSTRAINT uniq_tramitacao UNIQUE (proposicao_id, fonte_id);
  ```

### A-4 — `dou_atos` UNIQUE em `(edicao, secao, orgao, titulo)` com colunas NULLable
- **Arquivo:** `infra/migrations/003_dou_atos.sql:33` — `UNIQUE(edicao, secao, orgao, titulo)`.
- **Problema:** `orgao` e `titulo` são nullable (linhas 9-11). PostgreSQL trata `NULL ≠ NULL` em UNIQUE, então dois atos com mesmo `(edicao, secao)` e `orgao=NULL, titulo=NULL` passam, gerando duplicação.
- **Recomendação:** adicionar `NOT NULL` em `orgao`/`titulo` com default `''`, ou usar `UNIQUE NULLS NOT DISTINCT` (Postgres 15+):
  ```sql
  ALTER TABLE dou_atos ADD CONSTRAINT dou_atos_uniq UNIQUE NULLS NOT DISTINCT (edicao, secao, orgao, titulo);
  ```

### A-5 — `dou_atos.alinhamento_score NUMERIC(3,2)` — overflow se >9.99
- **Arquivo:** `infra/migrations/003_dou_atos.sql:26` e mesmo problema em `001_initial.sql:33` para `proposicoes`.
- **Problema:** `NUMERIC(3,2)` permite até 9.99. Se o LLM retornar `confianca=10` (ou normalização do db.py `min(float(...), 1.0)` falhar com `"abc"`), o INSERT quebra. `db.py:129,262` faz `min(..., 1.0)`, então o range esperado é [0,1], mas:
  - `db.py:262` em `update_dou_alinhamento` — `min(float(data.get("confianca") or 0), 1.0)`. Se `data.get("confianca")` for `0.95`, ok. Se for `95` (modelo confuso entre 0-100), `float(95)` >> 1.0 — `min` clipa para 1.0, OK.
  - Mas se for negativo (`-0.5`), passa sem clip. Não é violação de constraint mas semântica errada.
- **Recomendação:** `confianca` deveria ser `NUMERIC(4,3)` para precisão ou `min(max(...), 1.0, 0.0)`.

### A-6 — `votos.deputado_id` é TEXT mas armazena IDs heterogêneos
- **Inferido do código:** Deputados usam IDs numéricos da Câmara, Senadores usam `codigoParlamentar` numérico. Em `enricher_camara_votacoes.py:229-230` há fallback `dep_id = dep_nome[:50]` quando o ID falta. Em `enricher_senado_votacoes.py:184,199`, idem (`vp.get("nomeParlamentar","")[:50]`).
- **Problema:** queries que fazem JOIN entre `votos.deputado_id` e `proposicao_autores.fonte_id` (`senadores/page.tsx:30`) podem mismatch quando o senador tem ID e o voto registrou só o nome. CLAUDE.md menciona o mal-nomeio explicitamente.
- **Recomendação:** renomear para `votos.parlamentar_id` (data migration) e padronizar valor para "nm:<nome>" quando ID ausente.

---

## MÉDIO

### M-1 — View `v_proposicoes_criticas` usa `situacao NOT IN ('arquivada', 'rejeitada', 'vetada')` (lowercase)
- **Arquivo:** `001_initial.sql:200` — filtro `IN ('arquivada', 'rejeitada', 'vetada')`.
- **Arquivo do código:** `dashboard/page.tsx:36` usa `('Arquivada', 'Rejeitada', 'Vetada')` (Capitalized).
- **Problema:** a API da Câmara retorna `descricaoSituacao` capitalizado. A view não filtra nada, então mostra arquivadas. O dashboard usa a forma certa. Inconsistência entre view e código real.
- **Recomendação:** atualizar a view ou remover (parece não ser usada).

### M-2 — `posicoes_partido` sem UNIQUE em `(eixo, posicao)`
- **Arquivo:** `001_initial.sql:114-121`. Posições duplicadas podem ser inseridas e ambas exibidas em `/posicoes`.
- **Recomendação:** `UNIQUE (eixo, posicao)`.

### M-3 — `proposicoes.fonte` CHECK só permite `('camara', 'senado')`, mas SPRINTS menciona LexML/Querido Diário
- Hardcoded. Evolução futura precisa migration.

### M-4 — `embeddings.metadata JSONB DEFAULT '{}'` mas é passado `json.dumps(...)`
- `workers/app/processing/embedder.py:72` — `metadata=json.dumps(metadata)`. asyncpg recebe string; JSONB armazena string. Já mencionado em `04`.

### M-5 — `alertas` sem FK para `source_type+source_id`
- `001_initial.sql:131-132` — `source_type TEXT`, `source_id UUID`. Não há restrição de integridade referencial. Se um `dou_atos` for deletado, alertas órfãos permanecem.

### M-6 — `sync_control.fonte` aceita string livre
- `001_initial.sql:144-151`. Hoje há valores conhecidos: `'camara'`, `'senado'`, `'senado_votacoes'`, `'camara_votacoes'`, `'dou'`. Typo em código gera novo registro sem warning.
- **Recomendação:** ENUM ou CHECK constraint.

### M-7 — `proposicoes.processado BOOLEAN` mistura significado: classificação OU alinhamento?
- **Arquivo:** `db.py:115` — `processado = TRUE` é marcado em `update_alinhamento` (após alignment). Mas dashboards usam `WHERE processado = FALSE` para "pendentes". Se a classificação rodou mas o alinhamento falhou, fica `processado=FALSE` indefinidamente.
- **Recomendação:** separar em `classificado` e `alinhado`.

### M-8 — `dou_atos.relevante BOOLEAN DEFAULT NULL` — três estados
- `003_dou_atos.sql:15`. NULL=não-filtrado, TRUE=relevante, FALSE=irrelevante. Tri-state em boolean é truque, mas dificulta queries: `WHERE relevante` ignora NULL silenciosamente. Documentar.

---

## BAIXO

### B-1 — Falta `ON DELETE CASCADE` em `monitoramentos.proposicao_id`
- `002_monitoramentos.sql:6` tem `ON DELETE CASCADE` — OK. Ignorar.

### B-2 — Ordens GIN em `temas_primarios` cobertas, mas `temas_secundarios` não
- `001_initial.sql:47` — só `temas_primarios` tem GIN. Queries do dashboard só usam primários, mas em pesquisas avançadas pode interessar.

### B-3 — Índice `idx_proposicoes_data ON (data_apresentacao DESC)` — orders DESC dentro do índice
- Postgres respeita, mas sort ASC ainda usa bitmap heap. Adicionar índice ASC se preciso.

### B-4 — Não há índice por `proposicoes.alinhamento_score`
- O dashboard ordena `ORDER BY ... alinhamento_score DESC NULLS LAST`. Em tabela grande, sort caro.

### B-5 — Comentários SQL em PT-BR misturados com EN
Estética. Consistência ajuda.

---

## INFO

### I-1 — `CREATE EXTENSION IF NOT EXISTS vector/pg_trgm/unaccent` ok
Permite re-execução.

### I-2 — `gen_random_uuid()` requires `pgcrypto`
Não está em `CREATE EXTENSION`. Em Postgres 13+, `gen_random_uuid()` vem com `pgcrypto` ou nativamente em 14+. Confirmar versão. Default do `pgvector/pgvector:pg16` (docker-compose.yml) traz Postgres 16 — ok.

### I-3 — `vector(1536)` adequado para `text-embedding-3-small` da OpenAI
Bem mapeado.

### I-4 — Função `search_similar` definida mas não-chamada
`001_initial.sql:156-184`. Nenhum código atual a invoca. RAG não está implementado ainda (SPRINTS Sprint 3). Permanece como infra pré-instalada.

---

## Verificado / OK

- Todas as queries em `web/app/**` e `workers/app/**` usam placeholders parametrizados (`$1, $2 …`) — não há SQL injection via concatenação.
- `ON DELETE CASCADE` nas FKs que importam (proposicoes → autores/tramitacoes; monitoramentos; notificacoes).
- CHECK constraints em todos os enums críticos (alinhamento, impacto, risco, severidade, fonte de proposicoes).
- Índices GIN em `temas_primarios` e FTS em `ementa` adequados para os filtros existentes.
- HNSW em `embeddings.embedding` correto para busca vetorial.

## Arquivos auditados

```
infra/migrations/001_initial.sql
infra/migrations/002_monitoramentos.sql
infra/migrations/003_dou_atos.sql
infra/migrations/004_em_exercicio.sql
+ todas as queries em web/app/** e workers/app/**
```
