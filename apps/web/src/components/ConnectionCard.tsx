import type { ComponentType, CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ConnectionCardProps = {
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  status?: "connected" | "needs_reconnect" | "disconnected";
  detail?: string;
  busy?: boolean;
  connectHref?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export function ConnectionCard({
  name,
  description,
  icon: Icon,
  status,
  detail,
  busy,
  connectHref,
  onConnect,
  onDisconnect,
}: ConnectionCardProps) {
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
        {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-2">
          {status ? <Badge variant={status === "connected" ? "secondary" : "outline"}>{status.replaceAll("_", " ")}</Badge> : <span />}
          <div className="flex gap-1">
            {status === "needs_reconnect" && onDisconnect ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={onDisconnect}>Disconnect</Button>
            ) : null}
            {status === "connected" ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={onDisconnect}>Disconnect</Button>
            ) : connectHref ? (
              <Button asChild variant="ghost">
                <a href={connectHref}>{status === "needs_reconnect" ? "Reconnect" : "Connect"}</a>
              </Button>
            ) : onConnect ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={onConnect}>
                {status === "needs_reconnect" ? "Reconnect" : "Connect"}
              </Button>
            ) : (
              <Button type="button" variant="ghost" disabled>Coming soon</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
