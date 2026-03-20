# Plano de Sprints — Plataforma de Inteligência Legislativa

> **Projeto:** Patrulheiro
> **Capacidade:** 1 dev full-time
> **Total estimado:** 10 semanas
> **Início previsto:** 2026-03-23
> **Go-live previsto:** 2026-05-29

---

## Resumo dos Sprints

| Sprint | Foco | Duração | Período |
|---|---|---|---|
| Sprint 0 | Setup & Infraestrutura | 1 semana | 23/03 – 28/03 |
| Sprint 1 | Ingestão de dados | 2 semanas | 30/03 – 11/04 |
| Sprint 2 | Classificação & Alinhamento | 2 semanas | 14/04 – 25/04 |
| Sprint 3 | Busca semântica & RAG | 2 semanas | 28/04 – 09/05 |
| Sprint 4 | Alertas & Relatórios | 2 semanas | 12/05 – 23/05 |
| Sprint 5 | Polish & Go-live | 1 semana | 26/05 – 30/05 |

---

## Sprint 0 — Setup & Infraestrutura
**Duração:** 1 semana (23/03 – 28/03)
**Objetivo:** Toda a infraestrutura configurada, repos criados, CI/CD rodando, schema SQL aplicado.

### Repositórios
- [ ] Criar repo `legislativo-web` (Next.js 15 boilerplate com App Router)
- [ ] Criar repo `legislativo-workers` (FastAPI boilerplate com Docker)
- [ ] Criar repo `legislativo-infra` (SQL migrations, docs)
- [ ] Configurar `.gitignore`, `README.md` e proteção de branch `main` em cada repo

### Supabase
- [ ] Criar projeto Supabase (Pro)
- [ ] Habilitar extensões: `vector`, `pg_trgm`, `unaccent`
- [ ] Aplicar migration completa do schema (seção 6 do documento de arquitetura)
  - Tabelas: `proposicoes`, `proposicao_autores`, `tramitacoes`, `votacoes`, `votos`, `dou_atos`, `embeddings`, `posicoes_partido`, `alertas`, `sync_control`, `audit_log`
  - Views: `v_proposicoes_criticas`, `v_resumo_diario`
  - Função: `search_similar`
- [ ] Configurar RLS em todas as tabelas
- [ ] Criar usuário de serviço (service_role) e usuários de teste (admin, assessor, viewer)
- [ ] Configurar Supabase Auth (email/senha + magic link)
- [ ] Configurar Supabase Storage (bucket para inteiro teor dos PDFs)

### Ambiente local — Workers (Docker Compose)
- [ ] Criar `docker-compose.yml` em `legislativo-workers`: serviços `workers` (FastAPI) + `redis:7-alpine`
- [ ] Criar `.env.example` com todas as variáveis necessárias
- [ ] Verificar health check em `GET /health` rodando via `docker compose up`
- [ ] Documentar comandos de setup local no README

### Ambiente local — Web (Next.js)
- [ ] Configurar `.env.local` com variáveis do Supabase e Anthropic
- [ ] Verificar `npm run dev` rodando em `localhost:3000`
- [ ] Criar script `scripts/trigger-ingest.sh` para disparar endpoints de ingestão manualmente (substitui cron em dev)

> **Nota:** Vercel e Railway são configurados apenas no Sprint 5 (go-live). Em dev, workers rodam via Docker Compose e Next.js via `npm run dev`. Migração é só conectar os repos às plataformas e copiar as env vars — zero mudança de código.

### Serviços externos
- [ ] Cadastro e acesso ao INLABS (XMLs do DOU) — `inlabs.in.gov.br`
- [ ] Criar conta Resend (alertas de e-mail)
- [ ] Criar conta Twilio (WhatsApp alerts)
- [ ] Criar conta Sentry (monitoramento de erros) — vincular a ambos os repos

### Critério de aceite
- Deploy de ambos os serviços (web + workers) bem-sucedido em produção
- Schema SQL aplicado sem erros
- Health checks passando: `GET /health` (Railway) e `GET /api/health` (Vercel)

---

## Sprint 1 — Ingestão de Dados
**Duração:** 2 semanas (30/03 – 11/04)
**Objetivo:** Pipeline de ingestão funcionando para Câmara, Senado e DOU, com cron jobs ativos e dados persistindo no Supabase.

### Worker — Câmara dos Deputados (`ingestion/camara.py`)
- [ ] Implementar `fetch_proposicoes(data_inicio, tipos)` — paginação automática até esgotar resultados
- [ ] Implementar `fetch_tramitacoes(proposicao_id)` — histórico completo
- [ ] Implementar `fetch_autores(proposicao_id)`
- [ ] Implementar `fetch_votacoes(proposicao_id)` + `fetch_votos(votacao_id)`
- [ ] Lógica de dedup: verificar existência por `(fonte, tipo, numero, ano)` antes de inserir
- [ ] Lógica de atualização incremental: cursor em `sync_control`, buscar apenas desde `last_sync`
- [ ] Download e upload para Supabase Storage do inteiro teor (PDF), quando disponível
- [ ] Endpoint interno: `POST /ingest/camara`
- [ ] Atualizar `sync_control` após ingestão bem-sucedida (status, records_synced)

### Worker — Senado Federal (`ingestion/senado.py`)
- [ ] Implementar `fetch_materias(data_inicio)` — suporte a XML e JSON via header `Accept`
- [ ] Implementar `fetch_tramitacoes_senado(codigo)`
- [ ] Implementar `fetch_votacoes_senado(codigo)`
- [ ] Normalizar schema do Senado para o schema unificado (`normalizer.py`)
- [ ] Lógica de dedup e atualização incremental
- [ ] Endpoint interno: `POST /ingest/senado`

### Worker — DOU (`ingestion/dou.py`)
- [ ] Implementar download de XMLs diários via INLABS
- [ ] Parser de XML do DOU: extrair `tipo_ato`, `orgao`, `titulo`, `texto_completo`, `secao`, `pagina`, `edicao`
- [ ] Filtro de relevância pré-IA: descartar atos de baixíssima relevância (nomeações rotineiras, licitações pequenas, etc.) com lista de padrões a ignorar
- [ ] Implementar fallback: API da Imprensa Nacional para monitoramento intra-dia (reverse-engineered, baseado no Ro-DOU)
- [ ] Endpoint interno: `POST /ingest/dou`

### Normalização (`ingestion/normalizer.py`)
- [ ] Schema unificado `ProposicaoNormalized` (Pydantic) para Câmara + Senado
- [ ] Schema `DouAtoNormalized` (Pydantic) para DOU
- [ ] Função `normalize_proposicao(raw, casa)` com mapeamento de campos
- [ ] Tratamento de campos ausentes ou malformados com fallbacks seguros

### Fila Redis / BullMQ (`queue/worker.py`)
- [ ] Configurar conexão BullMQ com Redis
- [ ] Implementar producer: `enqueue(job_name, payload)`
- [ ] Implementar consumer: processar jobs `process_proposicao` e `process_dou_ato`
- [ ] Retry automático com backoff exponencial (máx 3 tentativas)
- [ ] Dead-letter queue para jobs que falharam após todas as tentativas
- [ ] Logging estruturado por job (início, fim, erros)

### Cron Jobs (Vercel)
- [ ] `GET /api/cron/ingest-camara` — dispara `POST /ingest/camara` no Railway com secret header
- [ ] `GET /api/cron/ingest-senado` — idem para Senado
- [ ] `GET /api/cron/ingest-dou` — idem para DOU
- [ ] Configurar `vercel.json` com schedules conforme tabela do documento (seção 4.4)
- [ ] Autenticação: verificar `CRON_SECRET` no header (Vercel injeta automaticamente)

### Frontend básico (Sprint 1)
- [ ] Layout principal: sidebar + header (`app/(dashboard)/layout.tsx`)
- [ ] Autenticação: página de login com Supabase Auth (`app/(auth)/login/page.tsx`)
- [ ] Middleware de proteção de rotas (redirecionar para login se não autenticado)
- [ ] Página de proposições: tabela paginada com colunas básicas (tipo, número, ementa, data, situação, fonte)
- [ ] Filtros básicos: tipo, fonte (câmara/senado), período

### Critério de aceite
- Ingestão manual (`POST /ingest/camara`, `/senado`, `/dou`) executando sem erros
- Proposições e atos persistindo no Supabase com dados corretos
- Cron jobs configurados e disparando nos horários definidos
- Página de proposições exibindo dados reais da Câmara e Senado
- `sync_control` atualizado após cada execução

---

## Sprint 2 — Classificação & Alinhamento
**Duração:** 2 semanas (14/04 – 25/04)
**Objetivo:** Pipeline de IA funcionando — todas as proposições novas sendo classificadas tematicamente e avaliadas quanto ao alinhamento partidário.

### Classificação temática (`processing/classifier.py`)
- [ ] Implementar `classify_proposicao(proposicao)` usando Claude Haiku 4.5
- [ ] Prompt conforme especificação do documento (seção 5.2) — retorno em JSON estruturado
- [ ] Parsing e validação do JSON de resposta com Pydantic
- [ ] Persistir campos no registro da proposição: `temas_primarios`, `temas_secundarios`, `entidades_citadas`, `resumo_executivo`, `impacto_estimado`, `urgencia_ia`
- [ ] Implementar `classify_dou_ato(ato)` — prompt adaptado para atos do DOU
- [ ] Job na fila: `classify_proposicao` e `classify_dou_ato`

### Gestão de posições do partido
- [ ] CRUD de posições no Supabase (`posicoes_partido`)
- [ ] Endpoint da API: `GET /api/posicoes`, `POST`, `PUT`, `DELETE`
- [ ] Página de administração no frontend: `app/(dashboard)/posicoes/page.tsx`
  - Listagem por eixo
  - Adicionar/editar/remover posição
  - Ativar/desativar posição sem deletar
- [ ] Loader inicial: importar posições do YAML de exemplo (seção 5.4) na primeira execução
- [ ] Trigger: ao salvar alterações nas posições, enfileirar reprocessamento de todas as proposições ativas (`situacao NOT IN ('arquivada', 'rejeitada', 'vetada')`)

### Análise de alinhamento (`processing/alignment.py`)
- [ ] Implementar `analyze_alignment(proposicao, posicoes_texto)` usando Claude Sonnet 4.6
- [ ] Prompt conforme especificação (seção 5.3)
- [ ] **Prompt caching:** cachear system prompt + posições do partido (seção 8.3)
- [ ] Parsing e validação do JSON de resposta
- [ ] Persistir: `alinhamento`, `alinhamento_score`, `alinhamento_just`, `risco_politico`, `recomendacao`
- [ ] Implementar `analyze_alignment_dou(ato, posicoes_texto)` — análogo para atos DOU

### Integração no pipeline
- [ ] Após classificação bem-sucedida → enfileirar análise de alinhamento
- [ ] Marcar proposição como `processado = TRUE` após conclusão de ambas as etapas
- [ ] Job de reprocessamento: `POST /reprocess/alignment` para rodar em batch (sprint completo a partir de um `data_inicio`)

### Frontend — Sprint 2
- [ ] Filtros avançados na lista de proposições: alinhamento, tema, impacto, urgência
- [ ] Badges coloridos por alinhamento (favorável = verde, contrário = vermelho, neutro = cinza, ambíguo = amarelo)
- [ ] Página de detalhe da proposição (`app/(dashboard)/proposicoes/[id]/page.tsx`):
  - Ementa e resumo executivo
  - Card de análise de alinhamento (alinhamento, score, justificativa, risco, recomendação)
  - Timeline de tramitação
  - Autores com partido e UF
  - Histórico de votações (resultado + votos sim/não)
  - Link para PDF do inteiro teor (Supabase Storage)
- [ ] Dashboard principal: cards de resumo (total monitoradas, contrárias ativas, favoráveis, votações da semana)
- [ ] "Radar de proposições críticas": lista de proposições contrárias + alta confiança + tramitando (view `v_proposicoes_criticas`)

### Critério de aceite
- Todas as proposições novas sendo classificadas automaticamente após ingestão
- Análise de alinhamento rodando com prompt caching ativo
- Interface de gestão de posições funcionando para o admin
- Dashboard exibindo dados reais de alinhamento
- Mudança nas posições do partido dispara reprocessamento em batch

---

## Sprint 3 — Busca Semântica & RAG
**Duração:** 2 semanas (28/04 – 09/05)
**Objetivo:** Sistema de busca semântica funcional na lista de proposições e chat conversacional com IA respondendo perguntas em linguagem natural sobre o acervo.

### Geração de embeddings (`processing/embedder.py`)
- [ ] Integrar Voyage-3 (preferencial) ou `text-embedding-3-small` (OpenAI) como fallback
- [ ] Implementar `generate_embedding(text) -> vector[1024]`
- [ ] Implementar `chunk_text(text, chunk_size=512, overlap=64) -> List[str]`
- [ ] Implementar `embed_proposicao(proposicao_id)`:
  - Se tem inteiro teor: chunkar + embedding por chunk
  - Se não tem: embedding de ementa + resumo executivo
- [ ] Implementar `embed_dou_ato(ato_id)` — análogo
- [ ] Implementar `embed_posicoes_partido()` — embeddings das posições para uso no RAG
- [ ] Upsert na tabela `embeddings` com metadados (tipo, ano, temas, alinhamento)
- [ ] Job na fila: `embed_proposicao` e `embed_dou_ato` (executado após análise de alinhamento)

### Busca vetorial no Supabase
- [ ] Verificar índice HNSW criado corretamente (`idx_embeddings_vector`)
- [ ] Testar função `search_similar` com queries reais — ajustar `match_threshold` se necessário
- [ ] Endpoint da API: `POST /api/search/semantic` no Next.js
  - Recebe `query: string`, `filters: { source_type?, alinhamento?, temas? }`
  - Gera embedding da query, chama `search_similar`, retorna proposições completas

### RAG — Chat com IA (`api/chat/route.ts`)
- [ ] Implementar pipeline RAG completo (seção 7.2 do documento):
  1. Gerar embedding da pergunta do usuário
  2. Buscar chunks similares via `search_similar`
  3. Enriquecer com metadados das proposições referenciadas
  4. Chamar Claude Sonnet 4.6 com contexto montado
- [ ] Streaming de resposta (SSE / ReadableStream) para UX fluida
- [ ] Citar proposições nas respostas (tipo + número + ano)
- [ ] Histórico de conversa na sessão (últimas N mensagens como contexto adicional)
- [ ] Guardar queries e respostas para análise futura (tabela `audit_log`)

### Frontend — Sprint 3
- [ ] **Busca semântica na lista de proposições:**
  - Campo de busca com suporte a linguagem natural ("proposições sobre privatização de estatais")
  - Toggle entre busca textual (full-text Postgres) e busca semântica (vetorial)
  - Resultados ranqueados por similaridade com score visível
- [ ] **Chat IA** (`app/(dashboard)/chat/page.tsx`):
  - Interface de chat estilo messaging
  - Streaming de resposta em tempo real
  - Citações clicáveis (abrem detalhe da proposição em painel lateral ou nova aba)
  - Sugestões de perguntas frequentes (exemplos da seção 9.2 do documento)
  - Indicador de "digitando" durante streaming
- [ ] **Proposições relacionadas** na página de detalhe:
  - Seção "Proposições Similares" (busca vetorial por similaridade com a proposição atual)
  - Cards com ementa, alinhamento e score de similaridade

### Critério de aceite
- Embeddings sendo gerados para todas as proposições processadas
- Busca semântica retornando resultados relevantes (testar com 10 queries de exemplo)
- Chat RAG respondendo perguntas com citações corretas e sem alucinações
- Streaming funcionando no frontend sem erros
- Latência do chat < 10s para queries típicas

---

## Sprint 4 — Alertas & Relatórios
**Duração:** 2 semanas (12/05 – 23/05)
**Objetivo:** Sistema de alertas operacional (email + push + WhatsApp) e geração automática de briefings semanais com export PDF.

### Sistema de alertas — Backend (`processing/alerter.py`)
- [ ] Implementar `check_and_send_alerts(proposicao_id)` — lógica conforme seção 10.3
- [ ] Implementar criação de alerta na tabela `alertas` para cada tipo:
  - `proposicao_contraria` — score >= 0.7
  - `proposicao_favoravel` — score >= 0.8
  - `votacao_iminente` — proposição entra em pauta de votação
  - `dou_relevante` — ato contrário + relevância alta
  - `tramitacao_critica` — proposição contrária avança de fase
- [ ] Buscar assinantes ativos por tipo de alerta (tabela `user_alert_subscriptions` — criar se não existir)
- [ ] Respeitar configuração de horário de silêncio por usuário

### E-mail alerts (Resend)
- [ ] Implementar `send_email_alert(email, alert, proposicao)` via Resend SDK
- [ ] Template HTML responsivo para e-mail de alerta (ementa, alinhamento, justificativa, link direto)
- [ ] Template para digest diário (resumo de alertas do dia)

### WhatsApp alerts (Twilio)
- [ ] Implementar `send_whatsapp_alert(phone, alert, proposicao)` via Twilio API
- [ ] Template aprovado pela Meta para mensagem de alerta (texto compacto, dados essenciais, link)
- [ ] Configurar número de WhatsApp Business no Twilio

### Push alerts (Supabase Realtime)
- [ ] Configurar `Realtime` no Supabase para a tabela `alertas`
- [ ] No frontend: assinar mudanças em tempo real com `supabase.channel()`
- [ ] Exibir notificação toast ao receber novo alerta via Realtime
- [ ] Badge de contador de alertas não lidos no ícone da sidebar

### Frontend — Central de alertas
- [ ] Página de alertas (`app/(dashboard)/alertas/page.tsx`):
  - Lista de alertas com filtros por tipo, severidade, lido/não lido
  - Marcar como lido individualmente ou em lote
  - Clique no alerta abre detalhe da proposição/ato relacionado
- [ ] Configuração de alertas por usuário (`app/(dashboard)/configuracoes/page.tsx`):
  - Quais tipos de alerta receber
  - Canais por tipo (email, WhatsApp, push)
  - Horário de silêncio
  - Filtros adicionais (temas, severidade mínima)

### Briefings automáticos
- [ ] Worker `generate_weekly_briefing()` usando Claude Opus 4.6:
  - Resumo das proposições novas na semana por alinhamento
  - Proposições críticas que avançaram na tramitação
  - Atos relevantes do DOU na semana
  - Recomendações de ação
- [ ] Cron job: toda segunda-feira às 06:00 BRT (`POST /ingest/briefing` via Vercel Cron)
- [ ] Persistir briefing como documento no Supabase Storage
- [ ] Enviar por e-mail automaticamente para usuários com role `admin` e `assessor`

### Relatórios sob demanda
- [ ] Endpoint: `POST /api/reports/generate` — gera relatório para período ou tema
- [ ] Página de relatórios (`app/(dashboard)/relatorios/page.tsx`):
  - Lista de briefings semanais gerados
  - Formulário para relatório sob demanda: período, tema, tipo de alinhamento
  - Visualização inline do relatório em markdown
- [ ] Export PDF: usar `@react-pdf/renderer` ou Puppeteer via API route para gerar PDF do relatório

### Critério de aceite
- Alertas sendo gerados e enviados por e-mail para proposições contrárias novas
- WhatsApp enviando para número de teste
- Push via Supabase Realtime funcionando no browser
- Briefing semanal gerado corretamente com dados reais
- Export PDF funcionando sem erros

---

## Sprint 5 — Polish & Go-live
**Duração:** 1 semana (26/05 – 30/05)
**Objetivo:** Sistema estável, documentado e entregue ao cliente.

### Qualidade e robustez
- [ ] Testes end-to-end do pipeline completo: ingestão → classificação → alinhamento → embedding → alerta
- [ ] Teste de reprocessamento em batch: alterar posição do partido → verificar re-score
- [ ] Verificar health check de cron jobs: `sync_control` com `last_sync` atualizado
- [ ] Alertas internos: se `last_sync` defasado > 24h, enviar alerta via Resend para admin
- [ ] Revisar e ativar Sentry em produção (frontend + workers)
- [ ] Revisar logs no Logflare e Railway Metrics

### UX e performance
- [ ] Gráfico de timeline no dashboard: proposições por dia × alinhamento (últimos 30 dias)
- [ ] Loading states e skeletons em todas as páginas com dados assíncronos
- [ ] Estados de erro com mensagem amigável (sem stack traces expostos)
- [ ] Responsividade mobile básica (sidebar colapsável, listas legíveis em telas menores)
- [ ] Otimizar queries lentas identificadas nos logs (adicionar índices se necessário)
- [ ] Cache de queries frequentes no Next.js (`unstable_cache` ou React cache)

### Segurança — revisão final
- [ ] Verificar que `service_role` key nunca aparece no frontend bundle
- [ ] Confirmar RLS ativo e testado para cada role (admin, assessor, viewer)
- [ ] Verificar autenticação do secret header (`X-Worker-Secret`) nas rotas de cron
- [ ] Testar que usuário `viewer` não consegue editar posições nem configurar alertas globais
- [ ] Revisar variáveis de ambiente: nenhuma key sensível hardcoded no código

### Documentação
- [ ] `README.md` do repo `legislativo-web`: setup local, variáveis de ambiente, comandos
- [ ] `README.md` do repo `legislativo-workers`: setup local, Docker, endpoints internos
- [ ] Guia do cliente (PDF ou Notion): como usar o dashboard, configurar posições, interpretar alertas
- [ ] Guia de operação: como monitorar cron jobs, o que fazer se ingestão falhar

### Onboarding do cliente
- [ ] Popular `posicoes_partido` com as posições reais do partido cliente
- [ ] Criar contas de usuário para assessores e liderança (roles corretos)
- [ ] Rodada inicial de ingestão histórica: últimos 90 dias de proposições
- [ ] Processar embeddings e alinhamento do acervo histórico
- [ ] Sessão de treinamento: demonstração do dashboard, chat IA, alertas

### Go-live
- [ ] Configurar domínio personalizado no Vercel
- [ ] Verificar SSL e headers de segurança (CSP, HSTS)
- [ ] Ativar monitoramento de uptime (Vercel Analytics ou UptimeRobot)
- [ ] Confirmar com cliente que crons estão rodando e alertas chegando

### Critério de aceite
- Sistema rodando há 48h sem erros críticos no Sentry
- Cliente consegue fazer login, visualizar proposições, usar o chat e receber alertas
- Briefing semanal gerado e entregue por e-mail automaticamente
- Documentação entregue

---

## Dependências entre Sprints

```
Sprint 0 (infra)
    └── Sprint 1 (ingestão)
            └── Sprint 2 (classificação)
                    ├── Sprint 3 (busca/RAG) ← depende de embeddings do S2
                    └── Sprint 4 (alertas)   ← depende de alinhamento do S2
                            └── Sprint 5 (go-live)
```

## Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| API do Senado retorna XML malformado | Média | Parser defensivo + testes com amostras reais antes do Sprint 1 |
| INLABS exige aprovação manual do cadastro | Média | Iniciar cadastro no Sprint 0 com antecedência; fallback para API da Imprensa Nacional |
| Qualidade da análise de alinhamento abaixo do esperado | Média | Reservar 2 dias no Sprint 2 para refinamento de prompts com exemplos reais do cliente |
| Volume de proposições históricas maior que estimado | Baixa | Processar histórico em batch controlado (100/h) para não extourar rate limits |
| Aprovação de template WhatsApp pela Meta lenta | Alta | Iniciar processo de aprovação no Sprint 0; ter e-mail como fallback completo |
| Custo de Claude API acima do estimado | Baixa | Monitorar consumo após Sprint 2; ajustar para Haiku onde Sonnet não é necessário |

---

## Marcos de entrega (milestones)

| Marco | Data | Entregável |
|---|---|---|
| **M1 — Infraestrutura pronta** | 28/03 | Ambos os serviços em produção, schema aplicado |
| **M2 — Dados fluindo** | 11/04 | Ingestão ativa, proposições visíveis no dashboard |
| **M3 — IA classificando** | 25/04 | Alinhamento calculado, posições editáveis, dashboard com filtros |
| **M4 — Chat operacional** | 09/05 | Busca semântica e chat RAG respondendo perguntas |
| **M5 — Alertas ativos** | 23/05 | E-mail, WhatsApp e push funcionando, briefings automáticos |
| **M6 — Go-live** | 30/05 | Sistema em produção, cliente treinado |
