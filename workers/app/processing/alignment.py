import json
from openai import AsyncOpenAI
from app.config import settings
from app.db import update_alinhamento, get_posicoes_partido

_client = AsyncOpenAI(api_key=settings.openai_api_key)

SYSTEM = """Você é um analista político especializado em análise legislativa.
Avalie se a proposição é FAVORÁVEL, CONTRÁRIA ou NEUTRA em relação às posições do partido abaixo.

{posicoes}

Responda APENAS com JSON válido:
{{
  "alinhamento": "favoravel|contrario|neutro|ambiguo",
  "confianca": 0.0,
  "justificativa": "string",
  "posicoes_relacionadas": ["string"],
  "risco_politico": "alto|medio|baixo",
  "recomendacao": "string"
}}"""

USER = "Tipo: {tipo}\nEmenta: {ementa}\nTemas: {temas}\nResumo: {resumo}"


async def analisar_alinhamento(
    proposicao_id: str,
    tipo: str,
    ementa: str,
    temas: list[str] = None,
    resumo: str = None,
) -> dict:
    posicoes = await get_posicoes_partido()
    if not posicoes:
        return {}

    resp = await _client.chat.completions.create(
        model="gpt-4.1-nano",
        messages=[
            {"role": "system", "content": SYSTEM.format(posicoes=posicoes)},
            {"role": "user", "content": USER.format(
                tipo=tipo, ementa=ementa,
                temas=", ".join(temas or []),
                resumo=resumo or ementa,
            )},
        ],
        response_format={"type": "json_object"},
        max_tokens=512,
    )
    result = json.loads(resp.choices[0].message.content)
    await update_alinhamento(proposicao_id, result)
    return result
