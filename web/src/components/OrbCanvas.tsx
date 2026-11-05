import { useEffect, useRef } from "react";
import type { VoicePhase } from "../lib/useVoiceConversation";

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [10, 132, 255];
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * הכדור החי: עיגול שקצוותיו נושמים, ובתוכו ענני צבע שנעים, מטושטשים, כמו ב-ChatGPT.
 * level (0-1) מעוות את הקצוות ומגדיל את הזוהר; phase קובע את המהירות.
 */
export default function OrbCanvas({ level, phase, color, size = 300 }: { level: number; phase: VoicePhase; color: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ level: 0, phase, color });
  live.current.phase = phase;
  live.current.color = color;
  live.current.level = level;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    ctx.scale(dpr, dpr);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    let smooth = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { phase: ph, color: col, level: lv } = live.current;
      const speed = ph === "thinking" || ph === "transcribing" ? 2.6 : ph === "speaking" ? 1.4 : ph === "idle" ? 0.25 : 0.8;
      t += reduce ? 0 : dt * speed;
      smooth += (lv - smooth) * 0.18;
      const base = hexToRgb(col);
      const deep = mix(base, [10, 20, 70], 0.45);
      const bright = mix(base, [100, 210, 255], 0.55);
      const white = [255, 255, 255];
      const violet = mix(base, [175, 82, 222], 0.6);
      const muted = ph === "idle";

      const cx = size / 2;
      const cy = size / 2;
      const R = size * 0.3 * (1 + smooth * 0.08);
      ctx.clearRect(0, 0, size, size);

      // זוהר חיצוני
      const glow = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, size * 0.49);
      glow.addColorStop(0, rgba(bright, muted ? 0.12 : 0.35 + smooth * 0.35));
      glow.addColorStop(1, rgba(bright, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      // צורת הכדור: קצוות שנושמים ומתעוותים עם הקול
      ctx.save();
      ctx.beginPath();
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wob = 0.012 * Math.sin(3 * a + t * 1.3) + 0.007 * Math.sin(5 * a - t * 1.7) + smooth * (0.022 * Math.sin(4 * a + t * 4) + 0.012 * Math.sin(7 * a - t * 5));
        const r = R * (1 + (reduce ? 0 : wob));
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.clip();

      const fill = ctx.createRadialGradient(cx, cy + R * 0.3, R * 0.1, cx, cy, R * 1.1);
      fill.addColorStop(0, rgba(muted ? mix(base, [140, 140, 150], 0.6) : base, 1));
      fill.addColorStop(1, rgba(muted ? [70, 70, 80] : deep, 1));
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, size, size);

      // ענני צבע שנעים בתוך הכדור
      ctx.filter = `blur(${size * 0.07}px)`;
      const blobs: Array<[number[], number, number, number, number]> = [
        [bright, 0.55, 0.0, 0.8, 0.85],
        [white, 0.4, 2.1, 1.1, 0.55],
        [violet, 0.5, 4.2, 0.6, 0.7],
        [mix(base, [48, 209, 88], 0.35), 0.35, 1.0, 1.4, 0.5],
      ];
      for (const [c, rad, phase0, sp, alpha] of blobs) {
        const ang = t * sp + phase0;
        const bx = cx + Math.cos(ang) * R * 0.45;
        const by = cy + Math.sin(ang * 1.3) * R * 0.45;
        const br = R * rad * (1 + smooth * 0.3);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, rgba(c, muted ? alpha * 0.25 : alpha));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.filter = "none";

      // הברקה עליונה ותחתית כהה, לנפח
      const hl = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.6);
      hl.addColorStop(0, "rgba(255,255,255,0.55)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.fillRect(0, 0, size, size);
      const sh = ctx.createLinearGradient(0, cy, 0, cy + R);
      sh.addColorStop(0, "rgba(0,0,0,0)");
      sh.addColorStop(1, "rgba(0,0,30,0.25)");
      ctx.fillStyle = sh;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}
