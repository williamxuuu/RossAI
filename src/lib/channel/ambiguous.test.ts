import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { AmbiguousChannelProvider } from "./ambiguous";

/**
 * The email webhook is a public endpoint that can attach documents to a case. An
 * unauthenticated caller must never get through it, and a payload shape we did not
 * anticipate must degrade to "ignored", never to a 500 that makes the provider retry
 * forever.
 */

const SECRET = "whsec_test_secret";

function signed(payload: unknown, secret = SECRET, headerName = "x-ambiguous-signature") {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return new Request("https://clinic.example/api/webhooks/channel/email", {
    method: "POST",
    headers: { "content-type": "application/json", [headerName]: signature },
    body: raw,
  });
}

beforeEach(() => {
  process.env.AMBIGUOUS_WEBHOOK_SECRET = SECRET;
  process.env.AMBIGUOUS_API_KEY = "amb_test_key";
});

describe("AmbiguousChannelProvider.parseInbound", () => {
  const provider = new AmbiguousChannelProvider();

  it("rejects a request with no signature", async () => {
    const req = new Request("https://clinic.example/x", { method: "POST", body: JSON.stringify({ event: "email.received" }) });
    await expect(provider.parseInbound(req)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a request signed with the wrong secret", async () => {
    await expect(provider.parseInbound(signed({ event: "email.received" }, "wrong_secret"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("refuses to accept anything at all when no secret is configured", async () => {
    delete process.env.AMBIGUOUS_WEBHOOK_SECRET;
    await expect(provider.parseInbound(signed({ event: "email.received" }))).rejects.toThrow(/AMBIGUOUS_WEBHOOK_SECRET/);
  });

  it("accepts the sha256= header form providers often use", async () => {
    const raw = JSON.stringify({ event: "email.received", data: { from: "maria@example.com", text: "hola" } });
    const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
    const req = new Request("https://clinic.example/x", {
      method: "POST",
      headers: { "x-signature": `sha256=${signature}` },
      body: raw,
    });
    await expect(provider.parseInbound(req)).resolves.toMatchObject({ from: "maria@example.com" });
  });

  it("reads the sender however the payload spells it", async () => {
    const shapes = [
      { from: "Maria Garcia <MARIA@Example.com>" },
      { from: { address: "maria@example.com" } },
      { from: [{ email: "maria@example.com" }] },
      { from_address: "maria@example.com" },
    ];
    for (const shape of shapes) {
      const parsed = await provider.parseInbound(signed({ event: "email.received", data: { ...shape, text: "hola" } }));
      expect(parsed?.from, JSON.stringify(shape)).toBe("maria@example.com");
    }
  });

  it("carries the subject through, because the case code lives there", async () => {
    const parsed = await provider.parseInbound(
      signed({ event: "email.received", data: { from: "m@example.com", subject: "Mis documentos RA-903CDB", text: "" } }),
    );
    expect(parsed?.subject).toBe("Mis documentos RA-903CDB");
  });

  it("reads inline base64 attachments", async () => {
    const parsed = await provider.parseInbound(
      signed({
        event: "email.received",
        data: {
          from: "m@example.com",
          text: "",
          attachments: [{ filename: "passport.pdf", content_type: "application/pdf", content: Buffer.from("%PDF-1.7").toString("base64") }],
        },
      }),
    );
    expect(parsed?.attachments).toHaveLength(1);
    expect((await parsed!.attachments[0].bytes()).toString()).toBe("%PDF-1.7");
  });

  it("ignores events that are not a delivery, instead of failing them", async () => {
    await expect(provider.parseInbound(signed({ event: "email.sent", data: { id: "m1" } }))).resolves.toBeNull();
  });

  it("ignores a verified payload it cannot understand, rather than 500ing into a retry loop", async () => {
    await expect(provider.parseInbound(signed({ event: "email.received", data: { nothing: "useful" } }))).resolves.toBeNull();
  });
});

describe("AmbiguousChannelProvider.sendSms", () => {
  it("refuses, because Ambiguous has no SMS capability", async () => {
    await expect(new AmbiguousChannelProvider().sendSms()).rejects.toThrow(/no SMS capability/);
  });
});
