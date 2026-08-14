"use client";

import { useState } from "react";
import { X } from "lucide-react";

const CALL_E_HACK_URL = "https://call-e.devpost.com/";

export function AnnouncementBar() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return null;
  }

  return (
    <aside className="absolute inset-x-0 top-0 z-[100] flex h-9 items-center justify-center bg-black px-10 text-center text-xs font-medium text-white">
      <a
        href={CALL_E_HACK_URL}
        target="_blank"
        rel="noreferrer"
        className="underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
      >
        Built using CALL-E for the CALL-E Hack
      </a>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => setIsVisible(false)}
        className="absolute right-2 inline-flex size-6 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}
