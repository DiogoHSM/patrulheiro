-- ============================================================
-- MONITORAMENTOS
-- ============================================================
CREATE TABLE monitoramentos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(proposicao_id)
);

CREATE INDEX idx_monitoramentos_proposicao ON monitoramentos(proposicao_id);

-- ============================================================
-- NOTIFICACOES
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

CREATE INDEX idx_notificacoes_proposicao ON notificacoes(proposicao_id);
CREATE INDEX idx_notificacoes_lida ON notificacoes(lida) WHERE lida = FALSE;
CREATE INDEX idx_notificacoes_created ON notificacoes(created_at DESC);

-- url_perfil na tabela de autores (se ainda não existir)
ALTER TABLE proposicao_autores ADD COLUMN IF NOT EXISTS url_perfil TEXT;

-- orientacao_pl e fonte nas votacoes (se ainda não existirem)
ALTER TABLE votacoes ADD COLUMN IF NOT EXISTS orientacao_pl TEXT;
ALTER TABLE votacoes ADD COLUMN IF NOT EXISTS fonte TEXT;
