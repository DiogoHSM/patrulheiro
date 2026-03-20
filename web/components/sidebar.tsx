"use client"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { logout } from "@/app/actions/auth"
import { ThemeToggle } from "./theme-toggle"

const nav = [
  { href: "/dashboard", label: "Análise de Proposições", icon: "⊞" },
  { divider: "Legislativo" },
  { href: "/proposicoes", label: "Proposições", icon: "📋" },
  { href: "/votacoes", label: "Votações", icon: "🗳️" },
  { divider: "Parlamentares" },
  { href: "/senadores", label: "Senadores", icon: "🏛️" },
  { href: "/deputados", label: "Deputados", icon: "👥" },
  { divider: "Configuração" },
  { href: "/posicoes", label: "Posições do Partido", icon: "🎯" },
]

function SidebarContent({ onClose, unreadCount }: { onClose?: () => void; unreadCount?: number }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}>
      {/* Logo */}
      <div className="p-5 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <Image src="/pl-logo.svg" alt="PL" width={36} height={40} />
          <div>
            <p className="font-bold text-sm leading-tight" style={{ color: "var(--text)" }}>Inteligência Legislativa</p>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>Monitor On-line</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-xl cursor-pointer" style={{ color: "var(--text-muted)" }}>✕</button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {nav.map((item) => {
          if ("divider" in item) {
            return (
              <p key={item.divider} className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-dim)" }}>
                {item.divider}
              </p>
            )
          }
          const { href, label, icon } = item
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: active ? "var(--primary)" : "transparent",
                color: active ? "#fff" : "var(--text-muted)",
              }}
            >
              <span className="text-base">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Inbox */}
      <div className="px-3 pb-2">
        <Link
          href="/inbox"
          onClick={onClose}
          className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{
            background: pathname.startsWith("/inbox") ? "var(--primary)" : "transparent",
            color: pathname.startsWith("/inbox") ? "#fff" : "var(--text-muted)",
          }}
        >
          <div className="flex items-center gap-3">
            <span className="text-base">🔔</span>
            Notificações
          </div>
          {(unreadCount ?? 0) > 0 && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
              style={{ background: "var(--red)", color: "#fff" }}>
              {unreadCount}
            </span>
          )}
        </Link>
      </div>

      {/* Footer */}
      <div className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
        <ThemeToggle />
        <form action={logout}>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer" style={{ color: "var(--text-dim)" }}>
            <span>↩</span> Sair
          </button>
        </form>
        <div className="mt-3 h-0.5 rounded-full" style={{ background: "linear-gradient(90deg, #009640, #ffd500, #004f9f)" }} />
      </div>
    </div>
  )
}

export function Sidebar({ unreadCount }: { unreadCount?: number }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col shrink-0">
        <SidebarContent unreadCount={unreadCount} />
      </aside>

      {/* Mobile: hamburger button */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg shadow-lg cursor-pointer"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
        onClick={() => setOpen(true)}
      >
        ☰
      </button>

      {/* Mobile: overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative z-50 w-72 flex flex-col shadow-2xl">
            <SidebarContent onClose={() => setOpen(false)} unreadCount={unreadCount} />
          </aside>
        </div>
      )}
    </>
  )
}
