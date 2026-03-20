import type { Metadata } from "next"
import { cookies } from "next/headers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Inteligência Legislativa — Monitor On-line",
  description: "Monitoramento e análise legislativa do Partido Liberal",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const theme = jar.get("pl_theme")?.value  // undefined → sem data-theme → media query decide

  return (
    <html lang="pt-BR" className="h-full" {...(theme ? { "data-theme": theme } : {})}>
      <body className="h-full antialiased">{children}</body>
    </html>
  )
}
