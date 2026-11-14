import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  isValidWhatsAppWebhookSignature,
  normalizeWhatsAppPhone,
  sendDeliveryNotification,
  sendOrderConfirmation
} from "./whatsapp.js";

test("normalizes local and international WhatsApp numbers", () => {
  assert.equal(normalizeWhatsAppPhone("+91 98765-43210"), "919876543210");
  assert.equal(normalizeWhatsAppPhone("09876543210"), "919876543210");
  assert.equal(normalizeWhatsAppPhone("0044 7700 900123"), "447700900123");
  assert.equal(normalizeWhatsAppPhone("123"), null);
});

test("validates Meta webhook signatures", () => {
  const secret = "test-app-secret";
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(isValidWhatsAppWebhookSignature(body, signature, secret), true);
  assert.equal(isValidWhatsAppWebhookSignature(body, signature, "wrong-secret"), false);
  assert.equal(isValidWhatsAppWebhookSignature(body, "sha256=invalid", secret), false);
  assert.equal(isValidWhatsAppWebhookSignature(body, signature, ""), false);
});

test("sends approved templates through the Cloud API using backend credentials", async () => {
  const keys = [
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_API_VERSION",
    "WHATSAPP_TEMPLATE_LANGUAGE",
    "WHATSAPP_ORDER_CONFIRMATION_TEMPLATE",
    "WHATSAPP_DELIVERY_TEMPLATE"
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const requests = [];
  Object.assign(process.env, {
    WHATSAPP_PHONE_NUMBER_ID: "phone-id",
    WHATSAPP_ACCESS_TOKEN: "server-token",
    WHATSAPP_API_VERSION: "v22.0",
    WHATSAPP_TEMPLATE_LANGUAGE: "en_US",
    WHATSAPP_ORDER_CONFIRMATION_TEMPLATE: "order_confirmation",
    WHATSAPP_DELIVERY_TEMPLATE: "delivery_notification"
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true };
  };

  try {
    const order = {
      _id: "1234567890abcdef12345678",
      total: 45.5,
      deliveryAddress: { phone: "+91 9876543210", recipient: "Fresh Customer" }
    };
    await sendOrderConfirmation(order);
    await sendDeliveryNotification(order);

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://graph.facebook.com/v22.0/phone-id/messages");
    assert.equal(requests[0].options.headers.Authorization, "Bearer server-token");
    assert.equal(requests[0].body.to, "919876543210");
    assert.equal(requests[0].body.template.name, "order_confirmation");
    assert.deepEqual(requests[0].body.template.components[0].parameters.map(({ text }) => text), [
      "Fresh Customer", "12345678", "INR 45.50"
    ]);
    assert.equal(requests[1].body.template.name, "delivery_notification");
    assert.equal(requests[1].body.template.components[0].parameters.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
