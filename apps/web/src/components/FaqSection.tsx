import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "What can I ask Kordy to watch?",
    answer:
      "Any event that a connected source can expose—an important email, a price threshold, a calendar change, a failed deployment, a log pattern, or a database event.",
  },
  {
    question: "How does one prompt become a voice agent?",
    answer:
      "Kordy identifies the condition, the source to watch, and the person to call. That becomes a focused voice-agent flow that stays on watch until the event occurs.",
  },
  {
    question: "Who can Kordy call?",
    answer:
      "Kordy can call you or anyone saved in your contacts. Contacts can include international phone numbers and a short note explaining who they are.",
  },
  {
    question: "Which sources can I connect?",
    answer:
      "The current connection catalog includes sources such as Gmail, Slack, GitHub, Google Calendar, Vercel, and PostgreSQL. Each flow uses only the sources you select.",
  },
  {
    question: "What happens when a trigger fires?",
    answer:
      "Kordy gathers the relevant context, calls the selected person with a concise summary, and records the trigger, source, outcome, and conclusion in the logs table.",
  },
  {
    question: "Can an organization use Kordy?",
    answer:
      "Yes. Teams can route critical events to the right owner or on-call contact instead of relying on someone to notice a dashboard, message, or email in time.",
  },
  {
    question: "Do I need to write code?",
    answer:
      "No. Describe the event in plain language, mention a contact if needed, choose the relevant sources, and create the flow.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="bg-background px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24">
        <div>
          <p className="font-[family-name:var(--font-kordy)] text-sm font-semibold text-primary">
            FAQ
          </p>
          <h2 className="mt-5 max-w-md font-[family-name:var(--font-kordy)] text-4xl leading-[1.06] font-medium tracking-[-0.045em] text-foreground sm:text-5xl">
            A few things to know before the call.
          </h2>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            Kordy turns plain-language instructions into focused call flows that watch, understand, and escalate.
          </p>
        </div>

        <Accordion type="single" collapsible defaultValue="faq-0" className="border-t border-border">
          {faqs.map((faq, index) => (
            <AccordionItem key={faq.question} value={`faq-${index}`}>
              <AccordionTrigger className="py-5 font-[family-name:var(--font-kordy)] text-base font-semibold hover:no-underline md:text-lg">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="max-w-2xl pb-6 text-sm leading-relaxed text-muted-foreground md:text-base">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
