# 03 — Qualidade: Frontend Web (Next.js 16)

> Escopo: tratamento de erros, navegação/continuidade, caminhos quebrados, lógica incompleta, hydration, UX.
> Diretório: `/home/user/patrulheiro/web`. Stack: Next 16, React 19, TS, pg.

## Sumário executivo

| Severidade | Quantidade |
|---|---|
| ALTO | 5 |
| MÉDIO | 11 |
| BAIXO | 8 |
| INFO | 4 |

Mais críticos: **(A-1)** ausência total de `error.tsx`/`not-found.tsx`/`loading.tsx` em todas as rotas — qualquer falha de DB derruba a página com a tela genérica do Next; **(A-2)** server actions sem feedback de erro/loading apropriado (`toggleMonitoramento`, `markAllRead` falham silenciosamente); **(A-3)** Inbox página redireciona o sidebar mas o sidebar não incluí "Inbox" na nav principal (está no rodapé do componente — frágil), **(A-4)** sort/filter client-side em listas de centenas de itens sem paginação na página de Votações (`LIMIT 200` no SQL silenciosa) — corta dados sem aviso, **(A-5)** múltiplas rotas dinâmicas dependem de coluna que pode estar `NULL` (e.g. `data_apresentacao`) sem fallback de UI consistente.

A qualidade geral é razoável para um MVP: padrões CSS-via-tokens consistentes, server components corretamente usados para fetching, client components corretamente marcados com `"use client"`. Mas as bordas (erros, vazio, loading, edge cases) não estão tratadas.

---

## ALTO

### A-1 — Nenhuma rota tem `error.tsx`, `loading.tsx` ou `not-found.tsx`
- **Arquivos:** verificado em `/home/user/patrulheiro/web/app/**` — apenas `page.tsx` e `layout.tsx` existem.
- **Problema:** se qualquer `queryOne`/`query` lançar (postgres down, tabela ausente, timeout), o usuário vê a Next.js error page genérica em inglês. Não há graceful degradation. Mais grave: `notFound()` é chamado em várias rotas dinâmicas (`/proposicoes/[id]`, `/deputados/[id]`, …) mas não há `not-found.tsx` por rota nem global — o Next exibe sua página padrão sem o sidebar/branding da plataforma.
- **Recomendação:** criar `web/app/error.tsx`, `web/app/not-found.tsx`, e por rota se quiser mensagem específica (`web/app/(dashboard)/proposicoes/[id]/not-found.tsx`).

### A-2 — Server actions de mutação não dão feedback de sucesso/erro ao usuário
- **Arquivos:**
  - `web/components/monitorar-button.tsx:9` — `startTransition(() => toggleMonitoramento(proposicaoId))`. Não trata exceção. Se a action falhar, o botão volta ao estado anterior sem aviso.
  - `web/app/(dashboard)/inbox/page.tsx:79-88,146-151` — `<form action={markAllRead}>` e `<form action={markAlertasRead}>`. Sem `useFormState`/`useActionState` para erro, sem `useFormStatus` para loading.
- **Problema:** UX silenciosa em falha. Se o Postgres travar 30s, o botão fica pendurado e o usuário recarrega — possível dupla escrita.
- **Recomendação:** usar `useActionState` em todos os formulários, exibir toast/inline em caso de erro.

### A-3 — Sidebar tem "Inbox" como botão separado fora do array `nav`, fácil de quebrar
- **Arquivo:** `web/components/sidebar.tsx:9-21` define `nav`, mas Inbox (linhas 74-95) é renderizado à parte. Não aparece em `nav.map` — design dual.
- **Problema:** se um dev adicionar mais itens depois de Inbox (ex.: relatórios), tem que decidir onde colocar; já há inconsistência de padrão. Mais importante: `usePathname` linha 24 usa `pathname.startsWith(href)`, então `/inbox` matched corretamente, mas qualquer rota nova `/inbox/…` ativa o item — comportamento esperado mas frágil.
- **Recomendação:** unificar tudo em `nav` com um campo opcional `badge`. Ou documentar a separação explicitamente.

### A-4 — Página `/votacoes` faz `LIMIT 200` sem indicar truncamento ao usuário
- **Arquivo:** `web/app/(dashboard)/votacoes/page.tsx:21` — `ORDER BY v.data DESC NULLS LAST LIMIT 200`.
- **Problema:** se houver >200 votações (frequente em fim de ano legislativo), o usuário **não sabe** que há mais. Não há paginação, não há "ver mais", não há subtítulo "mostrando 200 mais recentes". Dados sumiriam silenciosamente.
- **Recomendação:** adicionar paginação como `/proposicoes` e `/dou`, ou ao menos mensagem "mostrando 200 mais recentes — use filtros".

### A-5 — Pagination links em `/proposicoes` e `/dou` perdem filtros se algum valor for `undefined`
- **Arquivos:**
  - `web/app/(dashboard)/proposicoes/page.tsx:204-210`
  - `web/app/(dashboard)/dou/page.tsx:202-208`
- **Trecho:**
  ```ts
  new URLSearchParams({ ...(filters as Record<string, string>), page: String(page - 1) })
  ```
- **Problema:** `filters as Record<string, string>` aceita `undefined` values mas `URLSearchParams` stringifica como `"undefined"`. URLs ficam tipo `?mes=undefined&fonte=undefined&page=2`. Em `/dou`, `effectiveFilters` tem defaults, mas valores `undefined` (e.g. `q`) ainda passam. O server `getProposicoes` interpreta `"undefined"` como filtro válido e retorna zero resultados.
- **Recomendação:** helper:
  ```ts
  function clean(filters: SearchParams): Record<string, string> {
    return Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== undefined && v !== ""))
  }
  ```

---

## MÉDIO

### M-1 — `Photo` (`web/components/photo.tsx:21`) usa `<img>` sem `referrerPolicy` nem `loading="lazy"`
- 100s de fotos podem ser renderizadas em `/deputados`. Lazy-loading reduz pressure de rede.
- **Recomendação:** `<img loading="lazy" decoding="async" referrerPolicy="no-referrer">`.

### M-2 — Hydration freeze ainda possível em `parlamentares-list.tsx` em casos extremos
- **Arquivo:** `web/components/parlamentares-list.tsx:149` — chave do container `key={${partido ?? "all"}-${sort}-${order}}`. CLAUDE.md confirma a estratégia.
- **Problema:** o `key` muda a cada interação, **causando re-mount completo da lista** a cada toggle de partido — perde scroll position, animações. Funciona como remédio para hydration mas com efeito colateral de UX.
- **Recomendação:** ordenar no server (passar `sort`/`order` via SearchParams como em `/proposicoes`) e remover state client-side para essas listas. Ou apenas re-key quando realmente necessário (sort change).

### M-3 — `SortControls` é componente cliente não-utilizado
- **Arquivo:** `web/components/sort-controls.tsx` define `<SortControls>` com `useRouter`, mas grep não encontra import em nenhum `page.tsx` (substituído pelo controle inline em `parlamentares-list.tsx`).
- **Recomendação:** remover componente órfão. Confirma: `grep -r "SortControls" web/app/` → 0 matches.

### M-4 — `FiltersMobile` (`web/components/filters-mobile.tsx:4-8`) tem lista de meses hardcoded
- **Arquivo:** linhas 5-8 — `MESES = [{value:"2026-02", …}, {value:"2026-03", …}]`. A página `proposicoes/page.tsx:52-54` repete o array.
- **Problema:** quando virar abril, alguém precisa lembrar de editar duas listas. Já em maio (data de hoje 2026-05-12), os dois meses listados estão obsoletos — usuários não conseguem filtrar pelo mês atual.
- **Recomendação:** computar do banco (`SELECT DISTINCT TO_CHAR(data_apresentacao, 'YYYY-MM') FROM proposicoes ORDER BY 1 DESC LIMIT 6`) ou gerar dinamicamente client-side a partir da data atual.

### M-5 — Rotas dinâmicas dependem de colunas que podem estar NULL sem fallback consistente
- **Arquivo:** `web/app/(dashboard)/deputados/[id]/page.tsx:18-22` — query usa `DISTINCT ON (fonte_id)` ordenado por `created_at DESC`. Se o deputado tiver múltiplas linhas em `proposicao_autores` (por entrada legislativa nova), pega o registro mais recente — OK. Mas se `partido` for `NULL` ali, mostra apenas o nome.
- **Problema:** o estado "deputado existente mas sem partido" é tratado mas pouco visível; o usuário entende que faltam dados? A página mostra `Photo`, nome, sem partido/UF — pode parecer bug. CLAUDE.md fala do backfill MAP-91 já feito, mas para os que falharam (404 na API da Câmara), permanece sem dados.
- **Recomendação:** estado "Dados incompletos — atualize via worker `/enrich/camara-autores`" para o admin (única persona). Ou silenciosamente OK.

### M-6 — `categorizaVoto` em `/votacoes/[id]` tem caso suspeito `"nÃo"`
- **Arquivo:** `web/app/(dashboard)/votacoes/[id]/page.tsx:9`
  ```ts
  if (t === "não" || t === "nao" || t === "nÃo") return "nao"
  ```
- **Problema:** `"nÃo"` (com `Ã` maiúsculo) é um valor specific de bug de encoding. Aceitar isso significa que o dado entra no banco corrompido. Melhor sanear na ingestão e não na renderização.
- **Recomendação:** investigar de onde vem `"nÃo"` (provavelmente latin-1 lido como UTF-8 no XML do Senado). Corrigir no `enricher_senado_votacoes.py`.

### M-7 — `OrientacaoBadge` em `votacoes/page.tsx:40-57` tem lógica frágil
- **Trecho:**
  ```ts
  const isContra = orientacao.toLowerCase().includes("não") || ...
  const isFavor = orientacao.toLowerCase() === "sim" || orientacao.toLowerCase().includes("favor")
  ```
- **Problema:** valores como `"LIBERADO"` (visto em `senadores/[id]/page.tsx:55`) caem no `else` mas têm semântica diferente de "Não orientado". Não diferencia.

### M-8 — `timeAgo` em `inbox/page.tsx:47-54` retorna `"-1m atrás"` ou `"0m atrás"`
- Para `created_at` no futuro (drift de relógio entre web e DB) ou na mesma hora exata, gera `"0m atrás"`. Trivial mas estranho. Adicionar guard para `< 0` retornar `"agora"`.

### M-9 — `Photo` carrega URL de senador da Câmara
- **Arquivo:** `web/components/parlamentares-list.tsx:42-45` `fotoUrl` constrói URL diferente por fonte. OK. Mas:
- **Arquivo:** `web/app/(dashboard)/deputados/[id]/page.tsx:56` constrói **inline** `https://www.camara.leg.br/internet/deputado/bandep/${id}.jpg`.
- **Problema:** duplicação. Senador faz o mesmo na `senadores/[id]/page.tsx:71`. Refatorar pra função única.

### M-10 — Form em `proposicoes/page.tsx:87-101` perde os filtros se o usuário enviar `q` vazio
- **Trecho:** os `<input type="hidden">` linhas 91-94 são renderizados apenas quando o filtro existe. Se existirem, o form `GET` envia tudo — OK. Mas `q` é renderizado sempre (linha 88) com `defaultValue={filters.q}`. Se vazio, vira `?q=&mes=…` — funciona, mas no servidor `filters.q === ""` é falsy. Adequado.

### M-11 — `posicoes/page.tsx` não tem CTA para editar
- **Arquivo:** `web/app/(dashboard)/posicoes/page.tsx:48-51` literalmente diz "Para adicionar ou editar posições, use a tabela `posicoes_partido` no banco de dados". Página é só leitura.
- **Problema:** decisão consciente para MVP, mas não há indicação de quando isso será resolvido. Em uma instância em produção, força o admin a abrir psql.

---

## BAIXO

### B-1 — Hover em `<Link>` adiciona `hover:underline` em links que já têm tom destacado
Padrão visual. Aceitável.

### B-2 — Sem skeleton/spinner para `<MonitorarButton>` enquanto a action está pending
`monitorar-button.tsx:21-22` mostra `…` mas falta `aria-busy`.

### B-3 — Falta `aria-label` em botões com apenas emoji
`status-widget.tsx:43-54` — botão ícone sem `aria-label` (tem `title` mas não é equivalente).
`sidebar.tsx:124-130` — botão de menu mobile (`☰`) sem `aria-label`.

### B-4 — `inbox/page.tsx:101` usa `n.lida` truthy mas valor de DB é boolean — OK
Mas `bg-color-mix` em inline style com `var(--primary)` faz query CSS computada por linha. Performance.

### B-5 — `parlamentares-list.tsx:38-39` `selectStyle` é constante mas é re-criado a cada render (objeto inline)
Trivial. Mover pra fora ou usar CSS class.

### B-6 — `dou/page.tsx:60-63` aplica defaults se `secao`/`data` ausentes, mas o `hasFilters` (linha 81) **não conta esses defaults**
Resultado: botão "Limpar" não aparece quando `secao` veio de default. Usuário não percebe que está filtrado. Esperado é exibir Limpar sempre que `effectiveFilters` desviar do real "tudo".

### B-7 — `texto-completo.tsx:5-6` tem heurística `texto.length > 1500`
Conta caracteres incluindo tags HTML. Para um texto curto com muitas tags, abre "Ver mais" sem necessidade. Para um texto longo com poucas tags, pode não abrir. Razoável para MVP.

### B-8 — `theme-toggle.tsx` lê cookie e aplica em `useEffect` — pode haver FOUC
A leitura do tema no server (`app/layout.tsx:11-12`) cobre o caso, mas se o usuário trocar tema em outra aba, esta não sincroniza até reload.

---

## INFO

### I-1 — Server components corretamente usados em data-fetching
Padrão clean. Todas as `page.tsx` são `async`, sem `"use client"` desnecessário.

### I-2 — Externos abertos com `rel="noopener noreferrer"`
100% das ocorrências de `target="_blank"` têm `rel` correto (verificado: dashboard, proposições, deputado, senador, votações).

### I-3 — Uso correto de `notFound()` em rotas dinâmicas
`proposicoes/[id]:25`, `deputados/[id]:25`, `senadores/[id]:21`, `votacoes/[id]:47`, `dou/[id]:19`.

### I-4 — `useTransition` em `monitorar-button.tsx` evita full-page reload
Boa prática React 19.

---

## Verificado / OK

- Páginas usam `searchParams: Promise<SearchParams>` corretamente (Next 16 async API).
- `cookies()` usado com `await` (`app/layout.tsx:11`, `lib/session.ts:15,26,38`).
- `revalidatePath` chamado após mutações relevantes (`monitoramentos.ts:14,19,24,29`).
- `usePathname` com `startsWith` faz match correto para rotas pai/filhas.
- Padrão de cor consistente via `var(--token)`.
- Imports relativos e absolutos via `@/` consistentes.

## Arquivos auditados

Todos os arquivos em `web/app/**` e `web/components/**`, mais `web/lib/**`, `web/proxy.ts`, `web/next.config.ts`, `web/eslint.config.mjs`, `web/postcss.config.mjs`, `web/package.json`, `web/app/globals.css`.

Lista exaustiva idêntica à do relatório `01-seguranca-web.md`.
