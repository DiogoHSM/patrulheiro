"use client"
import { useTransition } from "react"
import { toggleMonitoramento } from "@/app/actions/monitoramentos"

export function MonitorarButton({ proposicaoId, monitorando }: { proposicaoId: string; monitorando: boolean }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(() => toggleMonitoramento(proposicaoId))
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer disabled:opacity-50"
      style={monitorando
        ? { background: "var(--primary)", color: "#fff", border: "1px solid var(--primary)" }
        : { background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }
      }
    >
      {pending ? "…" : monitorando ? "🔔 Monitorando" : "🔕 Monitorar"}
    </button>
  )
}
