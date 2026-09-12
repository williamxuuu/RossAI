import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { TwilioChannelProvider } from "./twilio";

/**
 * The SMS webhook is public and opens cases. Twilio signs each request with an
 * HMAC-SHA1 over the webhook URL plus the sorted POST parameters; anything that does
 * not match must be refused before the pipeline sees it.
 */

const AUTH_TOKEN = "test_auth_token";
const URL_ = "https://clinic.example/api/webhooks/channel/sms";

/** Twilio's scheme: url + each parameter name and value, in sorted name order. */
function twilioSignature(params: Record<string, string>, url = URL_, token = AUTH_TOKEN) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

function request(params: Record<string, string>, signature?: string) {
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(signature ? { "x-twilio-signature": signature } : {}),
    },
    body: new URLSearchParams(params).toString(),
  });
}

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.TWILIO_FROM_NUMBER = "+15550000000";
  process.env.TWILIO_WEBHOOK_URL = URL_;
});

describe("TwilioChannelProvider.parseInbound", () => {
  const provider = new TwilioChannelProvider();
  const inbound = { From: "+15551230001", Body: "Hola, necesito ayuda", MessageSid: "SM123", NumMedia: "0" };

  it("rejects a request with no signature", async () => {
    await expect(provider.parseInbound(request(inbound))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a signature computed over different parameters", async () => {
    const forged = twilioSignature({ ...inbound, Body: "something else" });
    await expect(provider.parseInbound(request(inbound, forged))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a valid signature for a different URL", async () => {
    // This is why TWILIO_WEBHOOK_URL exists: a proxy that rewrites the host would
    // otherwise make every genuine request fail, and the fix is config, not a bypass.
    const otherUrl = twilioSignature(inbound, "https://elsewhere.example/hook");
    await expect(provider.parseInbound(request(inbound, otherUrl))).rejects.toMatchObject({ status: 401 });
  });

  it("accepts a correctly signed message", async () => {
    const parsed = await provider.parseInbound(request(inbound, twilioSignature(inbound)));
    expect(parsed).toMatchObject({ channel: "sms", from: "+15551230001", body: "Hola, necesito ayuda", externalId: "SM123" });
    expect(parsed?.attachments).toHaveLength(0);
  });

  it("acknowledges a delivery status callback without processing it", async () => {
    const status = { From: "+15551230001", MessageStatus: "delivered", MessageSid: "SM123" };
    await expect(provider.parseInbound(request(status, twilioSignature(status)))).resolves.toBeNull();
  });

  it("exposes MMS media as lazy attachments", async () => {
    const mms = {
      From: "+15551230001",
      Body: "",
      MessageSid: "SM124",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/ME1",
      MediaContentType0: "image/jpeg",
    };
    const parsed = await provider.parseInbound(request(mms, twilioSignature(mms)));
    expect(parsed?.attachments).toHaveLength(1);
    expect(parsed?.attachments[0]).toMatchObject({ filename: "mms-0.jpg", mimeType: "image/jpeg" });
  });
});

describe("TwilioChannelProvider.sendEmail", () => {
  it("refuses: email is the Ambiguous inbox's job", async () => {
    await expect(new TwilioChannelProvider().sendEmail()).rejects.toThrow(/does not send email/);
  });
});
