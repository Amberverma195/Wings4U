"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

type Tier = "small" | "medium" | "large";

export type EmberParticle = {
  id: string;
  tier: Tier;
  left: string;
  duration: string;
  delay: string;
  drift: string;
  driftEnd: string;
  maxOpacity: number;
  fadeOpacity: number;
  noBlur: boolean;
};

function particleCount(width: number): number {
  if (width < 640) return 18;
  if (width < 1024) return 28;
  return 38;
}

function pickTier(): Tier {
  const r = Math.random();
  if (r < 0.5) return "small";
  if (r < 0.85) return "medium";
  return "large";
}

function tierDurationRange(tier: Tier): [number, number] {
  switch (tier) {
    case "small":
      return [6, 10];
    case "medium":
      return [4, 7];
    case "large":
      return [3, 5];
    default:
      return [4, 7];
  }
}

function buildParticles(mobileNoBlur: boolean, count: number): EmberParticle[] {
  const particles: EmberParticle[] = [];
  for (let i = 0; i < count; i++) {
    const tier = pickTier();
    const [dMin, dMax] = tierDurationRange(tier);
    const durationSec = dMin + Math.random() * (dMax - dMin);
    const delaySec = Math.random() * 8;
    const driftPx = -40 + Math.random() * 80;
    const driftEndPx = -60 + Math.random() * 120;
    const maxOpacity = tier === "small" ? 0.3 : tier === "medium" ? 0.5 : 0.7;
    particles.push({
      id: `ember-${i}-${Math.random().toString(36).slice(2, 9)}`,
      tier,
      left: `${Math.random() * 100}%`,
      duration: `${durationSec.toFixed(2)}s`,
      delay: `${delaySec.toFixed(2)}s`,
      drift: `${driftPx.toFixed(1)}px`,
      driftEnd: `${driftEndPx.toFixed(1)}px`,
      maxOpacity,
      fadeOpacity: maxOpacity * 0.3,
      noBlur: mobileNoBlur && tier === "small",
    });
  }
  return particles;
}

export function FireEmbers() {
  const [particles, setParticles] = useState<EmberParticle[] | null>(null);

  useEffect(() => {
    let debounce: number;
    const run = () => {
      const w = window.innerWidth;
      setParticles(buildParticles(w < 768, particleCount(w)));
    };
    run();
    const onResize = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(run, 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(debounce);
    };
  }, []);

  if (particles == null) return null;

  return (
    <div className="fire-embers" aria-hidden="true">
      <div className="fire-base" />
      <div className="heat-distort" />
      {particles.map((p) => (
        <div
          key={p.id}
          className={`ember ember--${p.tier}${p.noBlur ? " ember--noblur-small" : ""}`}
          style={
            {
              left: p.left,
              bottom: "-20px",
              "--drift": p.drift,
              "--drift-end": p.driftEnd,
              "--max-opacity": p.maxOpacity,
              "--fade-opacity": p.fadeOpacity,
              animationDuration: p.duration,
              animationDelay: p.delay,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
