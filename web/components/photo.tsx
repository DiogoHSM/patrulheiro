"use client"
import { useState } from "react"

export function Photo({ src, nome, size = 32 }: { src: string; nome: string; size?: number }) {
  const [error, setError] = useState(false)
  const initials = nome.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase()

  if (error) {
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: "var(--primary)", display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, color: "#fff",
      }}>
        {initials}
      </div>
    )
  }

  return (
    <img src={src} alt={nome} width={size} height={size} onError={() => setError(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover",
        objectPosition: "top", flexShrink: 0, background: "var(--border)" }} />
  )
}

export function PartidoLogo({ sigla, size = 28 }: { sigla: string; size?: number }) {
  const [error, setError] = useState(false)
  if (error || !sigla) return null

  return (
    <img
      src={`https://www.camara.leg.br/internet/Deputado/img/partidos/${sigla}.gif`}
      alt={sigla} width={size} height={size} onError={() => setError(true)}
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
  )
}
