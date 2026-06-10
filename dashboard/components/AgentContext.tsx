"use client";
import { createContext, useContext, useState, ReactNode } from "react";

interface AgentCtx {
  open: boolean;
  toggle: () => void;
  ticker: string;
  setTicker: (t: string) => void;
}

const Ctx = createContext<AgentCtx | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  return (
    <Ctx.Provider value={{ open, toggle: () => setOpen((v) => !v), ticker, setTicker }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAgent(): AgentCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAgent must be used within AgentProvider");
  return ctx;
}
