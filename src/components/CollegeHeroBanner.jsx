// Full-width hero banner for each College home page — themed canvas
// animation + emblem, title, and tagline. Distinct from the compact
// CollegePageTitle used on sub-pages.

import { useEffect, useRef, useState } from "react";
import CollegeIcon from "./CollegeIcon";
import { COLLEGES } from "../data/colleges";
import { BADGE_COLOR } from "../lib/collegeColors";

const ICON_SIZE = 64;

const SIGILS = {
  gaming: ["XP", "▶", "●", "◆"],
  tcg: ["+2", "×3", "♦", "÷4", "∑"],
  entertainment: ["▶", "24", "◼", "★"],
  collectibles: ["✦", "◇", "★", "◆"],
  tabletop: ["⚀", "⚃", "⚅", "d20"],
};

export default function CollegeHeroBanner({ collegeId, label }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const colorRef = useRef("56, 189, 248");

  const college = COLLEGES.find((c) => c.id === collegeId);
  const displayLabel = label || college?.label || collegeId;
  const tagline = college?.tagline || "";
  const sigils = SIGILS[collegeId] || [];

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const match = /var\((--[a-z-]+)\)/.exec(BADGE_COLOR[collegeId] || "");
    const value = match ? getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() : null;
    const rgb = value && hexToRgb(value);
    if (rgb) colorRef.current = `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
  }, [collegeId]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let linkDistance = 90;
    let particles = [];
    let extras = [];
    let rafId = null;
    let running = true;
    let frame = 0;

    function seedParticles(w, h) {
      const count = Math.max(40, Math.min(120, Math.round((w * h) / 3200)));
      linkDistance = Math.max(72, Math.min(180, Math.min(w, h) * 0.28));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * (collegeId === "gaming" ? 0.42 : 0.24),
        vy: (Math.random() - 0.5) * 0.24,
      }));
      extras = seedExtras(collegeId, w, h);
    }

    function resize() {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles(width, height);
    }

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);
    resize();

    function step() {
      if (!running) return;
      frame += 1;
      const rgb = colorRef.current;
      ctx.clearRect(0, 0, width, height);

      drawThemeBackdrop(ctx, collegeId, width, height, frame, rgb, reducedMotion);

      if (!reducedMotion) {
        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
          p.x = Math.max(0, Math.min(width, p.x));
          p.y = Math.max(0, Math.min(height, p.y));
        }
        for (const item of extras) {
          updateExtra(item, width, height, frame);
        }
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < linkDistance) {
            ctx.strokeStyle = `rgba(${rgb}, ${0.2 * (1 - dist / linkDistance)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      ctx.fillStyle = `rgba(${rgb}, 0.55)`;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, collegeId === "gaming" ? 2 : 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      drawThemeExtras(ctx, collegeId, extras, frame, rgb, reducedMotion);

      if (!reducedMotion) rafId = requestAnimationFrame(step);
    }

    if (reducedMotion) {
      step();
    } else if (visible) {
      rafId = requestAnimationFrame(step);
    }

    return () => {
      running = false;
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [collegeId, reducedMotion, visible]);

  return (
    <header
      ref={containerRef}
      className={`college-hero-banner college-hero-banner--${collegeId}`}
      aria-label={`${displayLabel} college`}
    >
      <canvas ref={canvasRef} className="college-hero-banner__canvas" aria-hidden="true" />
      <div className="college-hero-banner__veil" aria-hidden="true" />
      <div className="college-hero-banner__content">
        <div className="college-hero-banner__mark">
          <span className="college-hero-banner__sigils" aria-hidden="true">
            <span className="college-hero-banner__halo" />
            <span className="college-hero-banner__ring" />
            {sigils.map((sigil, index) => (
              <span
                key={`${sigil}-${index}`}
                className={`college-hero-banner__sigil college-hero-banner__sigil--${index + 1}`}
              >
                {sigil}
              </span>
            ))}
          </span>
          <CollegeIcon collegeId={collegeId} size={ICON_SIZE} className="college-hero-banner__icon" />
        </div>
        <div className="college-hero-banner__copy">
          <h1 className="college-hero-banner__title">{displayLabel}</h1>
          {tagline ? <p className="college-hero-banner__tagline">{tagline}</p> : null}
        </div>
      </div>
    </header>
  );
}

function seedExtras(collegeId, w, h) {
  if (collegeId === "tcg") {
    return Array.from({ length: 8 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      w: 14 + Math.random() * 10,
      h: 20 + Math.random() * 14,
      rot: Math.random() * Math.PI,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.12,
    }));
  }
  if (collegeId === "entertainment") {
    return Array.from({ length: 6 }, (_, i) => ({
      x: (i + 0.5) * (w / 6),
      y: h * 0.5,
      size: 10 + Math.random() * 8,
      phase: Math.random() * Math.PI * 2,
    }));
  }
  if (collegeId === "collectibles") {
    return Array.from({ length: 14 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: 3 + Math.random() * 5,
      twinkle: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.04,
    }));
  }
  if (collegeId === "tabletop") {
    return Array.from({ length: 10 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      pip: 1 + Math.floor(Math.random() * 5),
      vx: (Math.random() - 0.5) * 0.14,
      vy: (Math.random() - 0.5) * 0.14,
    }));
  }
  return [];
}

function updateExtra(item, w, h, frame) {
  if (item.vx != null) {
    item.x += item.vx;
    item.y += item.vy;
    if (item.x < 0 || item.x > w) item.vx *= -1;
    if (item.y < 0 || item.y > h) item.vy *= -1;
  }
  if (item.twinkle != null) {
    item.twinkle += item.speed;
    item.y += Math.sin(frame * 0.01 + item.twinkle) * 0.08;
  }
  if (item.phase != null) {
    item.phase += 0.012;
  }
}

function drawThemeBackdrop(ctx, collegeId, w, h, frame, rgb, reducedMotion) {
  if (collegeId === "gaming" && !reducedMotion) {
    const y = (frame * 1.4) % (h + 40) - 20;
    ctx.fillStyle = `rgba(${rgb}, 0.08)`;
    ctx.fillRect(0, y, w, 3);
    ctx.fillStyle = `rgba(${rgb}, 0.04)`;
    for (let x = 0; x < w; x += 28) {
      ctx.fillRect(x, 0, 1, h);
    }
  }

  if (collegeId === "tabletop") {
    drawHexGrid(ctx, w, h, rgb, 0.06);
  }

  if (collegeId === "entertainment") {
    ctx.fillStyle = `rgba(${rgb}, 0.05)`;
    for (let x = 18; x < w; x += 36) {
      for (let y = 12; y < h; y += 18) {
        ctx.fillRect(x, y, 6, 6);
      }
    }
  }
}

function drawThemeExtras(ctx, collegeId, extras, frame, rgb, reducedMotion) {
  if (collegeId === "tcg") {
    for (const card of extras) {
      ctx.save();
      ctx.translate(card.x, card.y);
      ctx.rotate(card.rot + (reducedMotion ? 0 : frame * 0.001));
      ctx.strokeStyle = `rgba(${rgb}, 0.35)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.rect(-card.w / 2, -card.h / 2, card.w, card.h);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (collegeId === "entertainment") {
    for (const tri of extras) {
      const pulse = reducedMotion ? 1 : 0.85 + Math.sin(tri.phase) * 0.15;
      const s = tri.size * pulse;
      ctx.fillStyle = `rgba(${rgb}, 0.22)`;
      ctx.beginPath();
      ctx.moveTo(tri.x - s * 0.55, tri.y - s * 0.35);
      ctx.lineTo(tri.x - s * 0.55, tri.y + s * 0.45);
      ctx.lineTo(tri.x + s * 0.65, tri.y + s * 0.05);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (collegeId === "collectibles") {
    for (const star of extras) {
      const alpha = reducedMotion ? 0.5 : 0.35 + Math.sin(star.twinkle) * 0.35;
      drawStar(ctx, star.x, star.y, star.size, `rgba(${rgb}, ${alpha})`);
    }
  }

  if (collegeId === "tabletop") {
    for (const die of extras) {
      ctx.fillStyle = `rgba(${rgb}, 0.12)`;
      ctx.beginPath();
      ctx.arc(die.x, die.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${rgb}, 0.65)`;
      drawDicePips(ctx, die.x, die.y, die.pip, 3.2);
    }
  }
}

function drawHexGrid(ctx, w, h, rgb, alpha) {
  const size = 22;
  const hexH = size * Math.sqrt(3);
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = 0.8;
  for (let row = -1; row < h / hexH + 1; row++) {
    for (let col = -1; col < w / (size * 1.5) + 1; col++) {
      const cx = col * size * 1.5;
      const cy = row * hexH + (col % 2 ? hexH / 2 : 0);
      drawHex(ctx, cx, cy, size * 0.92);
    }
  }
}

function drawHex(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawStar(ctx, cx, cy, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.38;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawDicePips(ctx, cx, cy, count, r) {
  const positions = {
    1: [[0, 0]],
    2: [[-r, -r], [r, r]],
    3: [[-r, -r], [0, 0], [r, r]],
    4: [[-r, -r], [r, -r], [-r, r], [r, r]],
    5: [[-r, -r], [r, -r], [0, 0], [-r, r], [r, r]],
  };
  for (const [dx, dy] of positions[count] || positions[1]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
