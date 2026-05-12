# 00 — Sumário Executivo da Revisão de Código

> Projeto: **Patrulheiro — Plataforma de Inteligência Legislativa**
> Branch revisado: `claude/code-audit-analysis-4nuXD`
> Data da auditoria: 2026-05-12

## Como ler esta revisão

Este sumário consolida 8 relatórios temáticos. Cada um vive em `/review/` como markdown stand-alone, com sumário próprio, achados numerados, trechos de código com `arquivo:linha`, e seção final "Verificado / OK" para fechar escopo. A leitura recomendada é:

1. Este sumário (geral, top 10 prioridades).
2. `01-seguranca-web.md` e `02-seguranca-workers.md` — superfície de risco.
3. `05-banco-dados.md` — para o achado bloqueador de migrations.
4. `08-integracoes-externas.md` — para a descoberta de drift de provedor LLM e auth INLABS.
5. Os demais (qualidade frontend/workers, auth, stubs) em ordem por interesse.

## Arquivos do review

| Arquivo | Tema | Tamanho |
|---|---|---|
| `00-sumario-executivo.md` | Este arquivo | — |
| `01-seguranca-web.md` | Segurança do front Next.js | grande |
| `02-seguranca-workers.md` | Segurança dos workers FastAPI | grande |
| `03-frontend-qualidade.md` | Erro/UX/navegação no web | médio |
| `04-workers-qualidade.md` | Erro/idempotência/robustez nos workers | médio |
| `05-banco-dados.md` | Migrations, schema, queries SQL | grande |
| `06-autenticacao-sessao.md` | Deep dive em JWT + cookie + login | médio |
| `07-stubs-deadcode-inconsistencias.md` | Stubs, dead code, doc↔código | médio |
| `08-integracoes-externas.md` | Câmara, Senado, INLABS, LLM | grande |

## Contagem agregada de achados

| Severidade | 01 (sec web) | 02 (sec wrk) | 03 (FE) | 04 (WK) | 05 (DB) | 06 (auth) | 07 (stubs) | 08 (int) | **Total** |
|---|---|---|---|---|---|---|---|---|---|
| CRÍTICO | 4 | 3 | — | — | 2 | 3 | — | — | **12** |
| ALTO | 6 | 7 | 5 | 8 | 6 | 5 | — | 10 | **47** |
| MÉDIO | 8 | 9 | 11 | 13 | 8 | 4 | — | 20+ | **73+** |
| BAIXO/INFO | 9 | 8 | 12 | 9 | 9 | 6 | — | 8 | **61+** |

(Relatório 07 categoriza por tipo, não severidade — ver lá.)

---

## Top 10 prioridades

Em ordem decrescente de impacto vs esforço. Cada item linka o relatório de origem.

### 1. Migrations ausentes para `votacoes` e `votos` `(05-C-1)`
Banco em produção foi populado de forma não-rastreada. Clone-e-deploy de outra instância **não compila**. **Bloqueador para reprodutibilidade** e para qualquer cenário de DR. Recomendado: escrever migration `005_votacoes_votos.sql` com schema deduzido das queries.

### 2. XSS em `/dou/[id]` via `dangerouslySetInnerHTML` sem sanitização `(01-C-1)`
Renderiza HTML do XML do INLABS sem allowlist. Qualquer ato publicado com `<script>`/`onerror=` executa no domínio autenticado. **Crítico** para a integridade de cookies de sessão e ações no DB. Recomendado: sanitizar com DOMPurify (front) e/ou bleach (worker antes de salvar).

### 3. Fallback hardcoded de `SESSION_SECRET` e `WORKER_SECRET` `(01-C-2, 02-C-1, 06-C-1)`
Ambos têm defaults conhecidos no repositório público. Se as envs não forem setadas em qualquer ambiente, autenticação web e da API workers ficam triviais de forjar. **Falha cara em deploys novos**. Recomendado: validador de boot que aborta se a env estiver ausente.

### 4. LLM drift: doc diz Anthropic Claude, código usa OpenAI gpt-4.1-nano `(07-D-1, 08)`
CLAUDE.md, arquitetura.md, requirements.txt e o nome dos modelos divergem entre si. Auditoria fica confusa, custo não está sob a chave certa, e prompt caching/melhores capacidades de Sonnet ficam não-aproveitadas. **Resolver decisão e atualizar todos os artefatos** (incluindo `anthropic_api_key` órfão em `config.py`).

### 5. Prompt injection via ementas/títulos vindos das APIs públicas `(02-C-2)`
Qualquer autor de proposição ou redator de ato do DOU consegue alterar a classificação/alinhamento gerados pelo LLM, com persistência direta no banco. Cenário concreto: campanha hostil "neutraliza" proposições do radar. Recomendado: delimitadores XML e validação Pydantic do output.

### 6. Login sem rate limit + senha em texto-claro como env `(01-C-3, 01-C-4, 01-A-1, 06-C-2)`
Combinação tornar brute-force factível em horas, ainda mais com `!==` que vaza timing. Recomendado: argon2id hash + rate limit em proxy.ts (5/15min/IP).

### 7. Ausência total de headers de segurança HTTP `(01-A-4)`
Nenhuma CSP, HSTS, X-Frame-Options. Ampliação de blast radius de qualquer XSS (item 2). Recomendado: bloco `headers()` em `next.config.ts` com CSP estrita.

### 8. `enricher.py` apaga `tramitacoes` antes de re-inserir, sem transação `(02-A-6, 04-A-2)`
Data loss silencioso se o loop quebrar no meio. A plataforma é vendida como "monitora tramitação fielmente" — quebra do core. Recomendado: envolver em `conn.transaction()`.

### 9. Server actions de mutação sem verificação de sessão `(01-A-2)`
`toggleMonitoramento`, `markAllRead`, `markAlertasRead`, `logout` dependem apenas do middleware. Em adicionar uma rota pública (ex.: `/api/...`) ou desligar `proxy.ts` por engano, mutations ficam abertas. Recomendado: `getSession()` no topo de cada action.

### 10. Páginas sem `error.tsx`/`not-found.tsx`/`loading.tsx` `(03-A-1)`
Qualquer DB hiccup mostra erro genérico em inglês ao usuário. `notFound()` exibe a tela padrão do Next, sem branding. Recomendado: criar global + por rota.

---

## Achados notáveis fora do top 10

- **Tabela `alertas.lido` vs `notificacoes.lida`** — inconsistência ortográfica que já gerou bug 500 (`05-C-2`).
- **Paginação faltando no Senado** — `_fetch_proposicoes` faz 1 chamada com `itens=500` e descarta o resto (`04-A-3`, `08`).
- **`__import__("asyncio").sleep`** — copy-paste leftover em `main.py:191` (`04-A-7`).
- **Bug em `_to_dt` no Senado** — `fmt[:len(s[:19])]` trunca formato dinamicamente, gera matches espúrios (`08`).
- **`UPSERT` em `dou_atos` com colunas NULL** — UNIQUE com NULL trata como distinto, permite duplicação (`05-A-4`).
- **Cookie de tema `pl_theme` lido server-side sem validação** — pequena superfície adicional (`01-M-1`, `06-A-4`).
- **`StatusWidget` re-roda 5 queries pesadas a cada page-load** — desperdício se o tooltip não é aberto (`07-F-1`).
- **64 `print()` em workers** — sem logger estruturado, sem PII redaction (`02-M-3`).
- **`anthropic`, `lxml`, `boto3`, `redis`, `next-auth` instalados sem uso** — superfície de supply chain.
- **MESES hardcoded** em `filters-mobile.tsx` — listava fev/mar 2026 enquanto hoje é maio 2026 (`03-M-4`).

---

## Áreas que estão OK

Confirmado e documentado em cada relatório:
- **SQL injection** — 100% das queries usam placeholders parametrizados (`$1, $2 …`) tanto no `pg` (web) quanto no `asyncpg` (workers).
- **Idempotência** das ingestões — `ON CONFLICT` aplicado consistentemente em proposicoes/votacoes/votos/tramitacoes/embeddings.
- **HttpOnly + SameSite=Lax + Secure** corretos no cookie de sessão.
- **`notFound()`/`redirect()`** usados corretamente em todas as rotas dinâmicas.
- **External links** com `rel="noopener noreferrer"` 100% do tempo.
- **CHECK constraints** em enums críticos (alinhamento, impacto, risco).
- **`gen_random_uuid()`** e PK consistente.
- **WORKER_SECRET via header** em todos os endpoints de mutação (apenas `/health` é público).
- **Padrões CSS via tokens** consistentes — refatoração simples no futuro.
- **Server vs client components** corretamente segregados.

---

## Recomendação geral de roadmap (não-vinculante)

Mesmo sem alterar código agora, é útil organizar prioridades:

**Sprint imediato (1 semana, antes do go-live de 2026-05-29 previsto no SPRINTS):**
- Items 1, 2, 3, 7 — riscos onde acidente em deploy é fatal.

**Sprint seguinte (2 semanas):**
- Items 4, 5, 8, 9, 10.

**Polishing:**
- Top 10 restante + cleanup de dead code.

---

## Notas metodológicas

- Auditoria executada por leitura linha-a-linha (não amostragem) de **todos** os `.ts`/`.tsx`/`.py`/`.sql` do projeto, mais arquivos de infra (Docker, GitHub Actions, eslint config, package.json, requirements.txt) e a documentação (CLAUDE.md, SPRINTS.md, arquitetura).
- Foram tentados 8 sub-agentes em paralelo. 7 falharam por rate-limit do servidor LLM no momento da execução; 1 (integrações externas) completou e entregou o relatório `08-integracoes-externas.md`. Os 7 restantes foram refeitos manualmente pelo agente principal — todos os achados foram extraídos diretamente da leitura do código, sem inferência ou citação inventada.
- Toda referência `arquivo:linha` foi verificada com `Read`/`grep`. Nenhuma CVE ou vulnerabilidade conhecida do pacote foi enumerada — escopo limita-se ao código deste repositório.
- Quando uma checagem manual confirmou ausência do problema (e.g. SQL injection), está listada na seção "Verificado / OK" do relatório correspondente.
