"use client";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

/**
 * Wraps the console so the review page can mount a copilot (spec §1, §3.6).
 *
 * `credentials: "same-origin"` matters: /api/copilotkit is behind the paralegal
 * session, and the runtime's fetches have to carry the Auth0 cookie.
 *
 * With no model configured the provider is not mounted at all. It is not only that a
 * copilot with no model is useless — the provider renders its own floating controls,
 * and a button that opens a chat which cannot answer is worse than no button.
 */
export function RossCopilotProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="default" credentials="same-origin">
      {children}
    </CopilotKitProvider>
  );
}
