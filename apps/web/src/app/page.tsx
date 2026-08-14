import { cookies } from "next/headers";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import CardNav, { type CardNavItem } from "@/components/CardNav";
import { FaqSection } from "@/components/FaqSection";
import { Hero } from "@/components/Hero";
import { ProductSection } from "@/components/ProductSection";
import { UseCasesSection } from "@/components/UseCasesSection";

const navItems: CardNavItem[] = [
  {
    label: "Product",
    bgColor: "var(--secondary)",
    textColor: "var(--foreground)",
    links: [
      { label: "Home", href: "/", ariaLabel: "Go to the Kordy home page" },
      {
        label: "API health",
        href: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007"}/health`,
        ariaLabel: "Check the Kordy API health endpoint",
      },
    ],
  },
  {
    label: "Stack",
    bgColor: "var(--border)",
    textColor: "var(--foreground)",
    links: [
      { label: "Next.js", href: "https://nextjs.org", ariaLabel: "Open Next.js" },
      { label: "Hono", href: "https://hono.dev", ariaLabel: "Open Hono" },
    ],
  },
  {
    label: "Interface",
    bgColor: "var(--primary)",
    textColor: "var(--primary-foreground)",
    links: [
      { label: "shadcn/ui", href: "https://ui.shadcn.com", ariaLabel: "Open shadcn/ui" },
      { label: "React Bits", href: "https://reactbits.dev", ariaLabel: "Open React Bits" },
    ],
  },
];

export default async function Home() {
  const isAuthenticated = (await cookies()).has("kyub_session");

  return (
    <main className="relative min-h-screen overflow-hidden">
      <AnnouncementBar />
      <CardNav
        className="!top-[3.45rem] md:!top-[4.25rem]"
        logo="/kyub-logo.png"
        logoAlt="Kordy"
        items={navItems}
        baseColor="var(--primary)"
        menuColor="var(--primary-foreground)"
        buttonBgColor="var(--primary-foreground)"
        buttonTextColor="var(--primary)"
        isAuthenticated={isAuthenticated}
      />
      <Hero />
      <ProductSection />
      <UseCasesSection />
      <FaqSection />
    </main>
  );
}
