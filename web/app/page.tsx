import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"

export default async function RootPage() {
  const ok = await getSession()
  redirect(ok ? "/dashboard" : "/login")
}
