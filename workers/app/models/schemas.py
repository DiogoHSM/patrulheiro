from datetime import date
from pydantic import BaseModel


class ProposicaoNormalized(BaseModel):
    fonte: str
    fonte_id: str
    tipo: str
    numero: int
    ano: int
    ementa: str
    url_tramitacao: str | None = None
    url_inteiro_teor: str | None = None
    storage_path: str | None = None
    data_apresentacao: date | None = None
    situacao: str | None = None
    regime: str | None = None
    orgao_atual: str | None = None


class AutorNormalized(BaseModel):
    nome: str
    partido: str | None = None
    uf: str | None = None
    fonte_id: str | None = None
    tipo_autoria: str = "autor"


class TramitacaoNormalized(BaseModel):
    data: str | None = None
    descricao: str
    orgao: str | None = None
    situacao: str | None = None
    url: str | None = None
    fonte_id: str | None = None


class IngestResult(BaseModel):
    fonte: str
    inseridas: int = 0
    atualizadas: int = 0
    erros: int = 0
    mensagem: str = ""
