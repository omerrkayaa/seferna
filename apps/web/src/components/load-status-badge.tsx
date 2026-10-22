import { LOAD_STATUS_LABELS, type LoadStatus } from "@nakliye/shared";
import { CircleCheck, CircleX, Clock, FilePen, Hourglass, Lock, TimerOff, type LucideIcon } from "lucide-react";
import { cn } from "cn";

// Durum yalnız renkle değil ikon ve metinle de belirtilir (renk körlüğü)
const STYLE: Record<LoadStatus, { icon: LucideIcon; className: string }> = {
  teyitli: { icon: CircleCheck, className: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-100 border-emerald-200 dark:border-emerald-800" },
  teyit_bekliyor: { icon: Clock, className: "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-800" },
  moderasyonda: { icon: Hourglass, className: "bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-100 border-sky-200 dark:border-sky-800" },
  suresi_doldu: { icon: TimerOff, className: "bg-muted text-muted-foreground border-border" },
  kapandi: { icon: Lock, className: "bg-muted text-muted-foreground border-border" },
  iptal: { icon: CircleX, className: "bg-muted text-muted-foreground border-border" },
  taslak: { icon: FilePen, className: "bg-muted text-muted-foreground border-border" },
};

export function LoadStatusBadge({ status }: { status: LoadStatus }) {
  const { icon: Icon, className } = STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>
      <Icon className="size-3.5" aria-hidden />
      {LOAD_STATUS_LABELS[status]}
    </span>
  );
}
