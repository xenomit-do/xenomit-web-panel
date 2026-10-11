"use client";

import { useEffect, useRef } from "react";
import type { InstanceLive } from "@/hooks/useViewSocket";

const LEVEL_COLOR: Record<string, string> = {
  debug: "#55607a",
  info: "#9aa7bd",
  warn: "#ffd54f",
  error: "#e5534b",
};

export function LogTab({ live }: { live: InstanceLive }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant" });
  }, [live.logs.length]);

  return (
    <div className="h-full overflow-y-auto p-4 font-mono text-xs">
      {live.logs.length === 0 && (
        <div className="muted">No log lines yet — the agent streams them while connected.</div>
      )}
      {live.logs.map((l, i) => (
        <div key={i} className="flex gap-3 whitespace-pre-wrap">
          <span className="muted shrink-0">
            {new Date(l.at).toLocaleTimeString()}
          </span>
          <span
            className="uppercase w-12 shrink-0"
            style={{ color: LEVEL_COLOR[l.level] ?? "#9aa7bd" }}
          >
            {l.level}
          </span>
          <span>{l.line}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
