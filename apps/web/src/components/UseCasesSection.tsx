import Image from "next/image";

const useCases = [
  {
    number: "01",
    image: "/kordy-use-cases/personal-alerts.png",
    title: "Personal peace of mind",
    description:
      "Get a call for the personal moments you cannot afford to miss—from a medicine reminder to a safety alert at home.",
  },
  {
    number: "02",
    image: "/kordy-use-cases/team-emergencies.png",
    title: "Route team emergencies",
    description:
      "Send critical events straight to the right on-call person instead of chasing an entire organization manually.",
  },
  {
    number: "03",
    image: "/kordy-use-cases/market-moves.png",
    title: "Watch market moves",
    description:
      "Set a price or movement threshold and let Kordy call when the market reaches the condition you described.",
  },
  {
    number: "04",
    image: "/kordy-use-cases/production-incidents.png",
    title: "Protect production",
    description:
      "Turn downtime, failed deployments, and health-check failures into immediate calls with useful incident context.",
  },
  {
    number: "05",
    image: "/kordy-use-cases/log-anomalies.png",
    title: "Listen to your logs",
    description:
      "Watch noisy application logs for one meaningful pattern, then escalate only when that signal appears.",
  },
  {
    number: "06",
    image: "/kordy-use-cases/customer-signals.png",
    title: "Catch important replies",
    description:
      "Call sales or support when a VIP customer replies, an urgent request arrives, or a high-intent lead returns.",
  },
];

export function UseCasesSection() {
  return (
    <section id="use-cases" className="bg-secondary/30 px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-6xl">
        <p className="font-[family-name:var(--font-kordy)] text-sm font-semibold text-primary">
          Use cases
        </p>
        <h2 className="mt-5 max-w-4xl font-[family-name:var(--font-kordy)] text-4xl leading-[1.06] font-medium tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl">
          Give it a prompt. Kordy builds the voice agent.
        </h2>
        <p className="mt-7 max-w-3xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Track almost any event across your personal life or organization. Kordy keeps watch, gathers the context, and calls the right person when the condition becomes real.
        </p>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {useCases.map((useCase) => (
            <article
              key={useCase.number}
              className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-2"
            >
              <div className="relative">
                <Image
                  src={useCase.image}
                  alt=""
                  width={1448}
                  height={1086}
                  className="aspect-4/3 w-full rounded-xl object-cover"
                />
                <span className="absolute left-4 top-4 font-[family-name:var(--font-kordy)] text-sm font-semibold text-primary">
                  {useCase.number}
                </span>
              </div>
              <div className="flex flex-1 flex-col px-3 pb-4 pt-5 sm:px-4">
                <h3 className="font-[family-name:var(--font-kordy)] text-lg font-semibold tracking-[-0.02em] text-card-foreground">
                  {useCase.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {useCase.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
