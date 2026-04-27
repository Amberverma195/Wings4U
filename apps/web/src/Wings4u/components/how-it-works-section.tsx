"use client";

import { useEffect, useRef, useState } from "react";

type Step = {
  num: string;
  icon: string;
  title: string;
  desc: string;
  arrow: boolean;
};

const STEPS: Step[] = [
  {
    num: "01",
    icon: "\u{1F4F1}",
    title: "PICK YOUR SAUCE",
    desc: "Browse 65 hand-crafted flavors. Choose your heat. Breaded or plain. Customize like you mean it.",
    arrow: true,
  },
  {
    num: "02",
    icon: "\u{1F525}",
    title: "WE FIRE IT FRESH",
    desc: "Every single wing is hand-breaded when you order. No freezer. No shortcuts. Just the fryer.",
    arrow: true,
  },
  {
    num: "03",
    icon: "\u{1F6CD}\uFE0F",
    title: "GRAB OR GET IT DELIVERED",
    desc: "Walk in and grab it hot, or we'll bring it to your door. Pickup in 15 minutes. Delivery available.",
    arrow: false,
  },
];

export function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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

  const show = visible ? " in" : "";

  return (
    <section id="how" ref={sectionRef}>
      <div className={`section-head reveal${show}`}>
        <p className="section-label">THE PROCESS</p>
        <h2>
          <span>HOW IT </span>
          <span className="gradient-text">WORKS</span>
        </h2>
        <div className="section-divider" aria-hidden="true" />
      </div>

      <div className="steps">
        {STEPS.map((step) => (
          <div key={step.num} className={`step reveal${show}`}>
            <div className="step-num">{step.num}</div>
            <div className="step-icon" aria-hidden="true">
              {step.icon}
            </div>
            <h3 className="step-title">{step.title}</h3>
            <p className="step-desc">{step.desc}</p>
            {step.arrow ? (
              <span className="step-arrow" aria-hidden="true">
                {"\u2192"}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
