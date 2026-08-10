import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, RefreshCw } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const tones = {
    default: "bg-primary/10 text-primary",
    good: "bg-emerald-500/10 text-emerald-600",
    bad: "bg-rose-500/10 text-rose-600",
    warn: "bg-amber-500/10 text-amber-600",
  };
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 truncate text-xl font-semibold tabular-nums">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            tones[tone],
          )}
        >
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}

export function Loading() {
  return (
    <div className="space-y-4" aria-label="Carregando dados financeiros">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

export function Failed({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Não foi possível carregar</AlertTitle>
      <AlertDescription className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <span>{message}</span>
        <Button size="sm" variant="outline" onClick={retry}>
          <RefreshCw className="mr-2 size-4" />
          Tentar novamente
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-44 flex-col items-center justify-center p-6 text-center">
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}

export const statusBadge = (
  status: string,
): "default" | "destructive" | "secondary" =>
  status === "paid" ||
  status === "active" ||
  status === "reviewed" ||
  status === "healthy"
    ? "default"
    : status === "overdue" ||
        status === "needs_review" ||
        status === "review"
      ? "destructive"
      : "secondary";
