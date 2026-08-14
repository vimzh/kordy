import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const kordyFont = Manrope({
  variable: "--font-kordy",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kordy",
  description: "Next.js and Hono monorepo",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${kordyFont.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
