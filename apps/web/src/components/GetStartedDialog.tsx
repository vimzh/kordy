"use client";

// Presents Kordy's sign-in prompt when a visitor starts the product flow.
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function GetStartedDialog({
  buttonBgColor,
  buttonTextColor,
  isAuthenticated = false,
}: {
  buttonBgColor?: string;
  buttonTextColor?: string;
  isAuthenticated?: boolean;
}) {
  const buttonClassName =
    "card-nav-cta-button hidden md:inline-flex border-0 rounded-[calc(0.75rem-0.2rem)] px-4 items-center h-full font-medium cursor-pointer transition-colors duration-300";

  if (isAuthenticated) {
    return (
      <a
        href="/home"
        className={buttonClassName}
        style={{ backgroundColor: buttonBgColor, color: buttonTextColor }}
      >
        Home
      </a>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="card-nav-cta-button hidden md:inline-flex border-0 rounded-[calc(0.75rem-0.2rem)] px-4 items-center h-full font-medium cursor-pointer transition-colors duration-300"
          style={{ backgroundColor: buttonBgColor, color: buttonTextColor }}
        >
          Get Started
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-sm p-0" style={{ fontFamily: "var(--font-kordy)" }}>
        <DialogHeader className="p-6 pr-12">
          <div className="flex items-center gap-3">
            <img src="/kyub-logo.png" alt="" className="size-9 rounded-lg" />
            <DialogTitle className="text-xl tracking-[-0.04em]">Hey, I&apos;m Kordy.</DialogTitle>
          </div>
        </DialogHeader>
        <div className="p-6 pt-0">
          <Button asChild size="lg" className="w-full">
            <a href="/login">Continue with Google</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
