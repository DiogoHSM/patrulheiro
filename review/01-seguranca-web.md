# 01 — Análise de Segurança: Web (Next.js 16)

> Escopo: `/home/user/patrulheiro/web` (Next.js 16 App Router, React 19, TypeScript, `pg`, `jose`, `next-auth`).
> Metodologia: leitura linha-a-linha de todos os `.ts/.tsx` em `web/app/**`, `web/lib/**`, `web/components/**`, `web/proxy.ts`, `web/next.config.ts`.

## Sumário executivo

| Severidade | Quantidade |
|---|---|
| CRÍTICO | 4 |
| ALTO | 6 |
| MÉDIO | 8 |
| BAIXO | 6 |
| INFO | 3 |

Os achados mais sérios são, em ordem: **(1)** XSS pleno em `/dou/[id]` via `dangerouslySetInnerHTML` em texto vindo do INLABS sem sanitização; **(2)** fallback inseguro de `SESSION_SECRET` (mesma string em `lib/session.ts` e `proxy.ts`, sem checagem de produção); **(3)** comparação de senha não-constant-time em `login` permitindo timing oracle; **(4)** ausência total de cabeçalhos de segurança (CSP, HSTS, X-Frame-Options) no `next.config.ts`.

A camada de SQL está adequada (uso consistente de placeholders `$1, $2…`). O modelo de autenticação é de "senha única do partido" (não há tabela de usuários), o que limita o espaço de ataque mas concentra todo o risco em um único segredo compartilhado.

---

## CRÍTICO

### C-1 — XSS via `dangerouslySetInnerHTML` em texto não sanitizado (`/dou/[id]`)
- **Arquivo:** `web/app/(dashboard)/dou/[id]/texto-completo.tsx:14-22`
- **Trecho:**
  ```tsx
  <div
    className="text-sm leading-relaxed dou-texto"
    style={{ ... }}
    dangerouslySetInnerHTML={{ __html: texto }}
  />
  ```
- **Problema:** `texto` vem direto de `dou_atos.texto_completo`, que é populado pelo worker a partir do XML do INLABS (`workers/app/ingestion/dou.py:130-134`, função `_cdata` retorna o conteúdo bruto de `<Texto>`/`<corpo>`). Os elementos `Texto` do DOU contêm HTML embutido (`<p>`, `<br>`, `<span class="…">`) — daí o uso de `dangerouslySetInnerHTML`. Mas o XML é uma **fonte externa não-confiável**: qualquer ato com `<script>`, atributo `onerror=`, `<iframe>`, `javascript:href` ou SVG malicioso será executado no domínio autenticado da plataforma.
- **Impacto:** roubo de cookie `pl_session` (apesar do HttpOnly impedir leitura direta, ainda é possível enviar requisições autenticadas via fetch — CSRF interno), exfiltração de dados do dashboard, registro de keystrokes na sessão administrativa, redirecionamento a phishing. O CLAUDE.md confirma que o uso de `dangerouslySetInnerHTML` foi adicionado de forma proposital ("renderizar HTML do texto do ato com `dangerouslySetInnerHTML`") sem etapa de sanitização.
- **Recomendação:** sanitizar com `DOMPurify` em modo allowlist (`<p>`, `<br>`, `<strong>`, `<em>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` apenas) ou processar no worker antes de salvar. Adicionar uma CSP estrita (ver A-4) reduz o blast radius mesmo se a sanitização falhar.

### C-2 — Fallback hardcoded de `SESSION_SECRET` permite forjar JWT em produção
- **Arquivos:** `web/lib/session.ts:4-6` e `web/proxy.ts:4-6`
  ```ts
  const SECRET = new TextEncoder().encode(
    process.env.SESSION_SECRET || "dev-secret-change-in-production-32chars"
  )
  ```
- **Problema:** se a env var não estiver setada em produção (falha de deploy, container restart sem secret), o segredo cai para uma string conhecida e versionada no Git. Como qualquer um pode ler o `lib/session.ts` no repositório público, forjar um cookie `pl_session` válido se torna trivial. Não há nenhum `throw` ou bloqueio em `NODE_ENV === "production"`.
- **Impacto:** bypass total de autenticação se a env var for esquecida ou removida.
- **Recomendação:**
  ```ts
  const raw = process.env.SESSION_SECRET
  if (!raw || raw.length < 32) {
    throw new Error("SESSION_SECRET ausente ou curto demais (>=32 chars)")
  }
  const SECRET = new TextEncoder().encode(raw)
  ```
  e, idealmente, mover essa verificação para um startup hook que falha o boot.

### C-3 — Comparação de senha vulnerável a timing attack
- **Arquivo:** `web/app/actions/auth.ts:7-9`
  ```ts
  if (password !== process.env.ADMIN_PASSWORD) {
    return { error: "Senha incorreta" }
  }
  ```
- **Problema:** `!==` em strings JavaScript é uma comparação byte-a-byte com short-circuit. Mesmo com a latência de rede do EasyPanel/Cloudflare adicionando ruído, é teoricamente possível inferir o prefixo correto da senha em ataques estatísticos prolongados — particularmente porque não há rate limiting (ver A-1). Combinado com o fato de a senha ser longa e fixa, isso degrada a segurança.
- **Recomendação:**
  ```ts
  import { timingSafeEqual } from "node:crypto"
  const expected = Buffer.from(process.env.ADMIN_PASSWORD ?? "")
  const got = Buffer.from(password ?? "")
  const ok = expected.length === got.length && timingSafeEqual(expected, got)
  ```
  Em adição: armazenar `argon2id($ADMIN_PASSWORD)` como hash em vez da senha em claro, e comparar contra o hash.

### C-4 — Senha do partido armazenada em texto claro como env var
- **Arquivo:** `web/app/actions/auth.ts:7` lê `process.env.ADMIN_PASSWORD` diretamente.
- **Problema:** qualquer um com acesso ao painel do EasyPanel, ao runtime do container ou a um core dump consegue ler a senha. Não há hashing/derivação. Em rotação de senha é preciso redeploy e todos os usuários ativos veem o erro só na próxima requisição.
- **Recomendação:** mover para hash com sal único (`argon2id` via `argon2` npm package), armazenado em env como `ADMIN_PASSWORD_HASH`. Em tempo de login, fazer `argon2.verify(hash, input)`.

---

## ALTO

### A-1 — Ausência total de rate limiting / lockout no login
- **Arquivo:** `web/app/actions/auth.ts` — server action `login` aceita qualquer número de tentativas.
- **Problema:** combinada com o modelo de senha única (C-4), um atacante pode disparar dicionários inteiros via POST direto na server action (`Next-Action` header). Não há captcha, throttling, IP-based lockout, nem registro de tentativas.
- **Recomendação:** uma das três:
  1. Middleware (`proxy.ts`) com contador in-memory ou Redis (5 tentativas / 15 min por IP).
  2. Tabela `login_attempts` no Postgres consultada na action.
  3. Cloudflare Turnstile no formulário.

### A-2 — Server actions de mutação não verificam sessão
- **Arquivos:**
  - `web/app/actions/monitoramentos.ts:5-30` (`toggleMonitoramento`, `markAllRead`, `markRead`, `markAlertasRead`)
  - `web/app/actions/auth.ts:14-17` (`logout`)
- **Problema:** o middleware `proxy.ts` protege rotas GET/page mas server actions são chamadas via POST com header `Next-Action: <hash>` para a mesma URL. O matcher cobre `/((?!_next|favicon.ico|pl-logo.svg|api).*)` — então **a server action chamada via página do dashboard é protegida**, mas:
  - Um atacante que descubra o hash da action (estável dentro de um build) pode chamá-la a partir do `/login` (que está em `PUBLIC`). Os Server Actions do Next 16 usam o pathname **da página de origem** para roteamento, então isso não é trivial, mas:
  - Não há defesa em profundidade. Cada action deve revalidar `getSession()` antes da escrita. Se amanhã o middleware for desligado por engano, as mutações ficam abertas.
- **Recomendação:**
  ```ts
  "use server"
  import { getSession } from "@/lib/session"
  export async function toggleMonitoramento(id: string) {
    if (!(await getSession())) throw new Error("unauthorized")
    // ...
  }
  ```

### A-3 — Server actions sem validação/whitelist do `proposicaoId`
- **Arquivo:** `web/app/actions/monitoramentos.ts:5-15`, `markRead(notificacaoId)` linha 22-25.
- **Problema:** `proposicaoId` é tipado como `string` mas usado direto em `WHERE proposicao_id = $1` sem validar que é um UUID. Apesar do `pg` escapar adequadamente o valor (não há SQL injection), um atacante autenticado pode passar qualquer string e poluir os logs/erros do banco. Mais importante: em um app com modelo de "senha única para todo o partido", todo usuário tem acesso a todo monitoramento. Se evoluir para usuários distintos, esta action permite IDOR (qualquer usuário monitora/desmonitora proposição de qualquer outro).
- **Recomendação:** validar com regex de UUID v4 e considerar tabela `monitoramentos.user_id` futura.

### A-4 — Nenhum cabeçalho de segurança HTTP configurado
- **Arquivo:** `web/next.config.ts` — apenas `output: "standalone"`. Nenhum `headers()` exportado.
- **Faltam:**
  - **CSP** (`Content-Security-Policy`): sem ela, o XSS de C-1 é máximo. Deveria pelo menos limitar `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`.
  - **HSTS** (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`).
  - **X-Frame-Options: DENY** (defesa redundante contra clickjacking, embora `frame-ancestors` substitua).
  - **X-Content-Type-Options: nosniff**.
  - **Referrer-Policy: strict-origin-when-cross-origin**.
  - **Permissions-Policy** mínima.
- **Recomendação:**
  ```ts
  const nextConfig: NextConfig = {
    output: "standalone",
    async headers() {
      return [{
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options",    value: "nosniff" },
          { key: "X-Frame-Options",           value: "DENY" },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy",   value: "default-src 'self'; img-src 'self' https://www.camara.leg.br https://www.senado.leg.br data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
        ],
      }]
    }
  }
  ```

### A-5 — Tempo de expiração do JWT muito longo, sem rolling/refresh nem revogação
- **Arquivo:** `web/lib/session.ts:12,20` — `setExpirationTime("7d")` e `maxAge: 60*60*24*7`.
- **Problema:** uma vez emitido, o JWT é válido por 7 dias **mesmo após logout**. `deleteSession()` apaga o cookie no browser do usuário, mas o token continua válido até a expiração — qualquer cópia (extensão maliciosa, log, screen-capture) permanece utilizável. Não há blacklist nem rotação por evento de segurança.
- **Recomendação:** reduzir para 1–4h com renovação automática (sliding session) implementada no middleware, ou manter blacklist em Redis indexada pelo `jti`. Adicionar `jti` ao payload.

### A-6 — JWT payload sem claims de identidade/auditoria
- **Arquivo:** `web/lib/session.ts:10` — `new SignJWT({ auth: true })`.
- **Problema:** o token só carrega `{ auth: true }`. Não há `sub`, `jti`, `iss`, `aud`, IP de emissão, user-agent. Não é possível:
  - distinguir sessões;
  - registrar quem fez qual ação (não há `user_id` para popular `monitoramentos.created_by`);
  - invalidar uma sessão específica.
- **Recomendação:** adicionar pelo menos `jti` (UUID) e `iat`, e ao introduzir usuários, `sub` e `roles`.

---

## MÉDIO

### M-1 — `data-theme` no `<html>` lê cookie sem validação
- **Arquivo:** `web/app/layout.tsx:12-15`
  ```ts
  const theme = jar.get("pl_theme")?.value
  return <html lang="pt-BR" {...(theme ? { "data-theme": theme } : {})}>
  ```
- **Problema:** o valor de `pl_theme` é confiado e renderizado como atributo. Como o cookie é setado pelo cliente em JS sem HttpOnly (`document.cookie = "pl_theme=…"` em `theme-toggle.tsx:23-26`), um valor controlado pelo atacante (via XSS de C-1) entra direto no atributo. Hoje, em React, atributos não disparam handlers, mas:
  - Em conjunto com seletores CSS controlados, abre espaço para CSS injection/data leak.
  - Quebra o princípio de "trust no client input".
- **Recomendação:** allowlist no server: `const theme = ["light","dark"].includes(raw) ? raw : undefined`.

### M-2 — Middleware exclui `/api` mas não há rotas `/api` no app
- **Arquivo:** `web/proxy.ts:25` — `matcher: ["/((?!_next|favicon.ico|pl-logo.svg|api).*)"]`.
- **Problema:** `api` está excluído do middleware. Não há rotas API hoje, mas se forem adicionadas, **ficam públicas por padrão** silenciosamente. Risco alto de exposição futura. Comentário ou validação explícita ausente.
- **Recomendação:** remover `api` do exclude e adicionar `getSession()` nas rotas que precisarem; ou pelo menos comentar que rotas `/api` precisam validar sessão por conta própria.

### M-3 — `cookies()` sem flag `__Host-` prefix
- **Arquivo:** `web/lib/session.ts:16` — cookie name = `pl_session`.
- **Problema:** o prefixo `__Host-` (`__Host-pl_session`) força HttpOnly/Secure/Path=/, sem Domain, e é resistente a sub-domínios maliciosos compartilhando cookies. Adoção é trivial; risco é baixo em arquitetura single-domain mas reforça defesa em profundidade.
- **Recomendação:** quando `NODE_ENV === "production"`, usar `__Host-pl_session`.

### M-4 — `secure: false` em dev pode vazar para staging
- **Arquivo:** `web/lib/session.ts:18` — `secure: process.env.NODE_ENV === "production"`.
- **Problema:** Cloudflare e EasyPanel podem rodar com `NODE_ENV=production` mas atrás de proxies em outros ambientes (staging, preview). Em qualquer deploy não-`production` (preview branch), o cookie iria por HTTP. Mitigação: definir `NODE_ENV` corretamente em todos os ambientes.
- **Recomendação:** trocar para `secure: true` incondicional e impedir HTTP em local com `next dev --experimental-https` quando necessário.

### M-5 — Open Redirect potencial não existe hoje, mas pattern propenso
- **Arquivo:** `web/app/actions/auth.ts:11` — `redirect("/")` é fixo. Bom.
- **Problema:** ao adicionar parâmetro `?next=…` na URL de login (típico em "redirect after login"), há tendência a aceitar valores arbitrários. Hoje não existe, mas é importante prevenir.
- **Recomendação:** se for adicionar, validar que `next` começa com `/` e **não** com `//` ou `/\` para evitar redirect cross-origin.

### M-6 — Pool `pg` global sem limite de tamanho explícito
- **Arquivo:** `web/lib/db.ts:3` — `new Pool({ connectionString: process.env.DATABASE_URL })`.
- **Problema:** o default do `pg` é `max: 10`. Em uma instância web pesada (várias páginas SSR concorrentes), 10 conexões podem ser pouco. Pior: não há `idleTimeoutMillis`, `connectionTimeoutMillis` configurado, então conexões zumbis podem segurar slots indefinidamente. Em um cenário de slow query do DOU (`SELECT * FROM dou_atos WHERE id = $1`, em uma tabela grande sem índice na PK derivada), o pool esgota e responde 500 a todos os usuários autenticados. Isso é DoS por design.
- **Recomendação:**
  ```ts
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000, // não suportado direto, mas via SET statement_timeout
  })
  ```

### M-7 — `query()` retorna `as T[]` sem validação runtime
- **Arquivo:** `web/lib/db.ts:10` — `return rows as T[]`.
- **Problema:** o cast `as T[]` é puramente tipográfico. Se uma coluna for renomeada (já aconteceu — `alertas.lido` vs `alertas.lida` no histórico do CLAUDE.md), o tipo TypeScript mente; o cliente recebe `undefined` e o frontend quebra silenciosamente. Não é segurança strict-sense, mas amplia superfície de falhas em produção.
- **Recomendação:** validar com `zod` em queries de path crítico (`getSession`, listagens), ou ao menos um wrapper que loga campos faltando.

### M-8 — Falta de Subresource Integrity em recursos externos
- **Arquivo:** sidebar/parlamentares-list.tsx usam `<img src="https://www.camara.leg.br/…">` sem `referrerPolicy="no-referrer"`.
- **Problema:** o referrer expõe `https://patrulheiro.example.com/deputados/12345` ao servidor da Câmara/Senado. Hoje, sem dados sensíveis no path, é apenas vazamento de uso da plataforma.
- **Recomendação:** adicionar `referrerPolicy="no-referrer"` nos `<img>` de `photo.tsx`.

---

## BAIXO

### B-1 — Login form sem `autocomplete="current-password"`
`web/app/login/page.tsx:26-34`. Inibe gerenciadores de senha. Não é segurança, é usabilidade que afeta higiene de senhas.

### B-2 — `<form action={action}>` sem `method="post"` explícito
`web/app/login/page.tsx:23` — apesar de o Next.js inferir POST para server actions, deixar implícito é frágil. Adicionar `method="POST"`.

### B-3 — `markAllRead`, `markAlertasRead` operam globalmente
`web/app/actions/monitoramentos.ts:17-30`. Em um app single-user-shared (modelo atual), tudo bem; assim que houver usuários, vira IDOR de massa.

### B-4 — Logs de erro silenciados em `getSession`
`web/lib/session.ts:29-34` — `try { await jwtVerify(token, SECRET); return true } catch { return false }`. Não há log de erros. Em ataque ativo (tentativas de token forjado), não há sinal nos logs.
- **Recomendação:** logar a categoria de erro (`signature`, `expired`, `format`) sem o token.

### B-5 — `URLSearchParams(filters as Record<string, string>)` mistura tipos
`web/app/(dashboard)/proposicoes/page.tsx:62-72,204-210`, `dou/page.tsx:69-79,202-208`. O cast força string mas valores `undefined` viram a string literal `"undefined"` em URLs, poluindo logs e quebrando filtros idempotência.
- **Recomendação:** filtrar entradas falsy antes de instanciar.

### B-6 — Search input sem max length
`/proposicoes` e `/dou` aceitam `q` sem limite. Uma `q` de 100k caracteres faz o `ILIKE '%…%'` varrer indefinidamente.
- **Recomendação:** `maxLength={200}` no input e truncar no server.

---

## INFO

### I-1 — `console.log`/`console.error` no código web
Nenhum `console.log` foi encontrado em produção no `web/` — bom estado. Nada a remover.

### I-2 — `next-auth ^5.0.0-beta.30` instalado mas nunca importado
`web/package.json` lista `next-auth` em dependencies, mas o código usa apenas `jose`. Custo de bundle e atrito de auditoria — recomenda-se remover.

### I-3 — `<img>` em vez de `next/image` em `photo.tsx`
Reduz cache/otimização do Next mas é decisão consciente (foto externa de URL bruta). Para a logo, `next/image` já é usado (`Sidebar`).

---

## Verificado / OK

- **SQL injection**: 100% das queries em `web/app/**`, `web/lib/db.ts` usam placeholders parametrizados (`$1, $2, …`). Não encontrei interpolação de variáveis na string SQL exceto para o número de página/offset (`LIMIT ${PER_PAGE} OFFSET ${offset}`), e ambos são `Number(…)`, não strings de usuário — seguro.
- **HttpOnly + SameSite=Lax**: corretamente setados no cookie de sessão (`lib/session.ts:17-19`).
- **`notFound()`**: usado corretamente nas rotas dinâmicas `/proposicoes/[id]`, `/deputados/[id]`, `/senadores/[id]`, `/votacoes/[id]`, `/dou/[id]` quando o registro não existe.
- **External links**: todos com `target="_blank" rel="noopener noreferrer"` (validado em dashboard, proposicoes/[id], deputado/[id], senador/[id]).
- **Sidebar.logout** usa `<form action={logout}>` (server action), evitando expor o token via XHR.
- **No `eval`, `Function()`, `new Function`** em todo o `web/`.
- **No secrets hardcoded** além do fallback do `SESSION_SECRET` (C-2) e do default do tema. `DATABASE_URL` e `ADMIN_PASSWORD` corretamente lidos de `process.env`.
- **No `dangerouslySetInnerHTML`** em outras rotas além de `dou/[id]/texto-completo.tsx`.

## Arquivos auditados

```
web/app/layout.tsx
web/app/page.tsx
web/app/login/page.tsx
web/app/(dashboard)/layout.tsx
web/app/(dashboard)/dashboard/page.tsx
web/app/(dashboard)/proposicoes/page.tsx
web/app/(dashboard)/proposicoes/[id]/page.tsx
web/app/(dashboard)/deputados/page.tsx
web/app/(dashboard)/deputados/[id]/page.tsx
web/app/(dashboard)/senadores/page.tsx
web/app/(dashboard)/senadores/[id]/page.tsx
web/app/(dashboard)/votacoes/page.tsx
web/app/(dashboard)/votacoes/[id]/page.tsx
web/app/(dashboard)/inbox/page.tsx
web/app/(dashboard)/posicoes/page.tsx
web/app/(dashboard)/dou/page.tsx
web/app/(dashboard)/dou/[id]/page.tsx
web/app/(dashboard)/dou/[id]/texto-completo.tsx
web/app/actions/auth.ts
web/app/actions/monitoramentos.ts
web/components/*.tsx (todos)
web/lib/db.ts
web/lib/session.ts
web/proxy.ts
web/next.config.ts
web/eslint.config.mjs
web/package.json
```
