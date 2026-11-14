import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import { z } from "zod";
import { Admin, Address, Cart, Category, DeliveryPerson, Order, Payment, Product, Setting, SupportMessage, User } from "./models.js";
import { runShoppingAssistant } from "./shoppingAssistant.js";
import { isValidWhatsAppWebhookSignature, sendDeliveryNotification, sendOrderConfirmation, sendOrderStatusNotification } from "./whatsapp.js";
import {
  generateDeliveryOtp,
  hashDeliveryOtp,
  matchesDeliveryOtp,
  otpLifetimeMs,
  sendDeliveryOtpSms
} from "./deliveryOtp.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set to at least 32 characters.");
}
if (process.env.OTP_HASH_SECRET && process.env.OTP_HASH_SECRET.length < 32) {
  throw new Error("OTP_HASH_SECRET must be at least 32 characters.");
}

app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res, next) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ message: "Online payment is not configured." });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return res.status(400).json({ message: `Webhook signature verification failed: ${error.message}` });
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const payment = await Payment.findOneAndUpdate(
        { providerSessionId: session.id, status: "pending" },
        { status: "paid" },
        { new: true }
      );
      if (payment) await Order.findByIdAndUpdate(payment.order, { paymentStatus: "paid" });
    }
    res.json({ received: true });
  } catch (error) { next(error); }
});

app.get("/api/webhooks/whatsapp", (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (!verifyToken) return res.status(503).send("WhatsApp webhook verification is not configured.");
  if (mode !== "subscribe" || typeof token !== "string" || token !== verifyToken || typeof challenge !== "string") {
    return res.sendStatus(403);
  }
  res.type("text/plain").send(challenge);
});
app.post("/api/webhooks/whatsapp", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ message: "Expected a JSON webhook payload." });
  if (!process.env.WHATSAPP_APP_SECRET) return res.status(503).json({ message: "WhatsApp webhook signature verification is not configured." });
  if (!isValidWhatsAppWebhookSignature(req.body, req.get("x-hub-signature-256"))) {
    return res.status(401).json({ message: "WhatsApp webhook signature verification failed." });
  }
  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ message: "Invalid WhatsApp webhook JSON." });
  }
  if (event?.object !== "whatsapp_business_account" || !Array.isArray(event.entry)) {
    return res.status(400).json({ message: "Invalid WhatsApp webhook event." });
  }
  res.json({ received: true });
});

app.use(helmet());
app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
const assistantRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });
const deliveryOtpVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many delivery verification attempts. Please wait before trying again." }
});
const deliveryOtpResendRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many delivery code requests. Please wait before requesting another code." }
});

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === "true",
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000
});
const tokenFor = (id, role, version) => jwt.sign({ sub: id, role, ...(version === undefined ? {} : { version }) }, process.env.JWT_SECRET, { expiresIn: "7d" });
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
app.post("/api/assistant/chat", assistantRateLimit, asyncRoute(async (req, res) => {
  const { message, confirmationToken } = z.object({
    message: z.string().trim().min(1).max(1000),
    confirmationToken: z.string().min(1).max(3000).optional()
  }).parse(req.body);
  let userId = null;
  const token = req.cookies.market_fresh;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role === "user") userId = decoded.sub;
    } catch {
      userId = null;
    }
  }
  res.json(await runShoppingAssistant({
    message,
    userId,
    confirmationToken,
    secret: process.env.JWT_SECRET
  }));
}));
const auth = (role = "user") => asyncRoute(async (req, res, next) => {
  const token = req.cookies.market_fresh;
  if (!token) return res.status(401).json({ message: "Please sign in to continue." });
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ message: "Your session has expired. Please sign in again." }); }
  if (decoded.role !== role) return res.status(403).json({ message: "You do not have permission to do that." });
  if (role === "delivery") {
    const person = await DeliveryPerson.findOne({ _id: decoded.sub, active: true }).select("authVersion");
    if (!person || (decoded.version ?? 0) !== person.authVersion) {
      return res.status(401).json({ message: "This delivery account is inactive or its password has changed. Sign in again." });
    }
  }
  req.identity = { id: decoded.sub, role: decoded.role };
  next();
});
const sendUser = (res, user, role) => {
  res.cookie("market_fresh", tokenFor(user.id, role, role === "delivery" ? user.authVersion : undefined), cookieOptions())
    .json({ user: { id: user.id, name: user.name, email: user.email, ...(user.phone ? { phone: user.phone } : {}), role } });
};
const idParam = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID.");
const positiveQuantity = z.number().finite().min(0.1).max(100);
const marketCategoryNames = { fruits: "Fruits", vegetables: "Vegetables", groceries: "Groceries" };
const marketCategorySlugs = Object.keys(marketCategoryNames);
const cleanProduct = z.object({
  name: z.string().trim().min(2).max(140),
  description: z.string().max(3000).optional().default(""),
  category: z.string().regex(/^[a-f\d]{24}$/i),
  price: z.number().finite().min(0),
  unit: z.string().trim().min(1).max(20).optional().default("kg"),
  image: z.string().url().or(z.literal("")).optional().default(""),
  stockQuantity: z.number().finite().int().min(0).max(100000).nullable().optional(),
  inStock: z.boolean().optional().default(true),
  featured: z.boolean().optional().default(false)
});
const getMarketCategory = (id) => Category.findOne({ _id: id, slug: { $in: marketCategorySlugs } });
const getMarketCategoryIds = async () => (await Category.find({ slug: { $in: marketCategorySlugs } }).select("_id")).map((category) => category._id);
const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const getServiceRate = async () => {
  const setting = await Setting.findOne({ key: "serviceChargePercent" });
  return Number(setting?.value ?? process.env.SERVICE_CHARGE_PERCENT ?? 5);
};
const expandOrder = (order) => Order.findById(order._id).populate("user", "name email phone").populate("deliveryPerson", "name email phone active");
const privateOrderSelect = "+deliveryOtpHash +deliveryOtpExpiresAt +deliveryOtpAttempts +deliveryOtpSentAt +deliveryOtpResends";
const adminOrderView = (order) => {
  const result = order.toJSON();
  const expired = order.deliveryOtpExpiresAt && order.deliveryOtpExpiresAt <= new Date();
  const events = order.deliveryEvents || [];
  const failedOtpAttempts = events.filter((event) => event.type === "otp_invalid").length;
  const lastOtpEvent = [...events].reverse().find((event) => event.type.startsWith("otp_"));
  result.deliveryVerification = {
    status: order.deliveredAt ? "verified" : order.deliveryOtpHash ? (expired ? "expired" : "pending") : lastOtpEvent?.type === "otp_expired" ? "expired" : (order.deliveryOtpAttempts || 0) >= 5 ? "locked" : "not_sent",
    failedAttempts: failedOtpAttempts,
    resendCount: order.deliveryOtpResends || 0,
    expiresAt: order.deliveryOtpExpiresAt || null,
    verifiedAt: order.deliveryOtpVerifiedAt || null,
    deliveredAt: order.deliveredAt || null,
    deliveredBy: order.deliveredBy || null,
    events
  };
  return result;
};
const customerPhoneForOrder = async (order) => (await User.findById(order.user).select("phone"))?.phone;

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/store/config", asyncRoute(async (_req, res) => res.json({
  serviceChargePercent: await getServiceRate(),
  onlinePaymentsEnabled: Boolean(stripe)
})));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const data = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(7).max(30),
    password: z.string().min(8).max(128)
  }).parse(req.body);
  if (await User.exists({ email: data.email.toLowerCase() })) return res.status(409).json({ message: "An account with that email already exists." });
  const user = await User.create(data);
  sendUser(res, user, "user");
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).parse(req.body);
  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (!user || !(await user.checkPassword(password))) return res.status(401).json({ message: "Email or password is incorrect." });
  sendUser(res, user, "user");
}));
app.post("/api/auth/admin/login", asyncRoute(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).parse(req.body);
  const admin = await Admin.findOne({ email: email.toLowerCase() }).select("+password");
  if (!admin || !(await admin.checkPassword(password))) return res.status(401).json({ message: "Admin email or password is incorrect." });
  sendUser(res, admin, "admin");
}));
app.post("/api/auth/delivery/login", asyncRoute(async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).parse(req.body);
  const deliveryPerson = await DeliveryPerson.findOne({ email: email.toLowerCase(), active: true }).select("+password");
  if (!deliveryPerson || !(await deliveryPerson.checkPassword(password))) {
    return res.status(401).json({ message: "Delivery email or password is incorrect." });
  }
  sendUser(res, deliveryPerson, "delivery");
}));
app.get("/api/auth/me", asyncRoute(async (req, res) => {
  const token = req.cookies.market_fresh;
  if (!token) return res.json({ user: null });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const Model = decoded.role === "admin" ? Admin : decoded.role === "delivery" ? DeliveryPerson : User;
    const user = await Model.findOne({ _id: decoded.sub, ...(decoded.role === "delivery" ? { active: true } : {}) }).select("name email phone authVersion");
    if (decoded.role === "delivery" && user && (decoded.version ?? 0) !== user.authVersion) return res.json({ user: null });
    return res.json({ user: user ? { id: user.id, name: user.name, email: user.email, ...(user.phone ? { phone: user.phone } : {}), role: decoded.role } : null });
  } catch { return res.json({ user: null }); }
}));
app.post("/api/auth/logout", (_req, res) => res.clearCookie("market_fresh", { ...cookieOptions(), maxAge: undefined }).json({ ok: true }));

app.get("/api/categories", asyncRoute(async (_req, res) => res.json(await Category.find({ slug: { $in: marketCategorySlugs } }).sort("name"))));
app.post("/api/categories", auth("admin"), asyncRoute(async (req, res) => {
  res.status(409).json({ message: "Only the Fruits, Vegetables, and Groceries categories are supported." });
}));
app.put("/api/categories/:id", auth("admin"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const data = z.object({
    name: z.enum(["Fruits", "Vegetables", "Groceries"]),
    slug: z.enum(marketCategorySlugs),
    description: z.string().max(500).optional().default(""),
    image: z.string().url().or(z.literal("")).optional().default("")
  }).parse(req.body);
  if (marketCategoryNames[data.slug] !== data.name) return res.status(400).json({ message: "Category names and slugs must remain Fruits, Vegetables, or Groceries." });
  const category = await Category.findOneAndUpdate(
    { _id: req.params.id, slug: data.slug, name: data.name },
    { description: data.description, image: data.image },
    { new: true, runValidators: true }
  );
  if (!category) return res.status(404).json({ message: "Category not found." });
  res.json(category);
}));
app.delete("/api/categories/:id", auth("admin"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  return res.status(409).json({ message: "The Fruits, Vegetables, and Groceries categories are required and cannot be deleted." });
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  const filter = { category: { $in: await getMarketCategoryIds() } };
  if (req.query.category) {
    const categorySlug = String(req.query.category);
    if (!marketCategorySlugs.includes(categorySlug)) return res.json([]);
    const category = await Category.findOne({ slug: categorySlug });
    if (!category) return res.json([]);
    filter.category = category._id;
  }
  if (req.query.search) filter.name = { $regex: String(req.query.search).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (req.query.featured === "true") filter.featured = true;
  if (req.query.inStock !== "false") filter.inStock = true;
  const products = await Product.find(filter).populate("category", "name slug").sort({ featured: -1, name: 1 }).limit(100);
  res.json(products);
}));
app.get("/api/products/:id", asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const product = await Product.findById(req.params.id).populate("category", "name slug").populate("reviews.user", "name");
  if (!product || !marketCategorySlugs.includes(product.category?.slug)) return res.status(404).json({ message: "Product not found." });
  res.json(product);
}));
app.post("/api/products", auth("admin"), asyncRoute(async (req, res) => {
  const data = cleanProduct.parse(req.body);
  if (!(await getMarketCategory(data.category))) return res.status(400).json({ message: "Choose Fruits, Vegetables, or Groceries as the product category." });
  if (data.stockQuantity === 0) data.inStock = false;
  res.status(201).json(await (await Product.create(data)).populate("category", "name slug"));
}));
app.put("/api/products/:id", auth("admin"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const data = cleanProduct.parse(req.body);
  if (!(await getMarketCategory(data.category))) return res.status(400).json({ message: "Choose Fruits, Vegetables, or Groceries as the product category." });
  if (data.stockQuantity === 0) data.inStock = false;
  const product = await Product.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true }).populate("category", "name slug");
  if (!product) return res.status(404).json({ message: "Product not found." });
  res.json(product);
}));
app.delete("/api/products/:id", auth("admin"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const product = await Product.findById(req.params.id).populate("category", "slug");
  if (!product || !marketCategorySlugs.includes(product.category?.slug)) return res.status(404).json({ message: "Product not found." });
  await product.deleteOne();
  await Cart.updateMany({}, { $pull: { items: { product: req.params.id } } });
  res.json({ ok: true });
}));
app.post("/api/products/:id/reviews", auth("user"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const data = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(600).optional().default("") }).parse(req.body);
  const purchased = await Order.exists({ user: req.identity.id, "items.product": req.params.id, status: "delivered" });
  if (!purchased) return res.status(403).json({ message: "Reviews are available after a delivered order containing this product." });
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: "Product not found." });
  if (product.reviews.some((review) => String(review.user) === req.identity.id)) return res.status(409).json({ message: "You have already reviewed this product." });
  const user = await User.findById(req.identity.id);
  product.reviews.push({ ...data, user: user._id, name: user.name });
  await product.save();
  res.status(201).json(product.reviews.at(-1));
}));

const cartForUser = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  await cart.populate("items.product", "name price unit image inStock");
  cart.items = cart.items.filter((item) => item.product);
  return cart;
};
app.get("/api/cart", auth("user"), asyncRoute(async (req, res) => res.json(await cartForUser(req.identity.id))));
app.post("/api/cart/items", auth("user"), asyncRoute(async (req, res) => {
  const { productId, quantity } = z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i), quantity: positiveQuantity }).parse(req.body);
  const product = await Product.findOne({ _id: productId, inStock: true });
  if (!product) return res.status(404).json({ message: "That product is currently unavailable." });
  let cart = await Cart.findOne({ user: req.identity.id });
  if (!cart) cart = await Cart.create({ user: req.identity.id, items: [] });
  const item = cart.items.find((entry) => String(entry.product) === productId);
  if (item) {
    if (item.quantity + quantity > 100) return res.status(400).json({ message: "The maximum quantity per product is 100." });
    item.quantity += quantity;
  } else cart.items.push({ product: productId, quantity });
  await cart.save();
  res.json(await cartForUser(req.identity.id));
}));
app.patch("/api/cart/items/:productId", auth("user"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.productId);
  const { quantity } = z.object({ quantity: positiveQuantity }).parse(req.body);
  const cart = await Cart.findOneAndUpdate({ user: req.identity.id, "items.product": req.params.productId }, { $set: { "items.$.quantity": quantity } }, { new: true });
  if (!cart) return res.status(404).json({ message: "Item not found in your cart." });
  res.json(await cartForUser(req.identity.id));
}));
app.delete("/api/cart/items/:productId", auth("user"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.productId);
  await Cart.updateOne({ user: req.identity.id }, { $pull: { items: { product: req.params.productId } } });
  res.json(await cartForUser(req.identity.id));
}));

app.get("/api/addresses", auth("user"), asyncRoute(async (req, res) => res.json(await Address.find({ user: req.identity.id }).sort("-createdAt"))));
app.post("/api/addresses", auth("user"), asyncRoute(async (req, res) => {
  const data = z.object({
    label: z.string().trim().max(40).optional().default("Home"),
    recipient: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(7).max(30),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(20),
    notes: z.string().trim().max(500).optional().default("")
  }).parse(req.body);
  res.status(201).json(await Address.create({ ...data, user: req.identity.id }));
}));
app.delete("/api/addresses/:id", auth("user"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const address = await Address.findOneAndDelete({ _id: req.params.id, user: req.identity.id });
  if (!address) return res.status(404).json({ message: "Address not found." });
  res.json({ ok: true });
}));

app.post("/api/orders", auth("user"), asyncRoute(async (req, res) => {
  const { addressId, paymentMethod } = z.object({ addressId: z.string().regex(/^[a-f\d]{24}$/i), paymentMethod: z.enum(["cod", "stripe"]) }).parse(req.body);
  if (paymentMethod === "stripe" && !stripe) return res.status(503).json({ message: "Online payment is not configured yet. Choose cash on delivery or contact the store." });
  const address = await Address.findOne({ _id: addressId, user: req.identity.id });
  if (!address) return res.status(404).json({ message: "Choose a valid delivery address." });
  const cart = await Cart.findOne({ user: req.identity.id }).populate("items.product");
  if (!cart?.items.length) return res.status(400).json({ message: "Your cart is empty." });
  const items = cart.items.map(({ product, quantity }) => {
    if (!product || !product.inStock) throw Object.assign(new Error("A cart item is no longer available. Please refresh your cart."), { status: 409 });
    return { product: product._id, name: product.name, image: product.image, unit: product.unit, quantity, estimatedUnitPrice: product.price, lineTotal: roundMoney(product.price * quantity) };
  });
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const serviceCharge = roundMoney(subtotal * (await getServiceRate()) / 100);
  const deliveryCharge = 0;
  const order = await Order.create({
    user: req.identity.id, address: address._id,
    deliveryAddress: { label: address.label, recipient: address.recipient, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode, notes: address.notes },
    items, subtotal, serviceCharge, deliveryCharge, total: roundMoney(subtotal + serviceCharge + deliveryCharge),
    paymentMethod, notes: address.notes
  });
  await Payment.create({ order: order._id, user: req.identity.id, provider: paymentMethod, amount: order.total, currency: process.env.STRIPE_CURRENCY || "inr" });
  await Cart.updateOne({ user: req.identity.id }, { $set: { items: [] } });
  await sendOrderConfirmation(order);
  res.status(201).json(order);
}));
app.get("/api/orders", auth("user"), asyncRoute(async (req, res) => res.json(
  await Order.find({ user: req.identity.id }).populate("deliveredBy", "name").sort("-createdAt")
)));
app.get("/api/orders/:id", auth("user"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const order = await Order.findOne({ _id: req.params.id, user: req.identity.id }).populate("deliveredBy", "name");
  if (!order) return res.status(404).json({ message: "Order not found." });
  res.json(order);
}));
app.post("/api/orders/:id/price-approval", auth("user"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
  const order = await Order.findOne({ _id: req.params.id, user: req.identity.id });
  if (!order || order.priceApproval !== "pending") return res.status(409).json({ message: "This order has no price update waiting for approval." });
  if (approve) {
    order.priceApproval = "approved";
    order.status = "quality_check";
    order.subtotal = roundMoney(order.items.reduce((sum, item) => sum + item.lineTotal, 0));
    order.serviceCharge = roundMoney(order.subtotal * (await getServiceRate()) / 100);
    order.total = roundMoney(order.subtotal + order.serviceCharge + order.deliveryCharge);
    await Payment.updateMany({ order: order._id, status: "pending" }, { amount: order.total });
  } else {
    order.priceApproval = "rejected";
    order.status = "cancelled";
  }
  await order.save();
  res.json(order);
}));
app.post("/api/orders/:id/cancel", auth("user"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const order = await Order.findOne({ _id: req.params.id, user: req.identity.id });
  if (!order) return res.status(404).json({ message: "Order not found." });
  if (order.paymentStatus === "paid") return res.status(409).json({ message: "This order has already been paid. Please contact support for help." });
  if (!["placed", "confirmed", "purchasing", "quality_check"].includes(order.status) || order.priceApproval === "pending") return res.status(409).json({ message: "This order can no longer be cancelled online. Please contact support." });
  order.status = "cancelled";
  await order.save();
  res.json(order);
}));

app.post("/api/payments/checkout/:orderId", auth("user"), asyncRoute(async (req, res) => {
  if (!stripe) return res.status(503).json({ message: "Online payment is not configured." });
  idParam.parse(req.params.orderId);
  const order = await Order.findOne({ _id: req.params.orderId, user: req.identity.id });
  if (!order) return res.status(404).json({ message: "Order not found." });
  if (order.paymentMethod !== "stripe" || order.paymentStatus === "paid" || !["packed", "out_for_delivery"].includes(order.status) || order.priceApproval === "pending" || order.priceApproval === "rejected") {
    return res.status(409).json({ message: "This order is not ready for online payment." });
  }
  const payment = await Payment.findOne({ order: order._id, provider: "stripe" });
  if (!payment || payment.status !== "pending") return res.status(409).json({ message: "Payment is not available for this order." });
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: payment.currency,
        unit_amount: Math.round(order.total * 100),
        product_data: { name: `Market Fresh order ${order.id.slice(-8)}`, description: `${order.items.length} fresh-market item(s), including service charge` }
      }
    }],
    success_url: `${clientUrl}/orders/${order.id}?payment=success`,
    cancel_url: `${clientUrl}/orders/${order.id}?payment=cancelled`,
    metadata: { orderId: String(order._id), paymentId: String(payment._id) }
  });
  payment.providerSessionId = session.id;
  await payment.save();
  res.json({ url: session.url });
}));

app.post("/api/contact", asyncRoute(async (req, res) => {
  const data = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email().max(254), subject: z.string().trim().min(3).max(140), message: z.string().trim().min(10).max(3000) }).parse(req.body);
  await SupportMessage.create(data);
  res.status(201).json({ message: "Thanks for reaching out. Our team will be in touch shortly." });
}));

app.get("/api/admin/summary", auth("admin"), asyncRoute(async (_req, res) => {
  const [customers, orders, delivered, pending, revenue, feePercent, messages] = await Promise.all([
    User.countDocuments(), Order.countDocuments(), Order.countDocuments({ status: "delivered" }),
    Order.countDocuments({ status: { $nin: ["delivered", "cancelled"] } }),
    Order.aggregate([{ $match: { paymentStatus: "paid", status: { $ne: "cancelled" } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    getServiceRate(), SupportMessage.countDocuments()
  ]);
  res.json({ customers, orders, delivered, pending, revenue: revenue[0]?.total || 0, feePercent, messages });
}));
app.get("/api/admin/customers", auth("admin"), asyncRoute(async (_req, res) => res.json(await User.find().select("name email phone createdAt").sort("-createdAt").limit(200))));
app.get("/api/admin/delivery-personnel", auth("admin"), asyncRoute(async (_req, res) => res.json(
  await DeliveryPerson.find().select("name email phone active createdAt").sort("name")
)));
app.post("/api/admin/delivery-personnel", auth("admin"), asyncRoute(async (req, res) => {
  const data = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(7).max(30),
    password: z.string().min(8).max(128)
  }).parse(req.body);
  const person = await DeliveryPerson.create({ ...data, email: data.email.toLowerCase() });
  res.status(201).json({ id: person.id, name: person.name, email: person.email, phone: person.phone, active: person.active, createdAt: person.createdAt });
}));
app.patch("/api/admin/delivery-personnel/:id", auth("admin"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const data = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.string().trim().min(7).max(30).optional(),
    password: z.string().min(8).max(128).optional(),
    active: z.boolean().optional()
  }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.").parse(req.body);
  const person = await DeliveryPerson.findById(req.params.id).select("+password");
  if (!person) return res.status(404).json({ message: "Delivery person not found." });
  if (data.active === false && person.active && await Order.exists({ deliveryPerson: person._id, status: "out_for_delivery" })) {
    return res.status(409).json({ message: "Reassign or complete this delivery person's active orders before deactivating the account." });
  }
  Object.assign(person, data);
  if (data.password || data.active === false) person.authVersion += 1;
  await person.save();
  res.json({ id: person.id, name: person.name, email: person.email, phone: person.phone, active: person.active, createdAt: person.createdAt });
}));
app.get("/api/admin/orders", auth("admin"), asyncRoute(async (_req, res) => {
  const orders = await Order.find().select(privateOrderSelect).populate("user", "name email phone").populate("deliveryPerson", "name email phone active").populate("deliveredBy", "name").sort("-createdAt").limit(300);
  res.json(orders.map(adminOrderView));
}));
app.patch("/api/admin/orders/:id", auth("admin"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const data = z.object({
    status: z.enum(["placed", "confirmed", "purchasing", "quality_check", "packed", "out_for_delivery", "delivered", "cancelled"]).optional(),
    assignedTo: z.string().trim().max(100).optional(),
    deliveryPersonId: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional(),
    prices: z.array(z.object({ product: z.string().regex(/^[a-f\d]{24}$/i), actualUnitPrice: z.number().finite().min(0) })).optional()
  }).parse(req.body);
  const order = await Order.findById(req.params.id).select(privateOrderSelect);
  if (!order) return res.status(404).json({ message: "Order not found." });
  const previousStatus = order.status;
  if (data.status === "delivered") {
    return res.status(409).json({ message: "Enter the customer's delivery code to mark this order delivered." });
  }
  if (data.prices) {
    if (!["purchasing", "quality_check"].includes(order.status) || order.paymentStatus === "paid") {
      return res.status(409).json({ message: "Market prices cannot be changed after this order has moved to packing or has been paid." });
    }
    let hasPriceChange = false;
    for (const price of data.prices) {
      const item = order.items.find((candidate) => String(candidate.product) === price.product);
      if (!item) return res.status(400).json({ message: "A price update references an item outside this order." });
      if (Number(item.actualUnitPrice ?? item.estimatedUnitPrice) !== price.actualUnitPrice) hasPriceChange = true;
      item.actualUnitPrice = price.actualUnitPrice;
      item.lineTotal = roundMoney(price.actualUnitPrice * item.quantity);
    }
    order.subtotal = roundMoney(order.items.reduce((sum, item) => sum + item.lineTotal, 0));
    order.serviceCharge = roundMoney(order.subtotal * (await getServiceRate()) / 100);
    order.total = roundMoney(order.subtotal + order.serviceCharge + order.deliveryCharge);
    order.priceApproval = hasPriceChange ? "pending" : "not_required";
    order.priceUpdatedAt = new Date();
    order.status = "quality_check";
    await Payment.updateMany({ order: order._id, status: "pending" }, { amount: order.total });
  }
  if (data.deliveryPersonId !== undefined && String(order.deliveryPerson || "") !== String(data.deliveryPersonId || "")) {
    if (order.status === "delivered" || (order.status === "out_for_delivery" && order.deliveryPerson)) {
      return res.status(409).json({ message: "A delivery person cannot be changed after delivery has started." });
    }
    const person = data.deliveryPersonId
      ? await DeliveryPerson.findOne({ _id: data.deliveryPersonId, active: true }).select("name")
      : null;
    if (data.deliveryPersonId && !person) return res.status(400).json({ message: "Choose an active delivery person." });
    order.deliveryPerson = person?._id || null;
    order.deliveryEvents.push({
      type: "assigned",
      actor: req.identity.id,
      actorRole: "admin",
      note: person ? `Assigned to ${person.name}.` : "Delivery person assignment cleared."
    });
  }
  if (data.assignedTo !== undefined) order.assignedTo = data.assignedTo;
  if (data.status) {
    if (order.priceApproval === "pending" && data.status !== "cancelled") return res.status(409).json({ message: "Wait for the customer to approve the updated prices." });
    if (data.status === "cancelled" && order.paymentStatus === "paid") return res.status(409).json({ message: "This order has already been paid. Contact the customer to arrange a refund before cancelling." });
    const transitions = {
      placed: ["confirmed", "cancelled"],
      confirmed: ["purchasing", "cancelled"],
      purchasing: ["quality_check", "cancelled"],
      quality_check: ["packed", "cancelled"],
      packed: ["out_for_delivery", "cancelled"],
      out_for_delivery: ["delivered"],
      delivered: [],
      cancelled: []
    };
    if (data.status !== order.status && !transitions[order.status].includes(data.status)) {
      return res.status(409).json({ message: `Order status cannot move from ${order.status.replaceAll("_", " ")} to ${data.status.replaceAll("_", " ")}.` });
    }
    if (data.status === "out_for_delivery") {
      if (!order.deliveryPerson || !(await DeliveryPerson.exists({ _id: order.deliveryPerson, active: true }))) {
        return res.status(409).json({ message: "Assign an active delivery person before dispatching this order." });
      }
      if (order.paymentMethod === "stripe" && order.paymentStatus !== "paid") {
        return res.status(409).json({ message: "Collect the online payment before dispatching this order." });
      }
    }
    order.status = data.status;
    if (previousStatus !== "out_for_delivery" && data.status === "out_for_delivery") {
      order.deliveryProgress = "assigned";
      const deliveryOtp = generateDeliveryOtp();
      order.deliveryOtpHash = hashDeliveryOtp(deliveryOtp, String(order._id));
      order.deliveryOtpExpiresAt = new Date(Date.now() + otpLifetimeMs);
      order.deliveryOtpAttempts = 0;
      order.deliveryOtpSentAt = new Date();
      order.deliveryOtpResends = 0;
      await order.save();

      const result = await sendDeliveryOtpSms({
        phone: await customerPhoneForOrder(order),
        otp: deliveryOtp,
        orderId: String(order._id)
      });
      if (!result.ok) {
        order.status = previousStatus;
        order.deliveryOtpHash = null;
        order.deliveryOtpExpiresAt = null;
        order.deliveryOtpAttempts = 0;
        order.deliveryOtpSentAt = null;
        order.deliveryOtpResends = 0;
        order.deliveryProgress = null;
        await order.save();
        console.error("Delivery OTP SMS was not sent.", { orderId: String(order._id), reason: result.reason });
        return res.status(503).json({ message: "The delivery code could not be sent. The order remains packed; please try again." });
      }
      order.deliveryEvents.push({ type: "otp_sent", actor: req.identity.id, actorRole: "system" });
      await order.save();
    } else {
      await order.save();
    }
  } else {
    await order.save();
  }
  if (data.status && ["confirmed", "packed", "out_for_delivery"].includes(data.status) && data.status !== previousStatus) {
    await sendOrderStatusNotification(await expandOrder(order), data.status);
  }
  const updatedOrder = await Order.findById(order._id).select(privateOrderSelect).populate("user", "name email phone").populate("deliveryPerson", "name email phone active").populate("deliveredBy", "name");
  res.json(adminOrderView(updatedOrder));
}));
app.get("/api/delivery/orders", auth("delivery"), asyncRoute(async (req, res) => {
  const orders = await Order.find({
    deliveryPerson: req.identity.id,
    status: { $in: ["out_for_delivery", "delivered"] }
  }).populate("user", "name phone").populate("deliveryPerson", "name phone").sort("-updatedAt").limit(100);
  res.json(orders);
}));
app.post("/api/delivery/orders/:id/attempt", auth("delivery"), asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const { progress, reason } = z.object({
    progress: z.enum(["arrived", "failed"]),
    reason: z.enum(["customer_unavailable", "address_issue", "customer_rescheduled", "other"]).optional()
  }).refine((value) => value.progress !== "failed" || Boolean(value.reason), "Choose a reason for the failed delivery attempt.").parse(req.body);
  const order = await Order.findOne({
    _id: req.params.id,
    deliveryPerson: req.identity.id,
    status: "out_for_delivery"
  });
  if (!order) return res.status(404).json({ message: "Assigned active delivery order not found." });
  order.deliveryProgress = progress;
  order.deliveryEvents.push({
    type: progress,
    actor: req.identity.id,
    actorRole: "delivery",
    ...(reason ? { note: reason.replaceAll("_", " ") } : {})
  });
  if (order.deliveryEvents.length > 100) order.deliveryEvents = order.deliveryEvents.slice(-100);
  await order.save();
  res.json({ message: progress === "arrived" ? "Arrival recorded. Ask the customer for their delivery code." : "Failed delivery attempt recorded." });
}));
app.post("/api/delivery/orders/:id/deliver", auth("delivery"), deliveryOtpVerifyRateLimit, asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const { otp } = z.object({ otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit delivery code.") }).parse(req.body);
  const order = await Order.findOne({ _id: req.params.id, deliveryPerson: req.identity.id }).select(privateOrderSelect);
  if (!order) return res.status(404).json({ message: "Order not found." });
  if (order.status !== "out_for_delivery") return res.status(409).json({ message: "This order is not out for delivery." });
  if (order.paymentMethod === "stripe" && order.paymentStatus !== "paid") {
    return res.status(409).json({ message: "Online payment must be completed before delivery can be marked delivered." });
  }
  if (order.deliveryProgress !== "arrived") {
    return res.status(409).json({ message: "Record arrival at the customer's address before verifying the delivery code." });
  }
  if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt) {
    return res.status(409).json({ message: "A delivery code is not available. Request a new code." });
  }
  const now = new Date();
  if (order.deliveryOtpExpiresAt <= now) {
    const expired = await Order.updateOne({
      _id: order._id,
      deliveryPerson: req.identity.id,
      status: "out_for_delivery",
      deliveryOtpHash: order.deliveryOtpHash,
      deliveryOtpExpiresAt: { $lte: now }
    }, {
      $set: { deliveryOtpHash: null, deliveryOtpExpiresAt: null },
      $push: { deliveryEvents: { $each: [{ type: "otp_expired", actor: req.identity.id, actorRole: "delivery", createdAt: now }], $slice: -100 } }
    });
    if (!expired.matchedCount) return res.status(409).json({ message: "The delivery code changed. Try the new code." });
    return res.status(410).json({ message: "The delivery code has expired. Request a new code." });
  }
  const currentAttempts = order.deliveryOtpAttempts || 0;
  if (currentAttempts >= 5) {
    return res.status(429).json({ message: "Too many incorrect codes. Request a new code." });
  }

  if (!matchesDeliveryOtp(otp, order.deliveryOtpHash, String(order._id))) {
    const failedOrder = await Order.findOneAndUpdate({
      _id: order._id,
      deliveryPerson: req.identity.id,
      status: "out_for_delivery",
      deliveryOtpHash: order.deliveryOtpHash,
      deliveryOtpAttempts: { $lt: 5 },
      deliveryOtpExpiresAt: { $gt: now }
    }, {
      $inc: { deliveryOtpAttempts: 1 },
      $push: { deliveryEvents: { $each: [{ type: "otp_invalid", actor: req.identity.id, actorRole: "delivery", createdAt: now }], $slice: -100 } }
    }, { new: true }).select("+deliveryOtpAttempts");
    if (!failedOrder) return res.status(409).json({ message: "The delivery code changed or expired. Request a new code." });
    const attempts = failedOrder.deliveryOtpAttempts;
    if (attempts >= 5) {
      await Order.updateOne({
        _id: order._id,
        deliveryPerson: req.identity.id,
        status: "out_for_delivery",
        deliveryOtpHash: order.deliveryOtpHash,
        deliveryOtpAttempts: { $gte: 5 }
      }, { $set: { deliveryOtpHash: null, deliveryOtpExpiresAt: null } });
    }
    return res.status(400).json({
      message: attempts >= 5
        ? "Too many incorrect codes. Request a new code."
        : "That delivery code is incorrect."
    });
  }

  const deliveredOrder = await Order.findOneAndUpdate({
    _id: order._id,
    deliveryPerson: req.identity.id,
    status: "out_for_delivery",
    deliveryOtpHash: order.deliveryOtpHash,
    deliveryOtpAttempts: { $lt: 5 },
    deliveryOtpExpiresAt: { $gt: now }
  }, {
    $set: {
      status: "delivered",
      paymentStatus: order.paymentMethod === "cod" ? "paid" : order.paymentStatus,
      deliveryOtpHash: null,
      deliveryOtpExpiresAt: null,
      deliveryOtpVerifiedAt: now,
      deliveredAt: now,
      deliveredBy: req.identity.id,
      deliveryProgress: "verified"
    },
    $push: { deliveryEvents: { $each: [
      { type: "otp_verified", actor: req.identity.id, actorRole: "delivery", createdAt: now },
      { type: "delivered", actor: req.identity.id, actorRole: "delivery", createdAt: now }
    ], $slice: -100 } }
  }, { new: true, runValidators: true });
  if (!deliveredOrder) return res.status(409).json({ message: "The delivery code changed or expired. Request a new code." });
  if (order.paymentMethod === "cod") {
    await Payment.updateMany({ order: order._id, status: "pending" }, { status: "paid" });
  }
  await sendDeliveryNotification(deliveredOrder);
  res.json(await expandOrder(deliveredOrder));
}));
app.post("/api/delivery/orders/:id/delivery-otp", auth("delivery"), deliveryOtpResendRateLimit, asyncRoute(async (req, res) => {
  idParam.parse(req.params.id);
  const order = await Order.findOne({ _id: req.params.id, deliveryPerson: req.identity.id }).select(privateOrderSelect);
  if (!order) return res.status(404).json({ message: "Order not found." });
  if (order.status !== "out_for_delivery") return res.status(409).json({ message: "This order is not out for delivery." });
  const isInitialDeliveryCode = !order.deliveryOtpSentAt;
  if (!isInitialDeliveryCode && Date.now() - order.deliveryOtpSentAt.getTime() < 60_000) {
    return res.status(429).json({ message: "Wait at least one minute before requesting another delivery code." });
  }
  const resends = order.deliveryOtpResends || 0;
  if (!isInitialDeliveryCode && resends >= 3) {
    return res.status(429).json({ message: "The delivery code resend limit has been reached." });
  }

  const previousOtp = {
    hash: order.deliveryOtpHash,
    expiresAt: order.deliveryOtpExpiresAt,
    attempts: order.deliveryOtpAttempts || 0,
    sentAt: order.deliveryOtpSentAt,
    resends
  };
  const deliveryOtp = generateDeliveryOtp();
  const updatedOtp = {
    hash: hashDeliveryOtp(deliveryOtp, String(order._id)),
    expiresAt: new Date(Date.now() + otpLifetimeMs),
    sentAt: new Date(),
    resends: isInitialDeliveryCode ? 0 : resends + 1
  };
  const currentOtpFilter = {
    _id: order._id,
    deliveryPerson: req.identity.id,
    status: "out_for_delivery",
    deliveryOtpHash: order.deliveryOtpHash ?? null,
    deliveryOtpExpiresAt: order.deliveryOtpExpiresAt ?? null,
    deliveryOtpSentAt: order.deliveryOtpSentAt ?? null,
    $or: [{ deliveryOtpResends: { $lt: 3 } }, { deliveryOtpResends: { $exists: false } }]
  };
  const updatedOrder = await Order.findOneAndUpdate(currentOtpFilter, {
    $set: {
      deliveryOtpHash: updatedOtp.hash,
      deliveryOtpExpiresAt: updatedOtp.expiresAt,
      deliveryOtpAttempts: 0,
      deliveryOtpSentAt: updatedOtp.sentAt,
      deliveryOtpResends: updatedOtp.resends
    }
  }, { new: true });
  if (!updatedOrder) return res.status(409).json({ message: "The delivery code has changed. Refresh the order and try again." });

  const result = await sendDeliveryOtpSms({
    phone: await customerPhoneForOrder(updatedOrder),
    otp: deliveryOtp,
    orderId: String(order._id)
  });
  if (!result.ok) {
    await Order.updateOne({
      _id: order._id,
      status: "out_for_delivery",
      deliveryOtpHash: updatedOtp.hash
    }, {
      $set: {
        deliveryOtpHash: previousOtp.hash ?? null,
        deliveryOtpExpiresAt: previousOtp.expiresAt ?? null,
        deliveryOtpAttempts: previousOtp.attempts,
        deliveryOtpSentAt: previousOtp.sentAt ?? null,
        deliveryOtpResends: previousOtp.resends
      }
    });
    console.error("Delivery OTP SMS was not sent.", { orderId: String(order._id), reason: result.reason });
    return res.status(503).json({ message: "The new delivery code could not be sent. Please try again later." });
  }
  await Order.updateOne({ _id: order._id, deliveryOtpHash: updatedOtp.hash }, {
    $push: { deliveryEvents: { $each: [{
      type: isInitialDeliveryCode ? "otp_sent" : "otp_resent",
      actor: req.identity.id,
      actorRole: "delivery",
      createdAt: new Date()
    }], $slice: -100 } }
  });
  res.json({ message: "A new code was sent to the customer's registered mobile number." });
}));
app.get("/api/admin/products", auth("admin"), asyncRoute(async (_req, res) => res.json(await Product.find({ category: { $in: await getMarketCategoryIds() } }).populate("category", "name slug").sort("-createdAt"))));
app.get("/api/admin/settings", auth("admin"), asyncRoute(async (_req, res) => res.json({ serviceChargePercent: await getServiceRate() })));
app.put("/api/admin/settings", auth("admin"), asyncRoute(async (req, res) => {
  const { serviceChargePercent } = z.object({ serviceChargePercent: z.number().finite().min(0).max(50) }).parse(req.body);
  await Setting.findOneAndUpdate({ key: "serviceChargePercent" }, { value: serviceChargePercent }, { upsert: true, new: true });
  res.json({ serviceChargePercent });
}));
app.get("/api/admin/messages", auth("admin"), asyncRoute(async (_req, res) => res.json(await SupportMessage.find().sort("-createdAt").limit(200))));

app.use((req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` }));
app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") });
  if (error?.code === 11000) return res.status(409).json({ message: "That record already exists." });
  if (error?.name === "CastError") return res.status(400).json({ message: "Invalid record ID." });
  if (["MongooseServerSelectionError", "MongoServerSelectionError", "MongoNetworkError", "MongoNotConnectedError", "MongoPoolClearedError"].includes(error?.name)) {
    console.error("MongoDB is unavailable for this request.");
    return res.status(503).json({ message: "The database is temporarily unavailable. Please try again shortly." });
  }
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ message: status >= 500 ? "Something went wrong. Please try again." : error.message });
});

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/market_fresh");
app.listen(port, () => console.log(`Market Fresh API listening on http://localhost:${port}`));
