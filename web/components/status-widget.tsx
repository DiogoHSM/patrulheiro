"use client"
import { useState, useRef } from "react"

export type TaskStatus = {
  label: string
  pct: number
  status: "done" | "loading" | "failed" | "pending"
  sub?: string
}

export function StatusWidget({ tasks }: { tasks: TaskStatus[] }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleMouseEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }

  function handleMouseLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  function handleClick() {
    setOpen(o => !o)
  }

  const anyFailed = tasks.some(t => t.status === "failed")
  const anyLoading = tasks.some(t => t.status === "loading")
  const allDone = tasks.every(t => t.status === "done" || t.status === "pending")

  const dotColor = anyFailed
    ? "var(--red)"
    : anyLoading
      ? "var(--yellow)"
      : "var(--green)"

  return (
    <div
      className="fixed top-3 right-4 z-50"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={handleClick}
        title="Status das cargas"
        className="w-8 h-8 rounded-full flex items-center justify-center shadow-md cursor-pointer"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <span
          className={anyLoading ? "animate-pulse" : ""}
          style={{ display: "block", width: 10, height: 10, borderRadius: "50%", background: dotColor }}
        />
      </button>

      {open && (
        <div
          className="absolute top-10 right-0 rounded-xl shadow-xl overflow-hidden"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", minWidth: 240 }}
        >
          <div className="px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
              Status das cargas
            </p>
          </div>
          <div className="p-2 space-y-0.5">
            {tasks.map(task => (
              <div key={task.label} className="flex items-center gap-3 px-2 py-2 rounded-lg text-xs">
                <StatusDot status={task.status} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium" style={{ color: "var(--text-muted)" }}>{task.label}</p>
                  {task.sub && <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{task.sub}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {task.status !== "pending" && (
                    <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${task.pct}%`,
                          background: task.status === "failed"
                            ? "var(--red)"
                            : task.status === "done"
                              ? "var(--green)"
                              : "var(--yellow)",
                        }}
                      />
                    </div>
                  )}
                  <span className="w-10 text-right font-semibold" style={{
                    color: task.status === "failed"
                      ? "var(--red)"
                      : task.status === "done"
                        ? "var(--green)"
                        : task.status === "pending"
                          ? "var(--text-dim)"
                          : "var(--yellow)",
                  }}>
                    {task.status === "done"
                      ? "100%"
                      : task.status === "pending"
                        ? "—"
                        : task.status === "failed"
                          ? "Falhou"
                          : `${task.pct}%`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: TaskStatus["status"] }) {
  const color = status === "done"
    ? "var(--green)"
    : status === "failed"
      ? "var(--red)"
      : status === "loading"
        ? "var(--yellow)"
        : "var(--text-dim)"

  return (
    <span
      className={status === "loading" ? "animate-pulse" : ""}
      style={{ display: "block", width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }}
    />
  )
}
