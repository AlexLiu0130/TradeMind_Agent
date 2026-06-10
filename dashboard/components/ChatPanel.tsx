"use client";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useAgent } from "./AgentContext";

// Markdown rendered for the narrow dark chat panel — the agent replies in rich
// markdown (## headings, **bold**, lists, ---) which must be formatted, not shown raw.
const MD: Components = {
  h1: ({ children }) => <h1 className="text-sm font-semibold text-ink mt-3 mb-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[13px] font-semibold text-ink mt-3 mb-1 first:mt-0 pl-2 border-l-2 border-gold/60">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xs font-semibold text-gold mt-2 mb-0.5">{children}</h3>,
  p: ({ children }) => <p className="text-xs text-ink leading-relaxed my-1.5">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5 marker:text-faint">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5 marker:text-faint">{children}</ol>,
  li: ({ children }) => <li className="text-xs text-ink leading-snug">{children}</li>,
  hr: () => <hr className="border-line my-2.5" />,
  code: ({ children }) => <code className="num bg-base text-gold px-1 py-px rounded text-[11px]">{children}</code>,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-gold underline">{children}</a>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-line pl-2 text-muted my-1.5">{children}</blockquote>,
};

interface Check {
  name: string;
  conclusion: string;
  blocking: boolean;
}
interface Recommendation {
  action: string;
  rationale: string;
}
interface AgentReply {
  summary?: string;
  checks?: Check[];
  recommendations?: Recommendation[];
  requires_confirmation?: boolean;
  error?: string;
}
interface Msg {
  role: "user" | "agent";
  text?: string;
  reply?: AgentReply;
}

const QUICK = [
  { label: "盘前简报", q: "给我今天的盘前简报" },
  { label: "组合风险", q: "评估我当前组合的风险和集中度" },
  { label: "分析持仓", q: "分析我当前的持仓，哪些需要关注" },
];

export default function ChatPanel() {
  const { open, toggle, ticker, setTicker } = useAgent();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, loading]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, ticker: ticker || undefined }),
      });
      const reply: AgentReply = await res.json();
      setMsgs((m) => [...m, { role: "agent", reply }]);
    } catch {
      setMsgs((m) => [...m, { role: "agent", reply: { error: "网络错误，无法连接 Agent" } }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-full sm:w-[420px] bg-[#111419] border-l border-[#232a33] shadow-xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-[#232a33] bg-[#161a21]">
        <span className="text-sm font-semibold text-[#e6e9ef]">🧠 TradeMind Agent</span>
        <button onClick={toggle} className="text-[#8b93a3] hover:text-[#e6e9ef] text-lg leading-none px-1">×</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {msgs.length === 0 && (
          <div className="text-xs text-[#8b93a3] space-y-3">
            <p>问任何关于行情、持仓、策略或风控的问题。Agent 会调用实时数据并跑预交易检查。</p>
            <p className="text-[#5b6472]">⚠️ Agent 只做分析，永不自动下单。</p>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bg-[#e0a82e] text-white text-xs rounded-lg rounded-br-sm px-3 py-2 max-w-[85%]">
                {m.text}
              </div>
            </div>
          ) : (
            <AgentBubble key={i} reply={m.reply!} />
          ),
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-[#8b93a3]">
            <span className="inline-block w-2 h-2 rounded-full bg-[#e0a82e] animate-pulse" />
            正在分析（多轮调用 IBKR 数据 + 模型推理，复杂问题可能需要 1–3 分钟）...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#232a33] p-3 space-y-2 bg-[#111419]">
        <div className="flex gap-2">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="Ticker"
            className="w-20 border border-[#232a33] rounded px-2 py-1.5 text-xs text-[#e6e9ef] placeholder-[#5b6472] tabular-nums"
          />
          <div className="flex gap-1 flex-1 overflow-x-auto">
            {QUICK.map((b) => (
              <button
                key={b.label}
                onClick={() => send(b.q)}
                disabled={loading}
                className="whitespace-nowrap text-[10px] text-[#e0a82e] border border-[#232a33] rounded px-2 py-1 hover:bg-[#1b2027] disabled:opacity-40"
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="问点什么... (Enter 发送, Shift+Enter 换行)"
            rows={2}
            className="flex-1 resize-none border border-[#232a33] rounded px-3 py-2 text-xs text-[#e6e9ef] placeholder-[#5b6472] focus:outline-none focus:border-[#e0a82e]"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="bg-[#e0a82e] text-white text-xs font-medium px-4 rounded hover:bg-[#c9952a] disabled:opacity-40 self-stretch"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentBubble({ reply }: { reply: AgentReply }) {
  if (reply.error) {
    return (
      <div className="bg-[#241316] border border-[#5c2a2a] text-[#ff5d6c] text-xs rounded-lg px-3 py-2">
        {reply.error}
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-[92%]">
      {reply.summary && (
        <div className="bg-[#161a21] border border-[#232a33] rounded-lg rounded-bl-sm px-3 py-2">
          <ReactMarkdown components={MD}>{reply.summary}</ReactMarkdown>
        </div>
      )}

      {reply.requires_confirmation && (
        <div className="bg-[#241f12] border border-[#e0a82e]/40 text-[#e0a82e] text-[11px] rounded px-3 py-1.5 font-medium">
          ⚠️ 此操作需你显式确认 — Agent 不会自动下单
        </div>
      )}

      {reply.checks && reply.checks.length > 0 && (
        <div className="border border-[#232a33] rounded-lg overflow-hidden">
          <div className="bg-[#161a21] px-3 py-1.5 text-[10px] font-semibold text-[#8b93a3] border-b border-[#232a33]">
            预交易检查 (Pre-trade Checks)
          </div>
          <div className="divide-y divide-[#232a33]/60">
            {reply.checks.map((c, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-1.5">
                <span className="text-xs mt-0.5">{c.blocking ? "🔴" : "🟢"}</span>
                <span className="text-[11px] text-[#e6e9ef] leading-snug">{c.conclusion}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reply.recommendations && reply.recommendations.length > 0 && (
        <div className="space-y-1.5">
          {reply.recommendations.map((r, i) => (
            <div key={i} className="bg-[#16202b] border border-[#54aeff]/40 rounded-lg px-3 py-2">
              <div className="text-[11px] font-semibold text-[#6ea8d8]">→ {r.action}</div>
              {r.rationale && <div className="text-[10px] text-[#8b93a3] mt-0.5">{r.rationale}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
