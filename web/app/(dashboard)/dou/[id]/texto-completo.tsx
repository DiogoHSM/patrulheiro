"use client"
import { useState } from "react"

export function TextoCompleto({ texto }: { texto: string }) {
  const [expanded, setExpanded] = useState(false)
  const preview = texto.slice(0, 600)
  const hasMore = texto.length > 600

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Texto do ato</h2>
      </div>
      <div className="px-5 py-4" style={{ background: "var(--surface-deep)" }}>
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>
          {expanded ? texto : preview}
          {!expanded && hasMore && "…"}
        </p>
        {hasMore && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-3 text-xs cursor-pointer hover:opacity-80"
            style={{ color: "var(--primary)" }}
          >
            {expanded ? "Mostrar menos ↑" : "Ver texto completo ↓"}
          </button>
        )}
      </div>
    </div>
  )
}
