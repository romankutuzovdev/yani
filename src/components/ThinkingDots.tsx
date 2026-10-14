"use client";

import { useEffect, useState } from "react";

/** «Думаю.» → «Думаю..» → «Думаю...» по одной точке. */
export function ThinkingDots({ word = "Думаю" }: { word?: string }) {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDots((n) => (n >= 3 ? 1 : n + 1));
    }, 450);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span aria-live="polite">
      {word}
      <span className="inline-block w-[1.2em] text-left">{".".repeat(dots)}</span>
    </span>
  );
}
