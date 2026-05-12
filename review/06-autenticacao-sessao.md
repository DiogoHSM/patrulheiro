# 06 — Autenticação e Sessão (deep dive)

> Escopo: `web/lib/session.ts`, `web/app/actions/auth.ts`, `web/app/login/page.tsx`, `web/proxy.ts`, `web/app/(dashboard)/layout.tsx`, `web/next.config.ts`, `web/package.json`.
> Modelo: senha única do partido + JWT HS256 em cookie, validade 7 dias.

## Sumário executivo

| Severidade | Quantidade |
|---|---|
| CRÍTICO | 3 |
| ALTO | 5 |
| MÉDIO | 4 |
| BAIXO | 3 |
| INFO | 3 |

O modelo é deliberadamente simples ("MVP interno", segundo o `arquitetura-plataforma-legislativa.md` §2.1) — senha única, JWT sem identidade, 7 dias. Para esse cenário, o problema #1 é o **fallback hardcoded de `SESSION_SECRET`** que torna o esquema trivialmente quebrável se a env não estiver setada, seguido de **ausência de rate limit no login** e **senha em texto claro como env var**. A simplicidade do modelo amplifica esses riscos, porque há um único segredo que protege tudo.

---

## CRÍTICO

### C-1 — Fallback público de `SESSION_SECRET` (duplicado em dois arquivos)
- **Arquivo 1:** `web/lib/session.ts:4-6`
  ```ts
  const SECRET = new TextEncoder().encode(
    process.env.SESSION_SECRET || "dev-secret-change-in-production-32chars"
  )
  ```
- **Arquivo 2:** `web/proxy.ts:4-6` — mesma string literal.
- **Problema (1):** se a env não estiver presente em qualquer ambiente (preview, staging, deploy mal-configurado, restart sem secrets), o JWT é assinado/verificado com uma string conhecida e versionada no GitHub. **Forjar `pl_session` é trivial:** qualquer um com acesso ao repo gera um token válido com `jose`.
- **Problema (2):** mesmo segredo replicado em dois arquivos quebra DRY — em rotação, há risco de atualizar só um lugar.
- **Recomendação:**
  1. Mover para um único módulo `web/lib/env.ts` que lança erro se SESSION_SECRET for ausente ou tiver < 32 bytes.
  2. Não permitir fallback em produção.
  3. Considerar `argon2` de uma chave-mestre como segredo (com `pepper` em outro env).

### C-2 — Senha do partido em texto claro como variável de ambiente
- **Arquivo:** `web/app/actions/auth.ts:7` — `if (password !== process.env.ADMIN_PASSWORD)`.
- **Problema:** ver `01-seguranca-web.md` C-3 e C-4 para o detalhe. Resumindo: (a) `!==` não é timing-safe; (b) qualquer um com acesso ao painel/container/log lê a senha; (c) rotação exige redeploy com indisponibilidade.
- **Recomendação:** armazenar `argon2id` hash em env (`ADMIN_PASSWORD_HASH`) e usar `argon2.verify(...)`. Em adicional, suportar múltiplas senhas (uma por persona do partido) para futura migração a tabela de usuários sem rewrite.

### C-3 — JWT não tem `jti`, `sub`, `iat`, nem mecanismo de revogação
- **Arquivo:** `web/lib/session.ts:9-13`
  ```ts
  const token = await new SignJWT({ auth: true })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(SECRET)
  ```
- **Problema:** payload é apenas `{ auth: true }`. Não há:
  - `iat` (Issued At) — `jose` adiciona automaticamente? **Não em `SignJWT` por padrão**, é preciso `.setIssuedAt()`.
  - `jti` — sem isso, não há como revogar um token específico.
  - `sub` — sem identidade do usuário (aceitável no modelo single-password, mas impede auditoria).
  - `iss`/`aud` — sem verificação de emissor.
  - `nbf` — sem validade futura.
  
  Combinado com expiração de 7 dias e ausência de revogação no logout (`deleteSession()` apaga **apenas o cookie do cliente**, o token continua válido):
- **Impacto:** roubo de cookie → atacante mantém acesso por até 7 dias mesmo após "logout".
- **Recomendação:**
  ```ts
  const token = await new SignJWT({ auth: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("4h")
    .setJti(crypto.randomUUID())
    .setIssuer("patrulheiro")
    .setAudience("patrulheiro-web")
    .sign(SECRET)
  ```
  + tabela `revoked_jti(jti TEXT PRIMARY KEY, revoked_at TIMESTAMPTZ)` consultada no `getSession()`.

---

## ALTO

### A-1 — Sem rate limit no login → brute force trivial
- **Arquivo:** `web/app/actions/auth.ts` — sem throttle. Cloudflare na frente (per CLAUDE.md/arquitetura) pode parcialmente mitigar, mas:
  - Server actions chamadas via página interna não passam por WAF idêntico.
  - Default Cloudflare não bloqueia 500 tentativas/minuto.
- **Recomendação:** Cloudflare Turnstile + middleware contador de tentativas em memória (5/15min/IP) ou Redis.

### A-2 — `getSession()` aceita JWT recém-expirado por janela de skew?
- **Arquivo:** `web/lib/session.ts:30` — `await jwtVerify(token, SECRET)` sem opções.
- O `jose` por default valida `exp` (e `nbf` se presente). Sem `clockTolerance`, expiração é estrita. **Adequado.**
- **Não é problema. Apenas confirmação:** está OK.

### A-3 — `proxy.ts` e `getSession()` duplicam lógica de verificação
- **Arquivo 1:** `web/proxy.ts:16-21` — `jwtVerify(token, SECRET)`.
- **Arquivo 2:** `web/lib/session.ts:30` — idem.
- **Problema:** duas implementações de verificação. Se uma virar mais estrita (claims, audience), a outra vira backdoor. Outro padrão: middleware (proxy) só checa presença; layout do dashboard chama `getSession` para verificação completa. Hoje, o middleware verifica assinatura e expiração — ok, mas a duplicação é fragilidade.
- **Recomendação:** mover a verificação para `lib/session.ts` e importar do `proxy.ts`. Risco: middleware do Next 16 corre em edge runtime, que pode não aceitar `pg`, `crypto` Node-only. `jose` é edge-safe — provavelmente possível.

### A-4 — Cookie de tema (`pl_theme`) sem proteção e usado em SSR
- **Arquivo:** `web/app/layout.tsx:11-15` — lê `pl_theme` e injeta em `<html data-theme={...}>`.
- **Arquivo:** `web/components/theme-toggle.tsx:23-26` — set via `document.cookie` sem HttpOnly.
- **Problema:** valor controlado por cliente (incluindo via XSS de `01-C-1`) entra em atributo HTML. Hoje React escapa o atributo, mas é boa prática validar.
- **Recomendação:** allowlist no server.

### A-5 — `<html data-theme=...>` no SSR não pré-renderiza o tema dark "system"
- Linha 12 do `app/layout.tsx`: `// undefined → sem data-theme → media query decide`. **Ok**. Mas em navegadores com `prefers-color-scheme: dark`, ainda há FOUC enquanto JS não chega. Aceitável.

---

## MÉDIO

### M-1 — Logout apenas apaga cookie no cliente
- **Arquivo:** `web/lib/session.ts:37-40` e `web/app/actions/auth.ts:14-17`. JWT continua válido até expirar.
- **Recomendação:** ver C-3 — tabela de revogação.

### M-2 — Sem proteção `__Host-` prefix no cookie
- **Arquivo:** `web/lib/session.ts:16` — nome `pl_session`. Em domínio único é suficiente, mas `__Host-pl_session` reforça defesa.

### M-3 — `next-auth` instalado mas não usado
- **Arquivo:** `web/package.json:13` — `"next-auth": "^5.0.0-beta.30"`. Nenhum import. Custo de bundle + atrito de auditoria.
- **Recomendação:** remover.

### M-4 — Não há logs de evento de auth (login OK/falha, logout, expiração)
- Nenhuma chamada a `console.log` ou logger nas actions. Em produção, ataque ativo passa despercebido.
- **Recomendação:** logar com sanitização (sem o token, sem a senha tentada) e categorizar (`auth.login.ok`, `auth.login.fail`, `auth.logout`).

---

## BAIXO

### B-1 — `httpOnly: true` setado — ok ✓
### B-2 — `sameSite: "lax"` — ok para SSR ✓
### B-3 — `path: "/"` — ok ✓

(Mantidos para confirmação no audit trail.)

---

## INFO

### I-1 — `jose` v6 + HS256 com chave de 32 bytes é seguro
**Desde que** a env `SESSION_SECRET` seja realmente de 32+ bytes de entropia. CMD para gerar: `openssl rand -base64 48`.

### I-2 — Middleware do Next 16 nomeado `proxy.ts`
Consistente com a nota em `web/AGENTS.md` ("This is NOT the Next.js you know"). Aceitável após verificar nos docs do Next 16.

### I-3 — Decisão arquitetural de "senha única" é explícita no documento
`arquitetura-plataforma-legislativa.md` §2.1 confirma o trade-off. **Para o MVP interno, é defensável** mas exige rate limit e senha-hash (C-2).

---

## Verificado / OK

- HttpOnly cookie ✓
- SameSite Lax ✓
- `secure: true` em prod ✓
- Expiração curta o suficiente para uso single-session (7d aceitável para MVP)
- `notFound()` + `redirect("/login")` corretos em todas as rotas protegidas
- Server actions corretamente marcadas como `"use server"`
- Não há GraphQL/REST API exposta sem auth

## Arquivos auditados

```
web/lib/session.ts
web/lib/db.ts
web/app/actions/auth.ts
web/app/login/page.tsx
web/app/(dashboard)/layout.tsx
web/proxy.ts
web/next.config.ts
web/package.json
web/app/layout.tsx
web/components/sidebar.tsx (logout button)
web/components/theme-toggle.tsx (cookie de tema)
```
