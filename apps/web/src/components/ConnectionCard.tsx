import type { ComponentType, CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ConnectionCardProps = {
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

export function ConnectionCard({ name, description, icon: Icon }: ConnectionCardProps) {
  return (
    <Card
      size="sm"
      className="h-full gap-2"
      style={{ "--card-spacing": "12px" } as CSSProperties}
    >
      <CardHeader className="gap-1">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-[family-name:var(--font-kordy)] text-sm leading-5 font-medium">
            {name}
          </CardTitle>
          <div className="flex size-10 shrink-0 items-center justify-center">
            <Icon className="size-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <Button type="button" variant="ghost" className="mt-auto self-end">
          Connect
        </Button>
      </CardContent>
    </Card>
  );
}
