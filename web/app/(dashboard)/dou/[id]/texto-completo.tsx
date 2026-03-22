"use client"
import { useState } from "react"

export function TextoCompleto({ texto }: { texto: string }) {
  const [expanded, setExpanded] = useState(false)
  const hasMore = texto.length > 1500

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div className="px-5 py-4" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Texto do ato</h2>
      </div>
      <div className="px-5 py-4" style={{ background: "var(--surface-deep)" }}>
        <div
          className="text-sm leading-relaxed dou-texto"
          style={{
            color: "var(--text-muted)",
            maxHeight: expanded ? "none" : "300px",
            overflow: expanded ? "visible" : "hidden",
          }}
          dangerouslySetInnerHTML={{ __html: texto }}
        />
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
