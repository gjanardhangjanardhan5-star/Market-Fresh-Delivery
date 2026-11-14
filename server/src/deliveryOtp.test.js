import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDeliveryOtp,
  hashDeliveryOtp,
  matchesDeliveryOtp,
  normalizeSmsPhone,
  sendDeliveryOtpSms
} from "./deliveryOtp.js";
import { Order } from "./models.js";

test("generates six-digit codes and hashes them per order", () => {
  const secret = "a".repeat(32);
  const otp = generateDeliveryOtp();
  assert.match(otp, /^\d{6}$/);

  const hash = hashDeliveryOtp(otp, "order-1", secret);
  assert.match(hash, /^[a-f\d]{64}$/);
  assert.equal(matchesDeliveryOtp(otp, hash, "order-1", secret), true);
  assert.equal(matchesDeliveryOtp("000000", hash, "order-1", secret), otp === "000000");
  assert.equal(matchesDeliveryOtp(otp, hash, "order-2", secret), false);
});

test("normalizes local and international SMS phone numbers", () => {
  assert.equal(normalizeSmsPhone("+91 98765-43210"), "+919876543210");
  assert.equal(normalizeSmsPhone("09876543210"), "+919876543210");
  assert.equal(normalizeSmsPhone("0044 7700 900123"), "+447700900123");
  assert.equal(normalizeSmsPhone("123"), null);
});

test("keeps delivery OTP fields out of serialized order responses", () => {
  const order = new Order({
    user: "1234567890abcdef12345678",
    deliveryAddress: { phone: "+919876543210", recipient: "Customer" },
    items: [],
    subtotal: 0,
    serviceCharge: 0,
    total: 0,
    paymentMethod: "cod",
    deliveryOtpHash: "private-hash",
    deliveryOtpExpiresAt: new Date(),
    deliveryOtpAttempts: 1,
    deliveryOtpSentAt: new Date(),
    deliveryOtpResends: 2,
    deliveryEvents: [{ type: "otp_invalid", actorRole: "delivery", note: "incorrect code" }]
  });
  const response = order.toJSON();

  for (const field of ["deliveryOtpHash", "deliveryOtpExpiresAt", "deliveryOtpAttempts", "deliveryOtpSentAt", "deliveryOtpResends"]) {
    assert.equal(Order.schema.path(field).options.select, false);
    assert.equal(response[field], undefined);
  }
  assert.equal(response.deliveryEvents, undefined);
  assert.ok(Order.schema.path("status").enumValues.includes("confirmed"));
  assert.equal(Order.schema.path("deliveryPerson").options.ref, "DeliveryPerson");
});

test("sends OTP messages using backend-only Twilio credentials", async () => {
  const keys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let request;
  Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "server-token",
    TWILIO_FROM_NUMBER: "+15551234567"
  });
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: new URLSearchParams(options.body) };
    return { ok: true };
  };

  try {
    const result = await sendDeliveryOtpSms({
      phone: "+91 9876543210",
      otp: "012345",
      orderId: "1234567890abcdef12345678"
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(request.url, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from("AC123:server-token").toString("base64")}`);
    assert.equal(request.body.get("To"), "+919876543210");
    assert.match(request.body.get("Body"), /012345/);
    assert.match(request.body.get("Body"), /10 minutes/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
