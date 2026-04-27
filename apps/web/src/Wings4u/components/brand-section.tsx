"use client";

import { useEffect, useRef, useState } from "react";

type StatDef = {
  id: string;
  target: number;
  label: string;
  delay: number;
  suffix?: string;
};

const STATS: StatDef[] = [
  { id: "sauces", target: 70, suffix: "+", label: "Signature Sauces & Dry Rubs", delay: 0 },
  { id: "cat", target: 9, label: "Menu Categories to Explore", delay: 90 },
  { id: "min", target: 15, label: "Minutes From Fryer to Your Hands", delay: 180 },
  { id: "frozen", target: 0, label: "Frozen Wings. Ever.", delay: 270 },
];

const DURATION_MS = 1400;

function useCountUp(target: number, run: boolean, delayMs: number, reduceMotion: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!run) {
      setValue(0);
      return;
    }
    if (reduceMotion) {
      setValue(target);
      return;
    }

    let raf = 0;
    let cancelled = false;
    const delayHandle = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const elapsed = now - start;
        const p = Math.min(elapsed / DURATION_MS, 1);
        const eased = 1 - (1 - p) ** 3;
        setValue(Math.round(target * eased));
        if (p < 1) {
          raf = requestAnimationFrame(tick);
        } else {
          setValue(target);
        }
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(delayHandle);
      cancelAnimationFrame(raf);
    };
  }, [run, target, delayMs, reduceMotion]);

  return value;
}

function BrandStatRow({
  target,
  suffix,
  label,
  delay,
  visible,
  reduceMotion,
}: {
  target: number;
  suffix?: string;
  label: string;
  delay: number;
  visible: boolean;
  reduceMotion: boolean;
}) {
  const value = useCountUp(target, visible, delay, reduceMotion);
  const showPlus = suffix === "+" && value === target;

  const display = `${value}${showPlus ? (suffix ?? "") : ""}`;

  return (
    <div className="brand-stat">
      <span className="brand-stat-num brand-stat-num--gradient">{display}</span>
      <span className="brand-stat-label">{label}</span>
    </div>
  );
}

export function BrandSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduceMotion(true);
      setVisible(true);
      return;
    }

    const el = sectionRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show = visible ? " is-visible" : "";

  return (
    <section id="brand" ref={sectionRef} className="brand-section">
      <div className={`brand-numbers reveal-left${show}`}>
        {STATS.map((s) => (
          <BrandStatRow
            key={s.id}
            target={s.target}
            suffix={s.suffix}
            label={s.label}
            delay={s.delay}
            visible={visible}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>

      <div className={`brand-copy reveal-right${show}`}>
        <p className="section-label">Our Story</p>
        <h2 className="brand-heading">
          <span className="brand-heading-line">We Don&rsquo;t Cut</span>
          <span className="brand-heading-line gradient-text">Corners.</span>
          <span className="brand-heading-line">
            We Cut Deep Into <span className="gradient-text">Flavor.</span>
          </span>
        </h2>
        <p className="brand-body">
          Wings4U was born from one obsession: making the{" "}
          <strong>crispiest, sauciest wings</strong> London has ever tasted. Every order is hand-breaded
          fresh. Every sauce is made in-house. No freezers. No shortcuts.
        </p>
        <p className="brand-body">
          With <strong>70+ sauces and dry rubs</strong>, 9 menu categories, and wings that go straight
          from fryer to your hands in under <strong>15 minutes</strong> {"\u2014"} we&apos;re here to change the
          game.
        </p>
        <a
          className="brand-tag"
          href="https://www.google.com/maps/place/Wings+4+U/@42.9998852,-81.1969498,17z/data=!3m1!4b1!4m6!3m5!1s0x882eed8b8faafa97:0x78512ed6464370a3!8m2!3d42.9998852!4d-81.1943749!16s%2Fg%2F11n3cxbx6g?entry=ttu&g_ep=EgoyMDI2MDMyMi4wIKXMDSoASAFQAw%3D%3D"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open Wings 4 U on Google Maps (opens in a new tab)"
        >
          {"\u{1F525}"} Now Open in London, ON
        </a>
      </div>
    </section>
  );
}
