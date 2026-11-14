import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

const otpLifetimeMs = 10 * 60 * 1000;
const defaultCountryCode = process.env.SMS_DEFAULT_COUNTRY_CODE || process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91";

export function generateDeliveryOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashDeliveryOtp(otp, orderId, secret = process.env.OTP_HASH_SECRET || process.env.JWT_SECRET) {
  if (!secret || secret.length < 32) throw new Error("OTP_HASH_SECRET or a valid JWT_SECRET is required.");
  return createHmac("sha256", secret).update(`${orderId}:${otp}`).digest("hex");
}

export function matchesDeliveryOtp(otp, expectedHash, orderId, secret) {
  if (typeof expectedHash !== "string" || !/^[a-f\d]{64}$/i.test(expectedHash)) return false;
  const expected = Buffer.from(expectedHash, "hex");
  const supplied = Buffer.from(hashDeliveryOtp(otp, orderId, secret), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function normalizeSmsPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `${defaultCountryCode}${digits}`;
  else if (digits.startsWith("0") && digits.length >= 11) digits = `${defaultCountryCode}${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

export async function sendDeliveryOtpSms({ phone, otp, orderId }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return { ok: false, reason: "Twilio SMS is not configured." };

  const recipient = normalizeSmsPhone(phone);
  if (!recipient) return { ok: false, reason: "The delivery phone number is invalid." };

  const message = `Your Market Fresh delivery code for order ${String(orderId).slice(-8).toUpperCase()} is ${otp}. It expires in 10 minutes. Do not share it.`;
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ To: recipient, From: fromNumber, Body: message }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { ok: false, reason: `Twilio returned HTTP ${response.status}.` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.name === "TimeoutError" ? "Twilio SMS request timed out." : "Twilio SMS request failed." };
  }
}

export { otpLifetimeMs };
