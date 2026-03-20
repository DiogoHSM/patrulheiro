-- Extensões
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================
-- PROPOSIÇÕES
-- ============================================================
CREATE TABLE proposicoes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fonte             TEXT NOT NULL CHECK (fonte IN ('camara', 'senado')),
    fonte_id          TEXT NOT NULL,
    tipo              TEXT NOT NULL,
    numero            INTEGER NOT NULL,
    ano               INTEGER NOT NULL,
    ementa            TEXT NOT NULL,
    resumo_executivo  TEXT,
    url_tramitacao    TEXT,
    url_inteiro_teor  TEXT,
    storage_path      TEXT,
    data_apresentacao DATE,
    situacao          TEXT,
    regime            TEXT,
    orgao_atual       TEXT,

    temas_primarios   TEXT[],
    temas_secundarios TEXT[],
    entidades_citadas TEXT[],
    impacto_estimado  TEXT CHECK (impacto_estimado IN ('alto', 'medio', 'baixo')),
    urgencia_ia       TEXT CHECK (urgencia_ia IN ('alta', 'media', 'baixa')),

    alinhamento       TEXT CHECK (alinhamento IN ('favoravel', 'contrario', 'neutro', 'ambiguo')),
    alinhamento_score NUMERIC(3,2),
    alinhamento_just  TEXT,
    risco_politico    TEXT CHECK (risco_politico IN ('alto', 'medio', 'baixo')),
    recomendacao      TEXT,

    processado        BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(fonte, tipo, numero, ano)
);

CREATE INDEX idx_proposicoes_alinhamento ON proposicoes(alinhamento);
CREATE INDEX idx_proposicoes_situacao ON proposicoes(situacao);
CREATE INDEX idx_proposicoes_temas ON proposicoes USING GIN(temas_primarios);
CREATE INDEX idx_proposicoes_data ON proposicoes(data_apresentacao DESC);
CREATE INDEX idx_proposicoes_fonte_id ON proposicoes(fonte, fonte_id);
CREATE INDEX idx_proposicoes_processado ON proposicoes(processado) WHERE processado = FALSE;

-- Busca textual
CREATE INDEX idx_proposicoes_ementa_fts ON proposicoes
    USING GIN(to_tsvector('portuguese', ementa));

-- ============================================================
-- AUTORES
-- ============================================================
CREATE TABLE proposicao_autores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    nome            TEXT NOT NULL,
    partido         TEXT,
    uf              TEXT,
    fonte_id        TEXT,
    tipo_autoria    TEXT DEFAULT 'autor',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_autores_proposicao ON proposicao_autores(proposicao_id);
CREATE INDEX idx_autores_partido ON proposicao_autores(partido);

-- ============================================================
-- TRAMITAÇÕES
-- ============================================================
CREATE TABLE tramitacoes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposicao_id   UUID REFERENCES proposicoes(id) ON DELETE CASCADE,
    data            TIMESTAMPTZ,
    descricao       TEXT NOT NULL,
    orgao           TEXT,
    situacao        TEXT,
    url             TEXT,
    fonte_id        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tramitacoes_proposicao ON tramitacoes(proposicao_id);
CREATE INDEX idx_tramitacoes_data ON tramitacoes(data DESC);

-- ============================================================
-- EMBEDDINGS (OpenAI text-embedding-3-small = 1536 dims)
-- ============================================================
CREATE TABLE embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type     TEXT NOT NULL CHECK (source_type IN ('proposicao', 'dou')),
    source_id       UUID NOT NULL,
    chunk_index     INTEGER DEFAULT 0,
    content         TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_embeddings_vector ON embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);

-- ============================================================
-- POSIÇÕES DO PARTIDO
-- ============================================================
CREATE TABLE posicoes_partido (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    eixo            TEXT NOT NULL,
    posicao         TEXT NOT NULL,
    ativa           BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ALERTAS
-- ============================================================
CREATE TABLE alertas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            TEXT NOT NULL,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    source_type     TEXT,
    source_id       UUID,
    severidade      TEXT CHECK (severidade IN ('critica', 'alta', 'media', 'baixa')),
    lido            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alertas_lido ON alertas(lido);
CREATE INDEX idx_alertas_created ON alertas(created_at DESC);

-- ============================================================
-- SYNC CONTROL
-- ============================================================
CREATE TABLE sync_control (
    fonte           TEXT PRIMARY KEY,
    last_sync       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT DEFAULT 'success',
    records_synced  INTEGER DEFAULT 0,
    error_message   TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BUSCA SEMÂNTICA
-- ============================================================
CREATE OR REPLACE FUNCTION search_similar(
    query_embedding vector(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10,
    filter_alinhamento TEXT DEFAULT NULL
)
RETURNS TABLE (
    source_id UUID,
    source_type TEXT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.source_id,
        e.source_type,
        e.content,
        e.metadata,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM embeddings e
    WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
        AND (filter_alinhamento IS NULL OR e.metadata->>'alinhamento' = filter_alinhamento)
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================
-- VIEW: proposições críticas
-- ============================================================
CREATE VIEW v_proposicoes_criticas AS
SELECT
    p.*,
    array_agg(DISTINCT pa.nome) FILTER (WHERE pa.nome IS NOT NULL) AS autores_nomes,
    array_agg(DISTINCT pa.partido) FILTER (WHERE pa.partido IS NOT NULL) AS autores_partidos,
    (SELECT t.descricao FROM tramitacoes t
     WHERE t.proposicao_id = p.id ORDER BY t.data DESC LIMIT 1
    ) AS ultima_tramitacao
FROM proposicoes p
LEFT JOIN proposicao_autores pa ON pa.proposicao_id = p.id
WHERE p.alinhamento = 'contrario'
  AND p.situacao NOT IN ('arquivada', 'rejeitada', 'vetada')
GROUP BY p.id
ORDER BY p.alinhamento_score DESC NULLS LAST, p.data_apresentacao DESC NULLS LAST;
