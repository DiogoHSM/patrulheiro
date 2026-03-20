"use client"
import { useActionState } from "react"
import { login } from "@/app/actions/auth"
import Image from "next/image"

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null)

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #020c1b 0%, #071527 50%, #020c1b 100%)" }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <Image src="/pl-logo.svg" alt="Partido Liberal" width={80} height={87} className="mb-4" />
          <h1 className="text-white text-2xl font-bold tracking-tight">Inteligência Legislativa</h1>
          <p className="text-slate-400 text-sm mt-1">Monitor On-line</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8" style={{ background: "#0a1f3c", border: "1px solid #112654" }}>
          <h2 className="text-white text-lg font-semibold mb-6">Entrar</h2>

          <form action={action} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-2">Senha de acesso</label>
              <input
                name="password"
                type="password"
                required
                autoFocus
                className="w-full px-4 py-3 rounded-lg text-white placeholder-slate-500 outline-none transition-all"
                style={{ background: "#071527", border: "1px solid #112654" }}
                placeholder="••••••••"
              />
            </div>

            {state?.error && (
              <p className="text-red-400 text-sm">{state.error}</p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full py-3 rounded-lg font-semibold text-white transition-opacity disabled:opacity-60 cursor-pointer"
              style={{ background: "#004f9f" }}
            >
              {pending ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>

        {/* Stripe bottom */}
        <div className="mt-6 h-1 rounded-full" style={{ background: "linear-gradient(90deg, #009640, #ffd500, #004f9f)" }} />
      </div>
    </div>
  )
}
