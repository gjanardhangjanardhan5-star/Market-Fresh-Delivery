import { createHmac, timingSafeEqual } from "node:crypto";

const defaultCountryCode = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91";

export function normalizeWhatsAppPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `${defaultCountryCode}${digits}`;
  else if (digits.startsWith("0") && digits.length >= 11) digits = `${defaultCountryCode}${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function isValidWhatsAppWebhookSignature(rawBody, signature, appSecret = process.env.WHATSAPP_APP_SECRET) {
  if (!appSecret || typeof signature !== "string" || !/^sha256=[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function sendTemplate({ phone, templateName, parameters }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const missing = [
    !phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
    !accessToken && "WHATSAPP_ACCESS_TOKEN"
  ].filter(Boolean);
  if (missing.length) return { ok: false, reason: `Missing ${missing.join(" and ")}.` };

  const recipient = normalizeWhatsAppPhone(phone);
  if (!recipient) return { ok: false, reason: "The order delivery phone number is not a valid WhatsApp number." };

  const apiVersion = process.env.WHATSAPP_API_VERSION || "v22.0";
  if (!/^v\d+\.\d+$/.test(apiVersion)) return { ok: false, reason: "WHATSAPP_API_VERSION must look like v22.0." };

  try {
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" },
          components: [{
            type: "body",
            parameters: parameters.map((text) => ({ type: "text", text: String(text) }))
          }]
        }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      let detail = "";
      try {
        const payload = await response.json();
        detail = payload?.error?.message || "";
      } catch {
        detail = "";
      }
      return { ok: false, reason: detail || `WhatsApp API returned HTTP ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "TimeoutError" ? "WhatsApp API request timed out." : "WhatsApp API request failed."
    };
  }
}

async function sendOrderNotification(order, type, templateName, parameters) {
  const result = await sendTemplate({ phone: order.deliveryAddress?.phone, templateName, parameters });
  if (!result.ok) {
    console.error("WhatsApp order notification was not sent.", {
      type,
      orderId: String(order._id),
      reason: result.reason
    });
  }
}

export function sendOrderConfirmation(order) {
  return sendOrderNotification(
    order,
    "order_confirmation",
    process.env.WHATSAPP_ORDER_CONFIRMATION_TEMPLATE || "order_confirmation",
    [
      order.deliveryAddress?.recipient || "Customer",
      String(order._id).slice(-8).toUpperCase(),
      `INR ${Number(order.total).toFixed(2)}`
    ]
  );
}

export function sendDeliveryNotification(order) {
  return sendOrderNotification(
    order,
    "delivery_notification",
    process.env.WHATSAPP_DELIVERY_TEMPLATE || "delivery_notification",
    [
      order.deliveryAddress?.recipient || "Customer",
      String(order._id).slice(-8).toUpperCase()
    ]
  );
}

export function sendOrderStatusNotification(order, status) {
  const labels = {
    confirmed: "Order confirmed",
    packed: "Order packed",
    out_for_delivery: "Out for delivery"
  };
  if (!labels[status]) throw new Error(`Unsupported order notification status: ${status}`);
  return sendOrderNotification(
    order,
    `order_${status}`,
    process.env.WHATSAPP_ORDER_STATUS_TEMPLATE || "order_status_update",
    [
      order.deliveryAddress?.recipient || "Customer",
      String(order._id).slice(-8).toUpperCase(),
      labels[status]
    ]
  );
}
