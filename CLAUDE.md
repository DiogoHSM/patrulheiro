# Patrulheiro — Plataforma de Inteligência Legislativa

## Stack

### Web (`/web`)
- **Next.js 16.2.0** (App Router, React 19.2.4)
- **TypeScript 5**, **Tailwind CSS 4**
- **pg 8.20** — conexão direta ao PostgreSQL (sem ORM, sem Supabase client)
- **jose 6 + next-auth 5** — autenticação por sessão JWT
- Deploy: **EasyPanel** via webhook no GitHub Actions (push em `main` com mudanças em `web/**`)

### Workers (`/workers`)
- **Python 3.12**, **FastAPI 0.115**, **uvicorn**
- **asyncpg** — conexão async ao PostgreSQL
- **anthropic 0.42** — classificação e análise de alinhamento
- **httpx** — chamadas às APIs da Câmara e Senado
- **Pydantic 2** — validação de schemas

### Banco de dados
- **PostgreSQL local** (NÃO usa Supabase em produção)
- `DATABASE_URL` — variável de ambiente usada por ambos web e workers
- Sem RLS, sem Supabase Auth

---

## Estrutura do repositório

```
patrulheiro/
├── web/                          # Next.js app
│   ├── app/
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Redirect → /dashboard
│   │   ├── login/page.tsx        # Login page
│   │   ├── actions/
│   │   │   ├── auth.ts           # Login/logout server actions
│   │   │   └── monitoramentos.ts # Monitorar proposição
│   │   └── (dashboard)/          # Rotas protegidas
│   │       ├── layout.tsx        # Sidebar + StatusWidget + auth guard
│   │       ├── dashboard/        # Visão geral
│   │       ├── proposicoes/      # Lista + detalhe [id]
│   │       ├── deputados/        # Lista + detalhe [id]
│   │       ├── senadores/        # Lista + detalhe [id]
│   │       ├── votacoes/         # Lista + detalhe [id] (votos nominais)
│   │       ├── posicoes/         # Posições do partido
│   │       └── inbox/            # Notificações
│   ├── components/
│   │   ├── sidebar.tsx           # Navegação lateral
│   │   ├── badge.tsx             # Badge de alinhamento
│   │   ├── photo.tsx             # Photo + PartidoLogo (client components)
│   │   ├── parlamentares-list.tsx# Lista interativa de parlamentares (client)
│   │   ├── sort-controls.tsx     # Controles de sort reutilizáveis
│   │   ├── status-widget.tsx     # Widget de status de ingestão
│   │   ├── filters-mobile.tsx    # Filtros mobile
│   │   ├── theme-toggle.tsx      # Toggle dark/light
│   │   └── monitorar-button.tsx  # Botão de monitoramento
│   └── lib/
│       ├── db.ts                 # Pool pg: query() + queryOne()
│       └── session.ts            # Verificação de sessão JWT
│
└── workers/                      # Python workers
    └── app/
        ├── config.py             # Configurações / env vars
        ├── models/schemas.py     # Pydantic schemas
        ├── ingestion/
        │   ├── normalizer.py                 # Normalização de dados da Câmara/Senado
        │   ├── camara.py                     # Ingestão de proposições da Câmara
        │   ├── senado.py                     # Ingestão de proposições do Senado
        │   ├── enricher.py                   # Enriquecimento de proposições Câmara + votos
        │   ├── enricher_senado_autores.py    # Autores do Senado
        │   ├── enricher_senado_votacoes.py   # Votações do plenário do Senado (incremental)
        │   └── enricher_camara_votos.py      # Backfill de votos individuais Câmara (MAP-114)
        └── processing/
            ├── classifier.py     # Classificação temática via Claude Haiku
            └── alignment.py      # Análise de alinhamento via Claude Sonnet
```

---

## Banco — tabelas principais

| Tabela | Descrição |
|---|---|
| `proposicoes` | Proposições legislativas (Câmara + Senado). `fonte = 'camara'` ou `'senado'` |
| `proposicao_autores` | Autores das proposições. `fonte_id` é o ID do autor na API de origem |
| `votacoes` | Votações. `fonte = NULL` (Câmara) ou `'senado'`. `votacao_id` é UUID interno |
| `votos` | Votos individuais. `deputado_id` (mal nomeado — guarda `codigoParlamentar` mesmo para senadores) |
| `posicoes_partido` | Posições do partido por eixo |
| `notificacoes` | Notificações internas (inbox) |
| `sync_control` | Controle de ingestão por fonte |

### Campo `fonte` em votações
- `votos.votacao_id` aponta para `votacoes.id` (UUID) — não há ambiguidade de fonte
- `votacoes.fonte IS NULL` → Câmara; `'senado'` → Senado

---

## Convenções de código

### Server Components vs Client Components
- Páginas (data fetching) → Server Components por padrão
- Listas com sort/filter/estado → `"use client"` + `useState`
- **React 19 hydration freeze**: sort com `localeCompare` pode produzir ordem diferente entre Node.js e browser V8, congelando o DOM da lista. Solução: `key` no container da lista que muda com o estado (`key={${filter}-${sort}-${order}}`).

### Fotos e logos
- Foto deputado: `https://www.camara.leg.br/internet/deputado/bandep/{id}.jpg`
- Foto senador: `https://www.senado.leg.br/senadores/img/fotos-oficiais/senador{id}.jpg`
- Logo partido: `https://www.camara.leg.br/internet/Deputado/img/partidos/{SIGLA}.gif`
- Sempre com fallback gracioso (iniciais ou sem logo) — `onError` no `<img>`

### Alinhamento
- `favoravel` → verde (`var(--green)`)
- `contrario` → vermelho (`var(--red)`)
- `neutro` → cinza (`var(--text-dim)`)
- `ambiguo` → amarelo (`var(--yellow)`)

### CSS
- CSS custom properties em `globals.css` — usar `var(--token)` inline em vez de classes Tailwind para cores e superfícies
- `var(--surface)`, `var(--surface-deep)`, `var(--border)`, `var(--text)`, `var(--text-muted)`, `var(--text-dim)`

---

## Deploy

- **GitHub Actions** → push em `main` com `web/**` → webhook EasyPanel
- Workers rodados manualmente ou via script

---

## APIs externas

- Câmara dos Deputados: `https://dadosabertos.camara.leg.br/api/v2/`
- Senado Federal: `https://legis.senado.leg.br/dadosabertos/`

---

## Histórico de atualizações

| Data | Mudança |
|---|---|
| 2026-03-22 | Fix 500 no dashboard: coluna `alertas.lido` (não `lida`) — corrigido em layout, inbox e action |
| 2026-03-22 | Rewrite INLABS auth: cookie-based via `logar.php`; download por seção (DO1–DO3); parser XML via atributos |
| 2026-03-22 | `/dou`: texto do ato renderizado com `dangerouslySetInnerHTML` + collapse/expand |
| 2026-03-22 | `/dou`: filtros padrão inteligentes — última edição disponível + Seção 1 ao abrir sem parâmetros |
| 2026-03-21 | `enricher_camara_votos.py`: backfill de votos individuais da Câmara + endpoint `POST /ingest/camara-votos` |
| 2026-03-21 | Fix votações nominais: placar populado de 123 votações via UPDATE; front classifica por `n_votos > 0` |
| 2026-03-21 | Fotos de parlamentares (`Photo`) e logos de partidos (`PartidoLogo`) em `components/photo.tsx` |
| 2026-03-21 | `parlamentares-list.tsx`: sort/filter client-side com fix de hydration freeze (React 19) |
| 2026-03-21 | Sort buttons à esquerda, Nome→asc por default, % visível no mobile, label "% votação" |
| 2026-03-21 | `/votacoes/[id]`: página de votos nominais com placar, lista por nome/partido/UF e VotoBadge |
| 2026-03-21 | Página de votações nominais: link "Ver votos ↗" em cada linha |
| 2026-03-20 | `StatusWidget`: widget de progresso de ingestão no layout do dashboard |
| ≤ 2026-03-20 | Setup inicial: proposições, deputados, senadores, votações, posições, inbox |
