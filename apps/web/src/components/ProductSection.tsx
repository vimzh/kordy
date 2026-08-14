import Image from "next/image";

const flowCards = [
  {
    image: "/kordy-flow/describe-trigger.png",
    title: "Say what should wake you",
    description:
      "Describe the moment in plain language. Kordy turns the sentence into a trigger without making you build a workflow.",
  },
  {
    image: "/kordy-flow/connect-context.png",
    title: "Connect the right context",
    description:
      "Choose the people and sources that matter. Kordy watches the signal across Gmail, calendars, databases, and more.",
  },
  {
    image: "/kordy-flow/receive-call.png",
    title: "Get called, not buried",
    description:
      "When the condition is met, Kordy calls the right person with a concise summary and the context needed to act.",
  },
];

export function ProductSection() {
  return (
    <section id="product" className="bg-background px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-4xl font-[family-name:var(--font-kordy)] text-4xl leading-[1.06] font-medium tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl">
          Kordy watches the noise, then calls when it matters.
        </h2>
        <p className="mt-7 max-w-3xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Tell Kordy what deserves your attention, connect the places where it could happen, and choose who should hear about it. The rest runs quietly in the background.
        </p>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {flowCards.map((card) => (
            <article key={card.title} className="overflow-hidden rounded-2xl border border-border bg-card p-2">
              <Image
                src={card.image}
                alt=""
                width={1448}
                height={1086}
                className="aspect-4/3 w-full rounded-xl object-cover"
              />
              <div className="px-3 pb-4 pt-5 sm:px-4">
                <h3 className="font-[family-name:var(--font-kordy)] text-lg font-semibold tracking-[-0.02em] text-card-foreground">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
