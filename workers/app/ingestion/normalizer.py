from datetime import date
from app.models.schemas import ProposicaoNormalized, AutorNormalized, TramitacaoNormalized


TIPOS_VALIDOS = {"PL", "PEC", "PLP", "MPV", "PDL", "PRC", "PRS", "REQ"}


def normalizar_camara(raw: dict) -> ProposicaoNormalized | None:
    tipo = raw.get("siglaTipo", "")
    if tipo not in TIPOS_VALIDOS:
        return None

    numero_raw = raw.get("numero") or 0
    ano_raw = raw.get("ano") or 0
    ementa = (raw.get("ementa") or "").strip()

    if not ementa or not numero_raw or not ano_raw:
        return None

    data_ap = None
    if raw.get("dataApresentacao"):
        try:
            data_ap = date.fromisoformat(raw["dataApresentacao"][:10])
        except ValueError:
            pass

    status_proposicao = raw.get("statusProposicao") or {}

    return ProposicaoNormalized(
        fonte="camara",
        fonte_id=str(raw.get("id", "")),
        tipo=tipo,
        numero=int(numero_raw),
        ano=int(ano_raw),
        ementa=ementa,
        url_tramitacao=raw.get("urlInteiroTeor"),
        url_inteiro_teor=raw.get("urlInteiroTeor"),
        data_apresentacao=data_ap,
        situacao=status_proposicao.get("descricaoSituacao"),
        regime=status_proposicao.get("regime"),
        orgao_atual=status_proposicao.get("siglaOrgao"),
    )


def normalizar_autor_camara(raw: dict) -> AutorNormalized:
    return AutorNormalized(
        nome=raw.get("nome", "Desconhecido"),
        partido=raw.get("siglaPartido"),
        uf=raw.get("siglaUf"),
        fonte_id=str(raw.get("id", "")),
        tipo_autoria=raw.get("tipoAutor", "autor").lower(),
    )


def normalizar_tramitacao_camara(raw: dict) -> TramitacaoNormalized:
    return TramitacaoNormalized(
        data=raw.get("dataHora"),
        descricao=raw.get("descricaoSituacao") or raw.get("despacho") or "",
        orgao=raw.get("siglaOrgao"),
        situacao=raw.get("descricaoSituacao"),
        url=raw.get("url"),
        fonte_id=str(raw.get("sequencia", "")),
    )


def normalizar_senado(raw: dict) -> ProposicaoNormalized | None:
    identificacao = raw.get("IdentificacaoMateria") or {}
    tipo = identificacao.get("SiglaSubtipoMateria") or identificacao.get("DescricaoSubtipoMateria", "")
    numero_raw = identificacao.get("NumeroMateria")
    ano_raw = identificacao.get("AnoMateria")
    ementa = (raw.get("EmentaMateria") or "").strip()

    if not ementa or not numero_raw or not ano_raw:
        return None

    situacao_atual = raw.get("SituacaoAtual") or {}

    return ProposicaoNormalized(
        fonte="senado",
        fonte_id=str(identificacao.get("CodigoMateria", "")),
        tipo=tipo or "PL",
        numero=int(numero_raw),
        ano=int(ano_raw),
        ementa=ementa,
        url_tramitacao=raw.get("UrlPaginaMateria"),
        data_apresentacao=None,
        situacao=situacao_atual.get("DescricaoSituacao"),
        regime=None,
        orgao_atual=situacao_atual.get("NomeLocal"),
    )
