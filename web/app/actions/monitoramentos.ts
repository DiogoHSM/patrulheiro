"use server"
import { query, queryOne } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function toggleMonitoramento(proposicaoId: string) {
  const existing = await queryOne(
    "SELECT id FROM monitoramentos WHERE proposicao_id = $1", [proposicaoId]
  )
  if (existing) {
    await query("DELETE FROM monitoramentos WHERE proposicao_id = $1", [proposicaoId])
  } else {
    await query("INSERT INTO monitoramentos (proposicao_id) VALUES ($1)", [proposicaoId])
  }
  revalidatePath(`/proposicoes/${proposicaoId}`)
}

export async function markAllRead() {
  await query("UPDATE notificacoes SET lida = TRUE WHERE lida = FALSE")
  revalidatePath("/inbox")
}

export async function markRead(notificacaoId: string) {
  await query("UPDATE notificacoes SET lida = TRUE WHERE id = $1", [notificacaoId])
  revalidatePath("/inbox")
}

export async function markAlertasRead() {
  await query("UPDATE alertas SET lida = TRUE WHERE lida = FALSE")
  revalidatePath("/inbox")
}
