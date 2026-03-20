"use server"
import { redirect } from "next/navigation"
import { createSession, deleteSession } from "@/lib/session"

export async function login(_: unknown, formData: FormData) {
  const password = formData.get("password") as string
  if (password !== process.env.ADMIN_PASSWORD) {
    return { error: "Senha incorreta" }
  }
  await createSession()
  redirect("/")
}

export async function logout() {
  await deleteSession()
  redirect("/login")
}
