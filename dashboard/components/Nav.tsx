"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAgent } from "./AgentContext";

const links = [
  { href: "/", label: "Portfolio" },
  { href: "/wheel", label: "Wheel" },
  { href: "/alerts", label: "Alerts" },
  { href: "/intel", label: "Intel" },
  { href: "/trades", label: "Trades" },
  { href: "/analytics", label: "Analytics" },
  { href: "/thesis", label: "Thesis" },
  { href: "/settings", label: "Settings" },
  { href: "/showcase", label: "Showcase" },
];

export default function Nav() {
  const path = usePathname();
  const { open, toggle } = useAgent();
  return (
    <nav className="sticky top-0 z-40 border-b border-line bg-base/70 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex items-center gap-1 h-13 px-4 overflow-x-auto">
        {/* Brand mark */}
        <Link href="/" className="flex items-center gap-2 mr-7 group">
          <span className="inline-block w-2 h-2 rounded-[2px] bg-gold rotate-45 group-hover:rotate-0 transition-transform duration-300" />
          <span className="wordmark text-[13px] text-ink">TRADEMIND</span>
        </Link>

        {links.map((l) => {
          const active = path === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`relative shrink-0 px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {l.label}
              {active && (
                <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] bg-gold rounded-full" />
              )}
            </Link>
          );
        })}

        <button
          onClick={toggle}
          className={`ml-auto shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-all ${
            open
              ? "bg-gold text-base shadow-[0_0_18px_-4px_rgba(224,168,46,0.6)]"
              : "border border-gold/30 text-gold hover:bg-gold/10"
          }`}
        >
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${open ? "bg-base" : "bg-gold pulse"}`} />
          Agent
        </button>
      </div>
    </nav>
  );
}
