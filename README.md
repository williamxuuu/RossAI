# RossAI

A pro bono immigration clinic installs this so its paralegals can clear more cases an
hour. The agent does intake, explains jargon, collects documents and scans the finished
packet for problems. **A licensed human reviews and approves everything before it
reaches a client.** The agent never gives legal advice — it explains, collects, checks
and escalates.

Two surfaces, one backend:

- **Chrome extension** — select text on a USCIS page and see what it means in your
  language, with the official passage it came from. Client-facing, anonymous.
- **Paralegal console** — the review queue, the flag stack, the evidence panel.
  Clinic-facing, behind Auth0.

Clients never log into anything. They text and they email, allowing our platform to directly integrate into platforms they already work/live with.

We use CopilotKit to efficiently connect all platforms together. CopilotKit connects an OpenRouter model to the lawyer's interface to allow quicker processing of a user's documents. 

HUGE shoutout to CopilotKit for making it so easy to connect our different services together. We were able to implement Slack, SMS, and email integrations very quickly using OpenRouter for our model provider.


--
This project was made as part of the AI Tinkerers hackathon hosted in Atlanta. Thank you to all our sponsors (OpenAI, CopilotKit, Openrouter, Exa, auth0, Ambiguous, Trigger.dev, Mozilla, and Google Cloud).
