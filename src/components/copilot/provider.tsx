"use client";
<<<<<<< HEAD
/** CONTRACT STUB — implemented by the copilot module. Wraps the console in CopilotKitProvider. */
export function RossCopilotProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
=======
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
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
}
