-- Adiciona flag de situação do parlamentar em proposicao_autores
ALTER TABLE proposicao_autores
    ADD COLUMN IF NOT EXISTS em_exercicio BOOLEAN DEFAULT TRUE;

CREATE INDEX idx_autores_em_exercicio ON proposicao_autores(em_exercicio) WHERE em_exercicio = FALSE;
