"use client";

import { motion } from "motion/react";

import TextType from "@/components/TextType";

const triggers = [
  "production goes down",
  "a payment fails",
  "a VIP lead replies",
  "Tesla hits $300",
  "my flight is delayed",
  "Bitcoin drops 10%",
  "an invoice is overdue",
  "@Alex needs help",
  "error rates spike",
  "a deployment fails",
];

export function RotatingCallText() {
  return (
    <motion.span
      layout="position"
      transition={{ layout: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
      className="grid min-h-[2.4em] max-w-full grid-cols-1 items-center justify-items-center gap-y-0.5 md:min-h-[1.2em] md:grid-cols-[auto_auto] md:justify-center md:justify-items-start md:gap-x-[0.22em]"
    >
      <span className="shrink-0">Call me when</span>
      <span className="h-[1.2em] max-w-full text-foreground">
        <TextType
          as="span"
          text={triggers}
          typingSpeed={55}
          deletingSpeed={32}
          pauseDuration={1800}
          showCursor={false}
          className="bg-linear-to-r from-turquoise to-turquoise-light bg-clip-text text-center leading-tight whitespace-nowrap text-transparent md:text-left"
          aria-live="polite"
        />
      </span>
    </motion.span>
  );
}
