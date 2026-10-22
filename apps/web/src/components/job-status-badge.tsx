import { JOB_STATUS_LABELS, type JobStatus } from "@nakliye/shared";
import { CircleCheck, CircleX, Handshake, Package, PackageCheck, TriangleAlert, Truck, type LucideIcon } from "lucide-react";
import { cn } from "cn";

// Durum yalnız renkle değil ikon ve metinle de belirtilir
const STYLE: Record<JobStatus, { icon: LucideIcon; className: string }> = {
  anlasildi: { icon: Handshake, className: "bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-100 border-sky-200 dark:border-sky-800" },
  yuklendi: { icon: Package, className: "bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-100 border-sky-200 dark:border-sky-800" },
  yolda: { icon: Truck, className: "bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-100 border-sky-200 dark:border-sky-800" },
  teslim_edildi: { icon: PackageCheck, className: "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-800" },
  tamamlandi: { icon: CircleCheck, className: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-100 border-emerald-200 dark:border-emerald-800" },
  itirazli: { icon: TriangleAlert, className: "bg-destructive/10 text-destructive border-destructive/30" },
  iptal: { icon: CircleX, className: "bg-muted text-muted-foreground border-border" },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { icon: Icon, className } = STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}>
      <Icon className="size-3.5" aria-hidden />
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}
