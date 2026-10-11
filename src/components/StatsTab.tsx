"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { StatEvent } from "@shared/protocol";
import type { InstanceLive } from "@/hooks/useViewSocket";
import { fmtNum, fmtRate } from "@/lib/format";

const RANGES = ["1h", "24h", "7d", "30d"] as const;
const METRICS = [
  { key: "credits", idx: 0, color: "#ffd54f" },
  { key: "uridium", idx: 1, color: "#b388ff" },
  { key: "honor", idx: 2, color: "#4fc3f7" },
  { key: "experience", idx: 3, color: "#5fd97f" },
] as const;

interface Point {
  at: number;
  rewards: number[];
  balances: number[];
}

interface FeedEvent {
  id: string;
  at: string;
  source: string;
  message: string | null;
  rewards: number[];
  balances: number[];
}

export function StatsTab({
  instanceId,
  live,
}: {
  instanceId: string;
  live: InstanceLive;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1h");
  const [points, setPoints] = useState<Point[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/instances/${instanceId}/stats?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPoints(d.points))
      .catch(() => {});
  }, [instanceId, range, live.events.length]);

  const loadFeed = useCallback(
    (cur?: string) => {
      const q = cur ? `?cursor=${cur}&limit=50` : "?limit=50";
      fetch(`/api/instances/${instanceId}/events${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setFeed((f) => (cur ? [...f, ...d.events] : d.events));
          setCursor(d.next_cursor);
        })
        .catch(() => {});
    },
    [instanceId]
  );

  useEffect(() => loadFeed(), [loadFeed, live.events.length]);

  const balances = live.status?.balances;
  const rates = live.status?.rates;

  // Merge live ws events (not yet in REST feed) at the top.
  const liveFeed: FeedEvent[] = live.events.map((e: StatEvent, i) => ({
    id: `live-${i}`,
    at: new Date(e.at).toISOString(),
    source: e.source,
    message: e.message ?? null,
    rewards: e.rewards,
    balances: e.balances,
  }));

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              className={`btn text-xs ${range === r ? "btn-primary" : ""}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="muted text-sm flex flex-wrap gap-x-4">
          <span>cre <b className="text-[#ffd54f]">{fmtNum(balances?.[0])}</b> (+{fmtRate(rates?.cre_h)}/h)</span>
          <span>uri <b className="text-[#b388ff]">{fmtNum(balances?.[1])}</b> (+{fmtRate(rates?.uri_h)}/h)</span>
          <span>hon <b className="text-[#4fc3f7]">{fmtNum(balances?.[2])}</b> (+{fmtRate(rates?.hon_h)}/h)</span>
          <span>exp <b className="text-[#5fd97f]">{fmtNum(balances?.[3])}</b> (+{fmtRate(rates?.exp_h)}/h)</span>
          <span>deaths <b>{live.status?.deaths ?? 0}</b></span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {METRICS.map((m) => (
          <div key={m.key} className="panel p-3">
            <div className="text-sm font-semibold mb-1 capitalize" style={{ color: m.color }}>
              {m.key}
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points}>
                  <XAxis
                    dataKey="at"
                    tickFormatter={(t) =>
                      new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    }
                    stroke="#55607a"
                    fontSize={10}
                  />
                  <YAxis
                    stroke="#55607a"
                    fontSize={10}
                    tickFormatter={(v) => fmtRate(v)}
                    width={45}
                  />
                  <Tooltip
                    contentStyle={{ background: "#101624", border: "1px solid #232d47", fontSize: 12 }}
                    labelFormatter={(t) => new Date(t).toLocaleString()}
                    formatter={(v) => [fmtNum(Number(v)), m.key]}
                  />
                  <Area
                    type="monotone"
                    dataKey={(p: Point) => p.balances[m.idx]}
                    stroke={m.color}
                    fill={m.color}
                    fillOpacity={0.15}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      <div className="panel p-3 flex-1 min-h-[160px]">
        <div className="text-sm font-semibold mb-2">Reward feed</div>
        <div className="overflow-y-auto max-h-72 flex flex-col gap-1 text-sm">
          {[...liveFeed, ...feed].map((e) => (
            <div key={e.id} className="flex gap-3 items-baseline">
              <span className="muted text-xs whitespace-nowrap">
                {new Date(e.at).toLocaleTimeString()}
              </span>
              <span className="flex-1">{e.message ?? e.source}</span>
              <span className="text-xs muted whitespace-nowrap">
                {e.rewards.map((r, i) =>
                  r ? (
                    <b key={i} style={{ color: METRICS[i].color }} className="ml-2">
                      +{fmtNum(r)} {METRICS[i].key.slice(0, 3)}
                    </b>
                  ) : null
                )}
              </span>
            </div>
          ))}
          {cursor && (
            <button className="btn text-xs self-center mt-2" onClick={() => loadFeed(cursor)}>
              Load more
            </button>
          )}
          {!feed.length && !liveFeed.length && (
            <div className="muted">No reward events yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
