import { ArrowRight } from "lucide-react";
import { Field, selectClass } from "@/components/field";
import { buttonVariants } from "@/components/ui/button";
import { TR_PROVINCES } from "@/lib/provinces";

const SORTED = [...TR_PROVINCES].sort((a, b) => a[1].localeCompare(b[1], "tr"));

/**
 * Tanıtım açılışında rota formu: iller seçilir, ilan formu bu illerle açılır (ilçe orada seçilir).
 * Betiksiz GET formu; girişsizse proxy girişe gönderir ve sorgu dizesi girişten sonra korunur.
 */
export function RouteForm() {
  return (
    <form action="/panel/ilanlar/yeni" method="get" aria-label="Yük ilanı ver" className="grid max-w-3xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Select name="nereden" label="Nereden" />
      <Select name="nereye" label="Nereye" />
      <button type="submit" className={buttonVariants({ size: "lg", className: "h-11 px-6 text-base" })}>
        İlan ver <ArrowRight aria-hidden />
      </button>
    </form>
  );
}

function Select({ name, label }: { name: string; label: string }) {
  return (
    <Field label={label} htmlFor={`rota-${name}`}>
      <select id={`rota-${name}`} name={name} required defaultValue="" className={selectClass}>
        <option value="" disabled>
          İl seçin
        </option>
        {SORTED.map(([id, n]) => (
          <option key={id} value={id}>
            {n}
          </option>
        ))}
      </select>
    </Field>
  );
}
