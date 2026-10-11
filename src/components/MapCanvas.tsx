"use client";

import { useEffect, useRef } from "react";
import type {
  Entity,
  FrameMessage,
  Obstacle,
  StatusMessage,
} from "@shared/protocol";
import { viewStore } from "@/hooks/useViewSocket";
import { fmtRate, pct } from "@/lib/format";

// Live map — mirrors the desktop bot's map rendering. World space is
// map.width x map.height; camera follows the hero; drag pans (offset
// persists, double-click recenters), wheel/pinch zooms.

const COLORS: Record<string, string> = {
  hero: "#4fc3f7",
  npc: "#f0932b",
  pet: "#b388ff",
  box: "#ffd54f",
  ore: "#8d9db5",
  portal: "#ffffff",
  station: "#5b8dd9",
  base: "#5b8dd9",
  beacon: "#7be3c3",
  mine: "#e5534b",
  other: "#55607a",
};

function playerColor(e: Entity): string {
  switch (e.clan_diplomacy) {
    case "ally": return "#3fb950";
    case "war": return "#e5534b";
    default: return "#9aa7bd";
  }
}

export function MapCanvas({ instanceId }: { instanceId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ x: 0, y: 0, zoom: 0.05, panX: 0, panY: 0, init: false });
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let disposed = false;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(r.height * devicePixelRatio));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const worldFromScreen = (sx: number, sy: number) => {
      const c = cam.current;
      const r = canvas.getBoundingClientRect();
      const cx = r.width / 2, cy = r.height / 2;
      return {
        x: (sx - cx) / c.zoom + c.x + c.panX,
        y: (sy - cy) / c.zoom + c.y + c.panY,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.current.zoom };
      }
    };
    let lastPan = 0;
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
      if (pointers.current.size === 2 && pinch.current) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        cam.current.zoom = clampZoom(pinch.current.zoom * (d / Math.max(1, pinch.current.d)));
        return;
      }
      // ~30 Hz pan throttle
      const now = performance.now();
      if (now - lastPan < 33) return;
      lastPan = now;
      cam.current.panX -= (e.clientX - prev.x) / cam.current.zoom;
      cam.current.panY -= (e.clientY - prev.y) / cam.current.zoom;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cam.current;
      const r = canvas.getBoundingClientRect();
      const before = worldFromScreen(e.clientX - r.left, e.clientY - r.top);
      c.zoom = clampZoom(c.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      const after = worldFromScreen(e.clientX - r.left, e.clientY - r.top);
      c.panX += before.x - after.x;
      c.panY += before.y - after.y;
    };
    const onDblClick = () => { cam.current.panX = 0; cam.current.panY = 0; };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);

    const draw = () => {
      if (disposed) return;
      const live = viewStore.get(instanceId);
      const frame = live.frame;
      const status = live.status;
      render(ctx, canvas, cam.current, frame ?? null, status ?? null, trail.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
    };
  }, [instanceId]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block touch-none select-none cursor-grab active:cursor-grabbing"
      style={{ background: "#070b14" }}
    />
  );
}

function clampZoom(z: number) {
  return Math.min(2.5, Math.max(0.005, z));
}

const SHIP_RADIUS = 350; // nominal ship size in world units

function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cam: { x: number; y: number; zoom: number; panX: number; panY: number; init: boolean },
  frame: FrameMessage | null,
  status: StatusMessage | null,
  trail: { x: number; y: number; t: number }[]
) {
  const dpr = devicePixelRatio;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const map = frame?.map;
  const hero = frame?.hero;

  if (map && !cam.init) {
    cam.zoom = Math.min(w / map.width, h / map.height) * 0.9;
    cam.init = true;
  }
  if (hero) {
    cam.x = hero.x;
    cam.y = hero.y;
    trail.push({ x: hero.x, y: hero.y, t: Date.now() });
    while (trail.length && trail[0].t < Date.now() - 5000) trail.shift();
  }

  const cx = w / 2, cy = h / 2;
  const toScreen = (x: number, y: number) => ({
    x: (x - cam.x - cam.panX) * cam.zoom + cx,
    y: (y - cam.y - cam.panY) * cam.zoom + cy,
  });

  // grid
  ctx.strokeStyle = "rgba(80,100,140,.08)";
  ctx.lineWidth = 1;
  const gridStep = 2000;
  if (map) {
    for (let gx = 0; gx <= map.width; gx += gridStep) {
      const a = toScreen(gx, 0), b = toScreen(gx, map.height);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let gy = 0; gy <= map.height; gy += gridStep) {
      const a = toScreen(0, gy), b = toScreen(map.width, gy);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // map border
    const tl = toScreen(0, 0), br = toScreen(map.width, map.height);
    ctx.strokeStyle = "rgba(120,150,200,.25)";
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }

  // safe places (soft circles)
  for (const s of frame?.safe_places ?? []) {
    const p = toScreen(s.x, s.y);
    const r = s.radius * cam.zoom;
    ctx.fillStyle = "rgba(80,160,255,.07)";
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(80,160,255,.25)";
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
  }

  // obstacles — inverted ones bound the playable interior (hatch outside)
  for (const o of frame?.obstacles ?? []) drawObstacle(ctx, toScreen, cam.zoom, o, w, h);

  // hero trail (last ~5s)
  if (trail.length > 1) {
    ctx.strokeStyle = "rgba(79,195,247,.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trail.forEach((p, i) => {
      const s = toScreen(p.x, p.y);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  }

  // entities
  const fontPx = 11;
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  for (const e of frame?.entities ?? []) {
    if (e.is_hero || e.kind === "hero") continue;
    const p = toScreen(e.x, e.y);
    if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
    const dead = e.hp !== undefined && e.max_hp !== undefined && e.hp <= 0;
    const color = e.kind === "player" ? playerColor(e) : COLORS[e.kind] ?? COLORS.other;
    const r =
      e.kind === "mine" ? 2.5 :
      e.kind === "box" || e.kind === "ore" ? 3 :
      e.kind === "station" || e.kind === "base" ? 9 : 5;
    ctx.globalAlpha = dead ? 0.35 : 1;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    if (e.kind === "station" || e.kind === "base") {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    const label = e.name ?? e.type_id;
    if (label && (e.kind === "player" || e.kind === "npc" || e.kind === "pet")) {
      ctx.fillStyle = "rgba(220,230,245,.75)";
      ctx.fillText(label, p.x, p.y - r - 4);
    }
    // hp bar under damaged ships
    if (e.max_hp && e.hp !== undefined && e.hp < e.max_hp) {
      const bw = 18;
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(p.x - bw / 2, p.y + r + 3, bw, 3);
      ctx.fillStyle = "#e5534b";
      ctx.fillRect(p.x - bw / 2, p.y + r + 3, (bw * e.hp) / e.max_hp, 3);
    }
    ctx.globalAlpha = 1;
  }

  // portals — white rings labeled with the target map
  for (const po of frame?.portals ?? []) {
    const p = toScreen(po.x, po.y);
    ctx.strokeStyle = po.jumping ? "#ffd54f" : "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.fillText(po.target_name ?? String(po.target_map), p.x, p.y - 11);
  }

  // hero — cyan disc + direction tick toward dest
  if (hero) {
    const p = toScreen(hero.x, hero.y);
    ctx.fillStyle = COLORS.hero;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(79,195,247,.5)";
    ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke();
    if (hero.dest) {
      const d = toScreen(hero.dest.x, hero.dest.y);
      ctx.strokeStyle = "rgba(79,195,247,.4)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(d.x, d.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawHud(ctx, w, h, frame, status, map?.name);
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  toScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
  o: Obstacle,
  w: number,
  h: number
) {
  ctx.strokeStyle = o.inverted ? "rgba(229,83,75,.5)" : "rgba(229,83,75,.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (o.type === "circle") {
    const c = toScreen(o.center.x, o.center.y);
    ctx.arc(c.x, c.y, o.radius * zoom, 0, Math.PI * 2);
  } else if (o.type === "rectangle") {
    const tl = toScreen(o.bounds.x, o.bounds.y);
    ctx.rect(tl.x, tl.y, o.bounds.w * zoom, o.bounds.h * zoom);
  } else {
    o.points.forEach((pt, i) => {
      const s = toScreen(pt.x, pt.y);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }
  ctx.stroke();
  if (o.inverted) {
    // Hatch the boundary to mark the playable interior edge.
    ctx.save();
    ctx.strokeStyle = "rgba(229,83,75,.15)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: FrameMessage | null,
  status: StatusMessage | null,
  mapName?: string
) {
  // Big centered map name
  ctx.textAlign = "center";
  ctx.font = "700 22px ui-sans-serif, system-ui";
  ctx.fillStyle = "rgba(219,228,245,.85)";
  ctx.fillText(mapName && mapName.length ? mapName : "Loading", w / 2, 34);

  // Left column: rates + cargo + deaths
  ctx.textAlign = "left";
  ctx.font = "12px ui-monospace, monospace";
  const r = status?.rates;
  const lines = [
    `cre/h ${fmtRate(r?.cre_h)}`,
    `uri/h ${fmtRate(r?.uri_h)}`,
    `exp/h ${fmtRate(r?.exp_h)}`,
    `hon/h ${fmtRate(r?.hon_h)}`,
    `cargo ${frame?.hero?.cargo ? `${frame.hero.cargo.used}/${frame.hero.cargo.max}` : "—"}`,
    `death ${status?.deaths ?? 0}`,
  ];
  lines.forEach((l, i) => {
    ctx.fillStyle = "rgba(125,138,168,.9)";
    ctx.fillText(l, 12, 24 + i * 16);
  });

  // Bottom-left: config # + hp/shield/nanohull bars
  const hero = frame?.hero;
  if (hero) {
    const bx = 12, bw = 160, bh = 7;
    let by = h - 54;
    ctx.fillStyle = "rgba(219,228,245,.8)";
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(`cfg ${hero.configuration ?? 1}`, bx, by - 6);
    const bars: [number, string][] = [
      [pct(hero.hp, hero.max_hp), "#e5534b"],
      [pct(hero.shield, hero.max_shield), "#4fc3f7"],
      [pct(hero.nanohull, hero.nanohull_max), "#b388ff"],
    ];
    for (const [p, color] of bars) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, (bw * p) / 100, bh);
      by += bh + 4;
    }
  }

  // Bottom-right: locked-target bar when the activity implies a target
  const activity = status?.activity ?? "";
  const m = /attacking\s+(.+)/i.exec(activity);
  if (m) {
    const label = `◎ ${m[1]}`;
    ctx.font = "13px ui-monospace, monospace";
    const tw = ctx.measureText(label).width + 20;
    ctx.fillStyle = "rgba(20,28,46,.85)";
    ctx.fillRect(w - tw - 12, h - 40, tw, 24);
    ctx.strokeStyle = "rgba(229,83,75,.6)";
    ctx.strokeRect(w - tw - 12, h - 40, tw, 24);
    ctx.fillStyle = "#f0932b";
    ctx.textAlign = "center";
    ctx.fillText(label, w - tw / 2 - 12, h - 24);
  }
}
