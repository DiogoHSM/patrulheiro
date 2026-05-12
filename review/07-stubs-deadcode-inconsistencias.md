# 07 — Stubs, Dead Code e Inconsistências com a documentação

> Escopo: `grep` exaustivo por TODO/FIXME/HACK + verificação manual de stubs + comparação entre `CLAUDE.md`/`SPRINTS.md`/`arquitetura-plataforma-legislativa.md` e código real.

## Sumário executivo

| Categoria | Quantidade |
|---|---|
| TODO/FIXME em código | 0 |
| Stubs com `pass`/`return None` | 5 |
| `console.log/print` em "prod" | 64 (workers), 0 (web) |
| Imports não-utilizados | 1 confirmado |
| Componentes/funções órfãos | 3 |
| Inconsistências doc↔código | 7 (significativas) |
| Migrations vs código | 3 (críticas, ver `05`) |

Há **zero** marcadores `TODO`/`FIXME`/`HACK`/`XXX` no código — surpreendentemente limpo nesse aspecto. Mas isso esconde várias **funções fantasmas** documentadas como "concluídas" no SPRINTS/CLAUDE/arquitetura e que **mudaram de provedor LLM**, têm features mencionadas como ativas mas em estado parcial, ou são totalmente ausentes (RAG, alertas de e-mail, Resend, Twilio).

---

## 1. Stubs e código de "best-effort"

### S-1 — `workers/app/ingestion/camara.py:109-110` — fetch detalhes/autores/tramitações silencioso
```python
try:
    detalhes = await _fetch_detalhes(client, raw["id"])
    ...
except Exception:
    pass
```
Não é stub literal, mas é "best-effort" sem caminho de recuperação. Documentado em `04-A-1`.

### S-2 — `workers/app/ingestion/enricher.py:200-201` — votos individuais
```python
except Exception:
    pass  # votos são best-effort
```
Comentário explícito. Mas é uma feature de produto (votação nominal). Best-effort sem retry separado é debt.

### S-3 — `workers/app/ingestion/normalizer.py:25` — `pass` em parsing de data
```python
try:
    data_ap = date.fromisoformat(raw["dataApresentacao"][:10])
except ValueError:
    pass
```
Aqui `pass` é intencional (data fica `None`). OK, mas docstring ausente.

### S-4 — `workers/app/ingestion/enricher_camara_votacoes.py:71` — `pass` em fallback de detalhes
```python
except Exception:
    pass
```
Quando a API de detalhes da proposição falha durante resolução, o tipo/numero fica em branco e a proposição é rejeitada — falha silenciosa.

### S-5 — `workers/app/ingestion/dou.py:212-213` — `pass` em insert de ato irrelevante
Documentado em 04. Best-effort.

> **Nenhum** `raise NotImplementedError`, `...` (Ellipsis), nem função vazia em todo o repositório.

---

## 2. Imports e código órfão

### O-1 — `web/components/sort-controls.tsx` (componente inteiro órfão)
- **Evidência:** `grep -rn "SortControls" web/app/ web/components/ ` → apenas a própria definição.
- O componente foi substituído pelos sort buttons inline em `parlamentares-list.tsx:129-145`. Permanece no repo sem uso.
- **Ação:** remover.

### O-2 — `web/package.json:13` `next-auth: ^5.0.0-beta.30` — instalado sem import
- **Evidência:** `grep -rn "next-auth\|NextAuth" web/` → 0 matches além do `package.json`.
- **Ação:** `npm uninstall next-auth`.

### O-3 — `workers/requirements.txt:7` `anthropic==0.42.0` — instalado sem uso
- O agente do `08-integracoes-externas.md` documentou: a CLAUDE.md descreve Anthropic/Claude (Haiku + Sonnet), mas o código usa `AsyncOpenAI` com `gpt-4.1-nano` em `classifier.py`, `alignment.py`, `embedder.py`.
- **Evidência:** `grep -rn "from anthropic\|import anthropic" workers/` → 0 matches.
- **Evidência:** `grep -rn "settings.anthropic_api_key" workers/` → 0 matches no código fora do `config.py`.
- **Ação:** decidir entre (a) migrar de fato para Anthropic conforme doc; (b) remover dependência e atualizar `config.py`/`CLAUDE.md`/`arquitetura`.

### O-4 — `workers/requirements.txt:9` `lxml==5.3.0` — instalado mas não importado
- **Evidência:** `dou.py:5` usa `xml.etree.ElementTree as ET`. `grep "import lxml" workers/` → 0 matches.
- **Ação:** ou migrar para `lxml` (parsing mais robusto de XML do INLABS) ou remover.

### O-5 — `workers/requirements.txt:8` `boto3==1.35.93` — instalado mas não importado
- **Evidência:** `grep "import boto3\|from boto3" workers/` → 0 matches.
- Arquitetura menciona R2 para PDFs de inteiro teor (DAT-116) — não implementado.
- **Ação:** confirmar com SPRINTS.

### O-6 — `workers/app/config.py:11-14` — `r2_*` settings sem usuário
- **Evidência:** `grep "r2_endpoint\|r2_access_key\|r2_secret\|r2_bucket" workers/app/` → apenas `config.py`.
- Feature de upload R2 ainda não implementada (SPRINTS Sprint 1).

### O-7 — `workers/app/config.py:6` — `redis_url` sem uso
- **Evidência:** `grep -rn "redis\|Redis\|aioredis" workers/app/` → 0 matches.
- Docker compose sobe Redis 7, mas o código não conecta. Arquitetura §2.1 admite "Redis está na VPS e pronto para uso quando o volume justificar".

---

## 3. Console/print "debug-style"

### P-1 — `print()` no workers (64 ocorrências, todos `print(f"[<tag>] ...")`)
Não são debug puro, servem de log. Mas:
- Sem timestamps padronizados.
- Sem PII redaction (logam mensagens de erro contendo URLs com IDs).
- Sem níveis (INFO/WARN/ERROR misturados).
- Sem nenhum log path para `logging.handlers.RotatingFileHandler` ou similar.

### P-2 — `console.log/error/warn` em web
**Zero ocorrências** — bom.

---

## 4. Componentes/funções declarados mas pouco usados

### F-1 — `getIngestionStatus` em `web/app/(dashboard)/layout.tsx`
Roda em **cada render** do layout (a cada page-load). Faz 5 queries pesadas (`COUNT(*) FROM proposicoes`). Funcional, mas é cargo cult: o tooltip "Status das cargas" raramente é aberto pelo usuário.
- **Ação:** cache 30s ou `revalidateTag` por job-completion.

### F-2 — `Photo`, `PartidoLogo` em `web/components/photo.tsx`
Usados. OK.

### F-3 — `FonteBadge` em `web/components/badge.tsx`
Usado em `dashboard/page.tsx`, `proposicoes/page.tsx`. OK.

---

## 5. Inconsistências documentação ↔ código

### D-1 — **Provedor LLM divergente** (gravíssimo, ver `04-04`/`08`)
- **CLAUDE.md:** "anthropic 0.42 — classificação e análise de alinhamento"; e linha `classifier.py # Classificação temática via Claude Haiku`, `alignment.py # Análise de alinhamento via Claude Sonnet`.
- **arquitetura.md §2.1:** "Claude API (Anthropic) — Sonnet para alinhamento; GPT-4.1-nano para classificação".
- **Código:** `processing/classifier.py:6 _client = AsyncOpenAI(api_key=settings.openai_api_key)`, `model="gpt-4.1-nano"` em **ambos** os arquivos (`classifier.py:45,62` e `alignment.py:42,73`). **`anthropic` nunca é importado.**
- **Ação imediata:** atualizar `CLAUDE.md` linhas 9-10 e arquitetura §2.1 para refletir o real. Decidir se quer migrar parte para Claude conforme doc (`alignment.py` para Sonnet faria sentido — análise política mais complexa).

### D-2 — **Estrutura do repositório no CLAUDE.md inclui arquivos inexistentes**
- CLAUDE.md descreve em `workers/app/`:
  ```
  ├── ingestion/
  │   ├── enricher.py
  │   ├── enricher_senado_autores.py
  │   ├── enricher_senado_votacoes.py
  │   └── enricher_camara_votos.py
  └── processing/
      ├── classifier.py
      └── alignment.py
  ```
- **Realmente existem (todos):** os listados acima **mais** `enricher_camara_autores.py`, `enricher_camara_votacoes.py`, `dou.py`, `processing/alerter.py`, `processing/embedder.py`, `jobs/check_tramitacoes.py`. CLAUDE.md está desatualizado.
- **Ação:** atualizar CLAUDE.md.

### D-3 — **`/votacoes/[id]/page.tsx` documentado como "votos nominais" mas faz JOIN com proposicoes obrigatória**
- `web/app/(dashboard)/votacoes/[id]/page.tsx:42-45` — `JOIN proposicoes p ON p.id = v.proposicao_id`. Votação **sem** `proposicao_id` (e.g. procedural sem proposição vinculada) **nunca aparece**. CLAUDE.md sugere "página de votos nominais com placar, lista por nome/partido/UF" sem qualificar.

### D-4 — **`StatusWidget` documentado como widget de "progresso"**
Mostra %s mas a lógica de "loading vs done vs failed" deriva de heurística `pct >= 100` no `layout.tsx:51`. Não há job state real. Razoável para MVP, mas o nome sugere algo mais robusto.

### D-5 — **SPRINTS.md menciona "Cron Jobs (Vercel)"**
- "Sprint 1 — Worker — ... `GET /api/cron/ingest-camara`". Não existe em `web/app/api/`. Cloudflare/EasyPanel não cron.
- Arquitetura §2 esclarece "não usa Vercel" — SPRINTS está desatualizado.

### D-6 — **Tabela `audit_log` mencionada em SPRINTS — não existe**
- SPRINTS Sprint 0: "Tabelas: ... `audit_log`". Não está em migrations nem código.
- **Ação:** remover do SPRINTS ou criar a migration.

### D-7 — **View `v_resumo_diario` mencionada em SPRINTS — não existe**
- SPRINTS Sprint 0: "Views: `v_proposicoes_criticas`, `v_resumo_diario`". Migrations só criam `v_proposicoes_criticas`.

### D-8 — **Features de saída de alertas: Resend / Twilio / Sentry** — ausentes
- arquitetura.md §2: "E-mail / alertas: Resend — Previsto — ainda não ativo"
- SPRINTS Sprint 0: "Criar conta Resend / Twilio / Sentry".
- Código `workers/app/processing/alerter.py` apenas insere em `alertas` table. Não envia e-mail nem WhatsApp. Sem indicação visual nas notificações de inbox.
- **Ação:** documentar como "não implementado" em CLAUDE.md, ou pelo menos no inbox dizer "alertas chegam apenas dentro da plataforma".

---

## 6. Migrations ↔ código (consolidado de `05`)

Já documentado em detalhe no relatório `05-banco-dados.md`. Resumo:
- `votacoes` e `votos`: **sem migration**. Devem existir em produção via DDL manual.
- `tramitacoes` UNIQUE: usado em `ON CONFLICT` mas não declarado na migration.
- `alertas.lido` vs `notificacoes.lida`: dois nomes ortográficos diferentes.

---

## 7. Componentes web verificados

| Componente | Status |
|---|---|
| `sidebar.tsx` | Completo. Item "Inbox" fora do array `nav` (design dual) |
| `badge.tsx` | Completo, `Badge` e `FonteBadge` ambos usados |
| `photo.tsx` | Completo |
| `parlamentares-list.tsx` | Completo, com workaround de hydration via `key` |
| `sort-controls.tsx` | **Órfão** — ver O-1 |
| `status-widget.tsx` | Completo |
| `filters-mobile.tsx` | Completo, mas com MESES hardcoded — ver `03-M-4` |
| `theme-toggle.tsx` | Completo |
| `monitorar-button.tsx` | Completo, sem tratamento de erro — ver `03-A-2` |

---

## 8. Endpoints FastAPI ↔ código

| Endpoint | Implementação | Status |
|---|---|---|
| `GET /health` | `main.py:39-41` | OK |
| `POST /ingest/camara` | `main.py:44-47 → _run_camara` | OK |
| `POST /ingest/senado` | `main.py:50-53 → _run_senado` | OK |
| `POST /enrich` | `main.py:56-59 → _run_enrich` | OK |
| `POST /enrich/senado-autores` | `main.py:62-66` | OK |
| `POST /ingest/senado-votacoes` | OK |
| `POST /ingest/senado-votacoes-historico` | OK, com `ano_inicio/ano_fim` sem validação de range |
| `POST /ingest/dou` | OK, com `data` opcional |
| `POST /enrich/camara-autores` | OK |
| `POST /ingest/camara-votos` | OK |
| `POST /ingest/camara-votacoes` | OK |
| `POST /ingest/camara-votacoes-historico` | OK |
| `POST /jobs/check-tramitacoes` | OK |
| `POST /process/pending` | OK |
| `POST /process/dou-pending` | OK |

Todos protegidos por `verify_secret` (exceto `/health`). Não há endpoint "fantasma".

---

## 9. Rotas Next.js ↔ código

| Rota | Implementação | Status |
|---|---|---|
| `/` | `app/page.tsx` — redirect | OK |
| `/login` | `app/login/page.tsx` | OK |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | OK |
| `/proposicoes` | OK |
| `/proposicoes/[id]` | OK |
| `/deputados` | OK |
| `/deputados/[id]` | OK |
| `/senadores` | OK |
| `/senadores/[id]` | OK |
| `/votacoes` | OK, limite 200 (ver `03-A-4`) |
| `/votacoes/[id]` | OK |
| `/inbox` | OK |
| `/posicoes` | OK, read-only sem UI de edição (ver `03-M-11`) |
| `/dou` | OK |
| `/dou/[id]` | OK |

Sidebar `nav` aponta para todas elas. Não há rota "fantasma".

---

## 10. Resumo: ações prioritárias de limpeza

1. **Atualizar CLAUDE.md** — provedor LLM (D-1), estrutura de arquivos (D-2), Anthropic não-utilizado.
2. **Atualizar SPRINTS.md** — remover/marcar Vercel cron (D-5), `audit_log`/`v_resumo_diario` (D-6/D-7).
3. **Remover dependências mortas** — `next-auth` no `web/package.json`; `anthropic`, `lxml`, `boto3` em `workers/requirements.txt` (se confirmado).
4. **Remover componente órfão** — `web/components/sort-controls.tsx`.
5. **Adicionar logger estruturado** — substituir os 64 `print()` em workers.
6. **Criar migration faltante** — `votacoes`/`votos` (ver `05-C-1`).
