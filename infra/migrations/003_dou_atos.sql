-- ============================================================
-- DOU — ATOS DO DIÁRIO OFICIAL DA UNIÃO
-- ============================================================
CREATE TABLE dou_atos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edicao            TEXT NOT NULL,          -- data da edição, ex: "2026-03-21"
    secao             TEXT NOT NULL,          -- "1", "2", "3", "1E"
    pagina            INTEGER,
    tipo_ato          TEXT,                   -- ex: "Portaria", "Resolução", "Decreto"
    orgao             TEXT,                   -- ex: "Ministério da Saúde"
    titulo            TEXT,
    texto_completo    TEXT,

    -- Filtro pré-IA
    relevante         BOOLEAN DEFAULT NULL,   -- NULL=não filtrado, TRUE/FALSE após filtro

    -- Pipeline de IA
    processado        BOOLEAN DEFAULT FALSE,
    temas_primarios   TEXT[],
    temas_secundarios TEXT[],
    resumo_executivo  TEXT,
    impacto_estimado  TEXT CHECK (impacto_estimado IN ('alto', 'medio', 'baixo')),

    -- Alinhamento
    alinhamento       TEXT CHECK (alinhamento IN ('favoravel', 'contrario', 'neutro', 'ambiguo')),
    alinhamento_score NUMERIC(3,2),
    alinhamento_just  TEXT,
    risco_politico    TEXT CHECK (risco_politico IN ('alto', 'medio', 'baixo')),
    recomendacao      TEXT,

    created_at        TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(edicao, secao, orgao, titulo)
);

CREATE INDEX idx_dou_atos_edicao      ON dou_atos(edicao DESC);
CREATE INDEX idx_dou_atos_alinhamento ON dou_atos(alinhamento);
CREATE INDEX idx_dou_atos_processado  ON dou_atos(processado) WHERE processado = FALSE;
CREATE INDEX idx_dou_atos_relevante   ON dou_atos(relevante) WHERE relevante = TRUE;
CREATE INDEX idx_dou_atos_impacto     ON dou_atos(impacto_estimado);
CREATE INDEX idx_dou_atos_temas       ON dou_atos USING GIN(temas_primarios);

-- Busca textual por orgão e título
CREATE INDEX idx_dou_atos_fts ON dou_atos
    USING GIN(to_tsvector('portuguese', coalesce(orgao, '') || ' ' || coalesce(titulo, '')));
