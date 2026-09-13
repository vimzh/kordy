"use client";

// Presents Kordy's sign-in prompt when a visitor starts the product flow.
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DemoLoginForm } from "@/components/DemoLoginForm";

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
    "card-nav-cta-button inline-flex border-0 rounded-[calc(0.75rem-0.2rem)] px-3 md:px-4 items-center h-full font-medium cursor-pointer transition-colors duration-300";

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
          className={buttonClassName}
          style={{ backgroundColor: buttonBgColor, color: buttonTextColor }}
        >
          Get Started
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-sm p-0" style={{ fontFamily: "var(--font-kordy)" }}>
        <DemoLoginForm />
      </DialogContent>
    </Dialog>
  );
}
