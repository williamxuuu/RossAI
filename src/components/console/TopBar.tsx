import Link from "next/link";
import { getParalegal } from "@/lib/auth";
import { GearIcon } from "@/components/ui/icons";
import { PillNav } from "./PillNav";

/** Top chrome: wordmark, pill nav, settings gear and the signed-in paralegal. Server component. */
export async function TopBar() {
  const paralegal = await getParalegal();
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
      <Link href="/" className="flex items-baseline gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
        <span className="text-lg font-semibold tracking-tight text-ink">RossAI</span>
        <span className="text-sm text-muted">Intake &amp; prep</span>
      </Link>
      <PillNav />
      <div className="ml-auto flex items-center gap-3">
        {paralegal ? (
          <span className="text-sm text-muted" title={paralegal.email ?? paralegal.id}>
            {paralegal.name}
          </span>
        ) : (
          <Link href="/auth/login" className="text-sm text-muted hover:text-ink">
            Sign in
          </Link>
        )}
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="inline-flex size-10 items-center justify-center rounded-full bg-surface text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
