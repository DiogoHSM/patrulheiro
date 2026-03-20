import json
from openai import AsyncOpenAI
from app.config import settings
from app.db import update_classificacao

_client = AsyncOpenAI(api_key=settings.openai_api_key)

PROMPT = """Você é um analista legislativo especializado.
Classifique a proposição abaixo extraindo informações estruturadas.

Tipo: {tipo}
Ementa: {ementa}

Responda APENAS com JSON válido:
{{
  "temas_primarios": ["string"],
  "temas_secundarios": ["string"],
  "entidades_citadas": ["string"],
  "resumo_executivo": "string",
  "impacto_estimado": "alto|medio|baixo",
  "urgencia": "alta|media|baixa"
}}"""


async def classificar_proposicao(proposicao_id: str, tipo: str, ementa: str) -> dict:
    resp = await _client.chat.completions.create(
        model="gpt-4.1-nano",
        messages=[{"role": "user", "content": PROMPT.format(tipo=tipo, ementa=ementa)}],
        response_format={"type": "json_object"},
        max_tokens=512,
    )
    result = json.loads(resp.choices[0].message.content)
    await update_classificacao(proposicao_id, {
        "temas_primarios": result.get("temas_primarios", []),
        "temas_secundarios": result.get("temas_secundarios", []),
        "entidades_citadas": result.get("entidades_citadas", []),
        "resumo_executivo": result.get("resumo_executivo"),
        "impacto_estimado": result.get("impacto_estimado"),
        "urgencia_ia": result.get("urgencia"),
    })
    return result
