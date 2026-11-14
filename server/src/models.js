import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const { Schema, model } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  password: { type: String, required: true, select: false }
}, { timestamps: true });

userSchema.pre("save", async function () {
  if (this.isModified("password")) this.password = await bcrypt.hash(this.password, 12);
});
userSchema.methods.checkPassword = function (password) { return bcrypt.compare(password, this.password); };

const adminSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false }
}, { timestamps: true });
adminSchema.pre("save", async function () {
  if (this.isModified("password")) this.password = await bcrypt.hash(this.password, 12);
});
adminSchema.methods.checkPassword = function (password) { return bcrypt.compare(password, this.password); };

const deliveryPersonSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  password: { type: String, required: true, select: false },
  authVersion: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });
deliveryPersonSchema.pre("save", async function () {
  if (this.isModified("password")) this.password = await bcrypt.hash(this.password, 12);
});
deliveryPersonSchema.methods.checkPassword = function (password) { return bcrypt.compare(password, this.password); };

const categorySchema = new Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, default: "" },
  image: { type: String, default: "" }
}, { timestamps: true });

const productSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, default: "" },
  category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
  price: { type: Number, required: true, min: 0 },
  unit: { type: String, default: "kg", trim: true },
  image: { type: String, default: "" },
  stockQuantity: { type: Number, min: 0, default: null },
  inStock: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  reviews: [{
    user: { type: Schema.Types.ObjectId, ref: "User" },
    name: String,
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String, maxlength: 600 },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const cartSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  items: [{
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 0.1, max: 100 }
  }]
}, { timestamps: true });

const addressSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  label: { type: String, default: "Home" },
  recipient: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  line1: { type: String, required: true, trim: true },
  line2: { type: String, default: "" },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  postalCode: { type: String, required: true, trim: true },
  notes: { type: String, default: "" }
}, { timestamps: true });

const orderSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  address: { type: Schema.Types.ObjectId, ref: "Address" },
  deliveryAddress: { type: Object, required: true },
  items: [{
    product: { type: Schema.Types.ObjectId, ref: "Product" },
    name: String,
    image: String,
    unit: String,
    quantity: Number,
    estimatedUnitPrice: Number,
    actualUnitPrice: { type: Number },
    lineTotal: Number
  }],
  subtotal: { type: Number, required: true, min: 0 },
  serviceCharge: { type: Number, required: true, min: 0 },
  deliveryCharge: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ["placed", "confirmed", "purchasing", "quality_check", "packed", "out_for_delivery", "delivered", "cancelled"],
    default: "placed"
  },
  paymentMethod: { type: String, enum: ["cod", "stripe"], required: true },
  paymentStatus: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
  priceApproval: { type: String, enum: ["not_required", "pending", "approved", "rejected"], default: "not_required" },
  assignedTo: { type: String, default: "" },
  deliveryPerson: { type: Schema.Types.ObjectId, ref: "DeliveryPerson", default: null },
  deliveryProgress: { type: String, enum: ["assigned", "arrived", "failed", "verified"], default: null },
  deliveryEvents: [{
    type: { type: String, enum: ["assigned", "arrived", "failed", "otp_sent", "otp_resent", "otp_invalid", "otp_expired", "otp_verified", "delivered"], required: true },
    actor: { type: Schema.Types.ObjectId },
    actorRole: { type: String, enum: ["admin", "delivery", "system"] },
    note: { type: String, maxlength: 250 },
    createdAt: { type: Date, default: Date.now }
  }],
  deliveryOtpVerifiedAt: Date,
  deliveredAt: Date,
  deliveredBy: { type: Schema.Types.ObjectId, ref: "DeliveryPerson", default: null },
  notes: { type: String, default: "" },
  priceUpdatedAt: Date,
  deliveryOtpHash: { type: String, select: false },
  deliveryOtpExpiresAt: { type: Date, select: false },
  deliveryOtpAttempts: { type: Number, default: 0, select: false },
  deliveryOtpSentAt: { type: Date, select: false },
  deliveryOtpResends: { type: Number, default: 0, select: false }
}, {
  timestamps: true,
  toJSON: {
    transform(_document, result) {
      delete result.deliveryOtpHash;
      delete result.deliveryOtpExpiresAt;
      delete result.deliveryOtpAttempts;
      delete result.deliveryOtpSentAt;
      delete result.deliveryOtpResends;
      delete result.deliveryEvents;
      return result;
    }
  }
});

const paymentSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  provider: { type: String, enum: ["cod", "stripe"], required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: "inr" },
  status: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
  providerSessionId: { type: String }
}, { timestamps: true });

const settingSchema = new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }, { timestamps: true });
const supportSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  subject: { type: String, required: true, trim: true },
  message: { type: String, required: true, maxlength: 3000 }
}, { timestamps: true });

export const User = model("User", userSchema);
export const Admin = model("Admin", adminSchema);
export const DeliveryPerson = model("DeliveryPerson", deliveryPersonSchema);
export const Category = model("Category", categorySchema);
export const Product = model("Product", productSchema);
export const Cart = model("Cart", cartSchema);
export const Address = model("Address", addressSchema);
export const Order = model("Order", orderSchema);
export const Payment = model("Payment", paymentSchema);
export const Setting = model("Setting", settingSchema);
export const SupportMessage = model("SupportMessage", supportSchema);
