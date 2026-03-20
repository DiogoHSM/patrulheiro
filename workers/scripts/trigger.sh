#!/bin/bash
# Dispara endpoints do workers manualmente (substitui cron em dev)
# Uso: ./scripts/trigger.sh [camara|senado|process]

BASE_URL="${WORKERS_URL:-http://localhost:8000}"
SECRET="${WORKER_SECRET:-dev-secret}"

job="${1:-camara}"

case "$job" in
  camara)
    echo "▶ Ingerindo Câmara..."
    curl -s -X POST "$BASE_URL/ingest/camara" -H "X-Worker-Secret: $SECRET" | jq .
    ;;
  senado)
    echo "▶ Ingerindo Senado..."
    curl -s -X POST "$BASE_URL/ingest/senado" -H "X-Worker-Secret: $SECRET" | jq .
    ;;
  process)
    echo "▶ Processando pendentes..."
    curl -s -X POST "$BASE_URL/process/pending" -H "X-Worker-Secret: $SECRET" | jq .
    ;;
  all)
    echo "▶ Rodando tudo..."
    curl -s -X POST "$BASE_URL/ingest/camara" -H "X-Worker-Secret: $SECRET" | jq .
    sleep 2
    curl -s -X POST "$BASE_URL/ingest/senado" -H "X-Worker-Secret: $SECRET" | jq .
    ;;
  *)
    echo "Uso: $0 [camara|senado|process|all]"
    exit 1
    ;;
esac
