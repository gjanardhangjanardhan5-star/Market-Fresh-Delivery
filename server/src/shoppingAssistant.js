import jwt from "jsonwebtoken";
import { Address, Cart, Category, Order, Payment, Product, Setting } from "./models.js";
import { cleanProductQuery, parseShoppingIntent } from "./assistantIntents.js";
import { sendOrderConfirmation } from "./whatsapp.js";

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const statusNames = {
  placed: "Order Placed",
  confirmed: "Order Confirmed",
  purchasing: "Market Purchasing",
  quality_check: "Quality Checking",
  packed: "Packed",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled"
};
const cartProjection = "name price unit image inStock featured reviews category";

async function serviceRate() {
  const setting = await Setting.findOne({ key: "serviceChargePercent" });
  return Number(setting?.value ?? process.env.SERVICE_CHARGE_PERCENT ?? 5);
}

async function getCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  await cart.populate({ path: "items.product", select: cartProjection, populate: { path: "category", select: "name slug" } });
  cart.items = cart.items.filter((item) => item.product);
  return cart;
}

function cartSummary(cart, rate) {
  const items = cart.items.map((item) => ({
    product: item.product,
    quantity: item.quantity,
    lineTotal: roundMoney(item.product.price * item.quantity)
  }));
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const serviceCharge = roundMoney(subtotal * rate / 100);
  const deliveryCharge = 0;
  return {
    items,
    subtotal,
    serviceCharge,
    deliveryCharge,
    total: roundMoney(subtotal + serviceCharge + deliveryCharge)
  };
}

function formatCart(cart, quote) {
  return {
    items: cart.items.map((item) => ({
      productId: String(item.product._id),
      name: item.product.name,
      image: item.product.image,
      unit: item.product.unit,
      price: item.product.price,
      quantity: item.quantity,
      lineTotal: roundMoney(item.product.price * item.quantity),
      inStock: item.product.inStock
    })),
    subtotal: quote.subtotal,
    serviceCharge: quote.serviceCharge,
    deliveryCharge: quote.deliveryCharge,
    total: quote.total
  };
}

function getCategorySlug(message) {
  if (/\b(?:fruit|fruits)\b/.test(message)) return "fruits";
  if (/\b(?:vegetable|vegetables|veggie|veggies)\b/.test(message)) return "vegetables";
  if (/\b(?:grocery|groceries|pantry)\b/.test(message)) return "groceries";
  return null;
}

function getPriceLimit(message) {
  const match = message.match(/\b(?:under|below|less than|up to|maximum|max|within|budget of)\s*(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : null;
}

function getSearchTerms(message, category, priceLimit) {
  return cleanProductQuery(message)
    .replace(/\b(?:fruit|fruits|vegetable|vegetables|veggie|veggies|grocery|groceries|pantry|product|products|show|me|find|search|browse|recommend|recommendation|suggest|suggestion|best|ideas|something|looking|for|want|under|below|less|than|up|maximum|max|within|budget|price|pricing|cost|available|availability|stock|what|is|are|how|much|do|does|you|have|can|i|get)\b/g, " ")
    .replace(/\b(?:₹|rs)\s*/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedName(value) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

async function matchProducts(query) {
  const terms = cleanProductQuery(query).split(" ").filter(Boolean).map((term) =>
    term.endsWith("oes") ? term.slice(0, -2) : term.endsWith("s") ? term.slice(0, -1) : term
  );
  if (!terms.length) return [];
  const products = await Product.find()
    .select("name price unit image inStock featured category")
    .populate("category", "name slug")
    .sort({ featured: -1, name: 1 })
    .limit(500);
  const ranked = products.map((product) => {
    const name = normalizedName(product.name);
    const matches = terms.filter((term) => name.split(" ").some((word) => word === term || word.startsWith(term)));
    return { product, score: matches.length / terms.length };
  }).filter((entry) => entry.score >= 0.6)
    .sort((a, b) => b.score - a.score || Number(b.product.inStock) - Number(a.product.inStock) || a.product.name.localeCompare(b.product.name));
  return ranked.slice(0, 6).map((entry) => entry.product);
}

function productCards(products) {
  return products.map((product) => ({
    id: String(product._id),
    name: product.name,
    description: product.description || "",
    image: product.image || "",
    price: product.price,
    unit: product.unit,
    inStock: product.inStock,
    category: product.category?.name || ""
  }));
}

async function searchProducts(message, recommendation = false) {
  const category = getCategorySlug(message);
  const priceLimit = getPriceLimit(message);
  const search = getSearchTerms(message, category, priceLimit);
  const filter = {};
  if (category) {
    const categoryRecord = await Category.findOne({ slug: category });
    if (!categoryRecord) return { products: [], message: `I couldn't find the ${category} category in the current catalog.` };
    filter.category = categoryRecord._id;
  }
  if (search) {
    filter.$and = search.split(" ").map((term) => {
      const stem = term.endsWith("oes") ? term.slice(0, -2) : term.endsWith("s") ? term.slice(0, -1) : term;
      return { name: { $regex: `${escapeRegex(stem)}s?`, $options: "i" } };
    });
  }
  if (priceLimit != null) filter.price = { $lte: priceLimit };
  const products = await Product.find(filter).select(cartProjection)
    .populate("category", "name slug")
    .sort({ featured: -1, inStock: -1, price: 1, name: 1 })
    .limit(8);
  if (products.length === 0) {
    const qualifier = priceLimit == null ? "" : ` under ₹${priceLimit}`;
    return {
      products: [],
      message: `I couldn't find a matching product${qualifier} in the current catalog. I won't guess prices or availability. Try another product name or category.`
    };
  }
  const label = recommendation ? "Here are catalog matches for your request" : "Here are the matching products currently in our catalog";
  return {
    products: productCards(products),
    message: `${label}. Prices and stock status below come from the live catalog${priceLimit == null ? "." : ` (within ₹${priceLimit}).`}`
  };
}

function productMatchMessage(matches, action) {
  const description = action === "remove_cart" ? "in your cart" : "in the catalog";
  return {
    message: `I found a few possible matches ${description}. Please choose the exact product.`,
    products: productCards(matches)
  };
}

async function startOrderConfirmation(userId, secret) {
  const address = await Address.findOne({ user: userId }).sort("-createdAt");
  if (!address) {
    return {
      message: "Add a delivery address before placing an order. I can take you to checkout to save one.",
      links: [{ label: "Add a delivery address", href: "/checkout" }]
    };
  }
  const cart = await getCart(userId);
  if (!cart.items.length) return { message: "Your cart is empty. Add a few products before placing an order." };
  const unavailable = cart.items.filter((item) => !item.product.inStock);
  if (unavailable.length) {
    return {
      message: "Some items in your cart are currently marked unavailable. Remove them or check the catalog before placing your order.",
      unavailable: unavailable.map((item) => item.product.name),
      cart: formatCart(cart, cartSummary(cart, await serviceRate()))
    };
  }
  const feePercent = await serviceRate();
  const quote = cartSummary(cart, feePercent);
  const snapshot = quote.items.map((item) => ({
    productId: String(item.product._id),
    quantity: item.quantity,
    price: item.product.price,
    name: item.product.name,
    unit: item.product.unit
  }));
  const confirmationToken = jwt.sign({
    purpose: "shopping-order-confirmation",
    sub: String(userId),
    cartUpdatedAt: cart.updatedAt?.getTime() ?? 0,
    addressId: String(address._id),
    snapshot,
    serviceChargePercent: feePercent,
    total: quote.total
  }, secret, { expiresIn: "10m" });
  return {
    message: "Please review this live-price estimate. I will place this cash-on-delivery order only if you explicitly confirm.",
    confirmationToken,
    quote: {
      items: quote.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice: item.product.price,
        lineTotal: item.lineTotal
      })),
      address: {
        recipient: address.recipient,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode
      },
      subtotal: quote.subtotal,
      serviceCharge: quote.serviceCharge,
      deliveryCharge: quote.deliveryCharge,
      total: quote.total,
      paymentMethod: "Cash on delivery"
    }
  };
}

async function confirmOrder(userId, confirmationToken, secret) {
  let payload;
  try {
    payload = jwt.verify(confirmationToken, secret);
  } catch {
    return { message: "That order confirmation expired. Ask me to place the order again to review the latest cart total." };
  }
  if (payload.purpose !== "shopping-order-confirmation" || payload.sub !== String(userId)) {
    return { message: "I couldn't verify that order confirmation. Please ask me to place the order again." };
  }
  const cart = await Cart.findOne({ user: userId })
    .populate({ path: "items.product", select: cartProjection, populate: { path: "category", select: "name slug" } });
  if (!cart?.items.length) return { message: "Your cart is empty, so no order was placed." };
  if (cart.items.some((item) => !item.product)) {
    return { message: "A product in your cart is no longer in the catalog. No order was placed. Review your cart and prepare a fresh estimate." };
  }
  if ((cart.updatedAt?.getTime() ?? 0) !== payload.cartUpdatedAt) {
    return {
      message: "Your cart changed after I showed the estimate. Please review the updated cart before confirming.",
      cart: formatCart(cart, cartSummary(cart, await serviceRate()))
    };
  }
  const address = await Address.findOne({ _id: payload.addressId, user: userId });
  if (!address) return { message: "That delivery address is no longer available. Save an address at checkout and ask me to place the order again." };
  const unavailable = cart.items.filter((item) => !item.product?.inStock);
  if (unavailable.length) {
    return {
      message: "A product in your cart is no longer available. No order was placed.",
      unavailable: unavailable.map((item) => item.product?.name || "A product")
    };
  }
  const feePercent = await serviceRate();
  const quote = cartSummary(cart, feePercent);
  const currentSnapshot = quote.items.map((item) => ({
    productId: String(item.product._id),
    quantity: item.quantity,
    price: item.product.price,
    name: item.product.name,
    unit: item.product.unit
  }));
  if (JSON.stringify(currentSnapshot) !== JSON.stringify(payload.snapshot)
    || quote.total !== payload.total
    || feePercent !== payload.serviceChargePercent) {
    const updatedQuote = await startOrderConfirmation(userId, secret);
    return {
      ...updatedQuote,
      message: `A catalog price or service charge changed since the estimate. ${updatedQuote.message}`
    };
  }
  const items = quote.items.map(({ product, quantity, lineTotal }) => ({
    product: product._id,
    name: product.name,
    image: product.image,
    unit: product.unit,
    quantity,
    estimatedUnitPrice: product.price,
    lineTotal
  }));
  const order = await Order.create({
    user: userId,
    address: address._id,
    deliveryAddress: {
      label: address.label,
      recipient: address.recipient,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      notes: address.notes
    },
    items,
    subtotal: quote.subtotal,
    serviceCharge: quote.serviceCharge,
    deliveryCharge: quote.deliveryCharge,
    total: quote.total,
    paymentMethod: "cod",
    notes: address.notes
  });
  await Payment.create({
    order: order._id,
    user: userId,
    provider: "cod",
    amount: order.total,
    currency: process.env.STRIPE_CURRENCY || "inr"
  });
  cart.items = [];
  await cart.save();
  await sendOrderConfirmation(order);
  return {
    message: `Your order is placed. Order #${order.id.slice(-8).toUpperCase()} is now ${statusNames[order.status]}. Your team will shop the market, check quality, and ask you to approve any market-price changes before packing.`,
    order: {
      id: String(order._id),
      status: order.status,
      statusLabel: statusNames[order.status],
      paymentMethod: order.paymentMethod,
      subtotal: order.subtotal,
      serviceCharge: order.serviceCharge,
      deliveryCharge: order.deliveryCharge,
      total: order.total,
      items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit, price: item.estimatedUnitPrice }))
    },
    links: [{ label: "Track this order", href: `/orders/${order._id}` }]
  };
}

async function handleCartAction(intent, userId) {
  if (!userId) {
    return { message: "Please sign in before I change your shopping cart.", links: [{ label: "Sign in", href: "/login" }] };
  }
  const cart = await getCart(userId);
  if (intent.type === "cart_summary") {
    const rate = await serviceRate();
    const quote = cartSummary(cart, rate);
    return cart.items.length
      ? { message: `Your cart has ${cart.items.length} product${cart.items.length === 1 ? "" : "s"}. Here is the current estimate, using live catalog prices.`, cart: formatCart(cart, quote) }
      : { message: "Your cart is empty. Tell me what you would like to add.", cart: formatCart(cart, cartSummary(cart, rate)) };
  }
  const matches = await matchProducts(intent.productQuery);
  if (!matches.length) return { message: `I couldn't match “${intent.productQuery}” to a catalog product. Please try the exact product name shown in the catalog.` };
  const cartMatches = intent.type === "remove_cart" || intent.type === "update_cart"
    ? matches.filter((product) => cart.items.some((item) => String(item.product._id) === String(product._id)))
    : matches;
  if (cartMatches.length === 0) return { message: `I couldn't find “${intent.productQuery}” in your cart.` };
  let product = cartMatches[0];
  if (cartMatches.length > 1) {
    const normalizedQuery = normalizedName(intent.productQuery);
    const exactMatches = cartMatches.filter((candidate) => normalizedName(candidate.name) === normalizedQuery);
    if (exactMatches.length === 1) product = exactMatches[0];
    else return productMatchMessage(cartMatches.slice(0, 4), intent.type);
  }
  if (intent.type === "add_cart") {
    if (!product.inStock) {
      return { message: `${product.name} is currently marked unavailable in the catalog, so I didn't add it.`, products: productCards([product]) };
    }
    if (intent.quantity < 0.1 || intent.quantity > 100) {
      return { message: "Choose a quantity between 0.1 and 100." };
    }
    let updated = await Cart.findOne({ user: userId });
    if (!updated) updated = await Cart.create({ user: userId, items: [] });
    const existing = updated.items.find((item) => String(item.product) === String(product._id));
    if ((existing?.quantity ?? 0) + intent.quantity > 100) return { message: "The maximum quantity per product is 100." };
    if (existing) existing.quantity += intent.quantity;
    else updated.items.push({ product: product._id, quantity: intent.quantity });
    await updated.save();
  } else if (intent.type === "remove_cart") {
    const result = await Cart.updateOne({ user: userId }, { $pull: { items: { product: product._id } } });
    if (!result.matchedCount) return { message: "I couldn't find that item in your cart, so nothing was changed." };
  } else {
    if (intent.quantity < 0.1 || intent.quantity > 100) return { message: "Choose a quantity between 0.1 and 100." };
    const result = await Cart.updateOne(
      { user: userId, "items.product": product._id },
      { $set: { "items.$.quantity": intent.quantity } }
    );
    if (!result.matchedCount) return { message: "I couldn't find that item in your cart, so nothing was changed." };
  }
  const updatedCart = await getCart(userId);
  const rate = await serviceRate();
  const quote = cartSummary(updatedCart, rate);
  const actionText = intent.type === "add_cart" ? "Added" : intent.type === "remove_cart" ? "Removed" : "Updated";
  return {
    message: `${actionText} ${product.name}. Your cart total below is recalculated from current catalog prices; service charge is shown separately.`,
    cart: formatCart(updatedCart, quote)
  };
}

export async function runShoppingAssistant({ message, userId = null, confirmationToken = null, secret }) {
  const intent = parseShoppingIntent(message);
  if (intent.type === "greeting") {
    return {
      message: "Hi! I’m your Market Fresh AI Shopping Assistant. I can find live catalog products, manage your cart, show your order status, or explain how your market run works.",
      suggestions: ["Show me fruits", "Find vegetables", "What's in my cart?", "How does quality checking work?"]
    };
  }
  if (intent.type === "process_info") {
    return {
      message: "After you order, our team purchases your requested products from the local market and checks their quality. Catalog prices are estimates. If a market price changes, we show you the updated item prices and final bill and wait for your approval before packing. Order status updates come from your order record."
    };
  }
  if (intent.type === "confirm_order") {
    if (!userId) return { message: "Please sign in before placing an order.", links: [{ label: "Sign in", href: "/login" }] };
    if (!confirmationToken) return { message: "I haven't prepared an order for confirmation yet. Ask me to place your order and I'll show the current total first." };
    return confirmOrder(userId, confirmationToken, secret);
  }
  if (intent.type === "decline_confirmation") return { message: "No order was placed. Your cart is unchanged." };
  if (intent.type === "place_order") {
    if (!userId) return { message: "Please sign in before I prepare an order.", links: [{ label: "Sign in", href: "/login" }] };
    return startOrderConfirmation(userId, secret);
  }
  if (intent.type === "product_search") return searchProducts(message, intent.recommendation);
  if (intent.type === "cart_summary" || ["add_cart", "remove_cart", "update_cart"].includes(intent.type)) {
    return handleCartAction(intent, userId);
  }
  if (intent.type === "order_status") {
    if (!userId) return { message: "Please sign in to see your personal order updates.", links: [{ label: "Sign in", href: "/login" }] };
    const orders = await Order.find({ user: userId }).sort("-createdAt").limit(5);
    if (!orders.length) return { message: "I couldn't find an order on your account yet. Once you place one, I can show its latest saved status." };
    const recent = orders.map((order) => ({
      id: String(order._id),
      status: order.status,
      statusLabel: statusNames[order.status] || order.status,
      priceApproval: order.priceApproval,
      priceApprovalLabel: order.priceApproval === "pending" ? "Price changes need your approval" : null,
      paymentStatus: order.paymentStatus,
      total: order.total,
      createdAt: order.createdAt,
      itemCount: order.items.length
    }));
    return {
      message: "Here are the latest order statuses saved in your account. A pending price approval means the team is waiting for your decision before packing.",
      orders: recent,
      links: recent.map((order) => ({ label: `Track order #${order.id.slice(-8).toUpperCase()}`, href: `/orders/${order.id}` }))
    };
  }
  return {
    message: "I can help find products, recommend catalog matches, update your cart, check your saved order status, or explain our market and quality-check process. What would you like to do?",
    suggestions: ["Show me fruits", "Recommend vegetables", "Add 1 mango to my cart", "Track my order"]
  };
}
