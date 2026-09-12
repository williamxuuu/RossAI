"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { caseActionRequest } from "./api";

/**
 * "Remind the client" for a case still collecting documents. Sends the clinic's own
 * `document.nudge` template (spec §3.3 step 4, manually triggered) — never model
 * text — and re-reads the page so the audit trail is what the screen shows.
 */
export function NudgeButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: boolean }>({ busy: false });

  async function nudge() {
    setState({ busy: true });
    const result = await caseActionRequest(caseId, "nudge");
    if (!result.ok) {
      setState({ busy: false, error: result.error });
      return;
    }
    setState({ busy: false, done: true });
    startTransition(() => router.refresh());
  }

  return (
    <span className="flex items-center gap-2">
      {state.error ? (
        <span className="text-xs text-error" role="alert">
          {state.error}
        </span>
      ) : null}
      <Button size="sm" variant="secondary" busy={state.busy} disabled={state.done} onClick={nudge} title="Text the client a reminder of what is still missing">
        {state.done ? "Reminder sent" : "Remind client"}
      </Button>
    </span>
  );
}
