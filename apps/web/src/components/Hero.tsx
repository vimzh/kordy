import type { CSSProperties } from "react";
import { RotatingCallText } from "@/components/RotatingCallText";
import AIOrbFace from "@/components/smoothui/ai-orb-face";
import SmoothButton from "@/components/smoothui/smooth-button";

export function Hero() {
  return (
    <section
      className="flex min-h-screen w-full flex-col items-center justify-center px-6 pb-20 pt-36 text-center md:px-10 md:pt-44"
      style={{
        backgroundImage: "var(--hero-gradient)",
        fontFamily: "var(--font-kordy)",
      }}
    >
      <h1
        className="flex max-w-full flex-col items-center gap-3 text-[2rem] font-medium leading-[1.08] tracking-[-0.045em] sm:text-[2.5rem] lg:text-5xl"
        style={{ fontFamily: "var(--font-kordy)" }}
      >
        <span className="flex items-center gap-3">
          <AIOrbFace
            aria-label="Kordy AI assistant"
            colors={{
              body: "var(--brand-light)",
              bodyEdge: "var(--brand)",
              feature: "var(--surface-dark-band)",
            }}
            size={64}
          />
          <span>Hey Kordy,</span>
        </span>
        <RotatingCallText />
      </h1>

      <p className="mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
        Set up no-code triggers for real-life events and get a call when something important needs your urgent attention.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <SmoothButton
          style={
            {
              "--btn": "var(--brand)",
              "--btn-fg": "#ffffff",
              "--btn-hover": "var(--brand-secondary)",
            } as CSSProperties
          }
          type="button"
          size="lg"
          variant="candy"
        >
          Try Now
        </SmoothButton>
        <SmoothButton
          className="hover:bg-white"
          type="button"
          variant="outline"
          size="lg"
        >
          How it works
        </SmoothButton>
      </div>
    </section>
  );
}
