"use client"
import { useEffect, useState } from "react"

type ThemeMode = "light" | "dark" | "system"

const LABELS: Record<ThemeMode, { icon: string; label: string }> = {
  light:  { icon: "☀️", label: "Modo claro" },
  dark:   { icon: "🌙", label: "Modo escuro" },
  system: { icon: "💻", label: "Tema do sistema" },
}

function applyTheme(mode: ThemeMode) {
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme")
  } else {
    document.documentElement.setAttribute("data-theme", mode)
  }
}

function savePref(mode: ThemeMode) {
  if (mode === "system") {
    document.cookie = "pl_theme=;path=/;max-age=0;samesite=lax"
  } else {
    document.cookie = `pl_theme=${mode};path=/;max-age=31536000;samesite=lax`
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system")

  useEffect(() => {
    const saved = document.cookie.match(/pl_theme=([^;]+)/)?.[1]
    const initial: ThemeMode = (saved === "light" || saved === "dark") ? saved : "system"
    setMode(initial)
    applyTheme(initial)
  }, [])

  function cycle() {
    const order: ThemeMode[] = ["system", "light", "dark"]
    const next = order[(order.indexOf(mode) + 1) % order.length]
    setMode(next)
    applyTheme(next)
    savePref(next)
  }

  const { icon, label } = LABELS[mode]

  return (
    <button
      onClick={cycle}
      title={label}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer"
      style={{ color: "var(--text-muted)" }}
    >
      <span>{icon}</span>
      {label}
    </button>
  )
}
