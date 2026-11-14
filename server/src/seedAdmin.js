import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";
import { Admin, Category, Product } from "./models.js";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/market_fresh";
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters in server/.env before seeding.");
}

await mongoose.connect(uri);
const adminEmail = process.env.ADMIN_EMAIL.toLowerCase();
if (!(await Admin.exists({ email: adminEmail }))) {
  await Admin.create({ name: process.env.ADMIN_NAME || "Market Fresh Admin", email: adminEmail, password: process.env.ADMIN_PASSWORD });
  console.log(`Created admin account: ${adminEmail}`);
} else {
  console.log(`Admin account already exists: ${adminEmail}`);
}

const categories = [
  { name: "Fruits", slug: "fruits", description: "Sun-ripened favorites, hand-selected each morning.", image: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=85" },
  { name: "Vegetables", slug: "vegetables", description: "Crisp, seasonal greens from the local market.", image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=85" },
  { name: "Groceries", slug: "groceries", description: "Everyday pantry essentials, picked with care.", image: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=85" }
];
for (const categoryData of categories) {
  const category = await Category.findOneAndUpdate({ slug: categoryData.slug }, categoryData, { upsert: true, new: true });
  const products = categoryData.slug === "fruits"
    ? [
        ["Alphonso Mango", "Sweet, fragrant mangoes selected from the morning market.", 240, "kg", "photo-1553279768-865429fa0078"],
        ["Fresh Strawberries", "Bright, juicy berries packed with a little sweetness.", 180, "box", "photo-1464965911861-746a04b4bca6"],
        ["Green Grapes", "Crisp, seedless grapes for easy snacking.", 120, "kg", "photo-1537640538966-79f369143f8f"],
        ["Sweet Oranges", "Juicy seasonal oranges, rich in fresh flavor.", 90, "kg", "photo-1547514701-42782101795e"],
        ["Crisp Red Apples", "Crisp, naturally sweet apples selected for freshness.", 160, "kg", "photo-1560806887-1e4cd0b6cbd6"],
        ["Ripe Bananas", "Naturally sweet bananas, picked at just the right ripeness.", 60, "dozen", "photo-1571771894821-ce9b6c11b08e"],
        ["Fresh Watermelon", "Cool, juicy watermelon, perfect for sharing.", 45, "kg", "photo-1587049633312-d628ae50a8ae"],
        ["Fresh Lemons", "Bright, zesty lemons for everyday cooking and drinks.", 80, "kg", "photo-1590502593747-42a996133562"]
      ]
    : categoryData.slug === "vegetables"
      ? [
          ["Baby Spinach", "Tender, vibrant leaves for salads and everyday cooking.", 45, "bunch", "photo-1576045057995-568f588f82fb"],
          ["Heirloom Tomatoes", "Ripe and full of flavor, chosen fresh at the market.", 55, "kg", "photo-1546094096-0df4bcaaa337"],
          ["Crunchy Cucumbers", "Cool, crisp cucumbers, perfect for salads.", 35, "kg", "photo-1604977042946-1eecc30f269e"],
          ["Garden Carrots", "Naturally sweet, bright orange market-fresh carrots.", 60, "kg", "photo-1445282768818-728615cc910a"],
          ["Brown Onions", "Everyday cooking onions, selected firm and fresh.", 38, "kg", "photo-1508747703725-719777637510"],
          ["Market Potatoes", "Versatile potatoes, ready for all your family favorites.", 42, "kg", "photo-1518977676601-b53f82aba655"],
          ["Green Chillies", "Fresh green chillies to bring a little heat to your cooking.", 30, "250 g", "photo-1588252303782-cb80119abd6d"]
        ]
      : [
          ["Farm-fresh Eggs", "A dozen carefully checked farm-fresh eggs.", 90, "dozen", "photo-1506976785307-8732e854ad03"],
          ["Wholegrain Oats", "A hearty breakfast staple for wholesome mornings.", 130, "500 g", "photo-1574323347407-f5e1ad6d020b"],
          ["Cold-pressed Oil", "Kitchen essential, selected from trusted local brands.", 220, "litre", "photo-1474979266404-7eaacbcd87c5"],
          ["Basmati Rice", "Aromatic long-grain rice for everyday family meals.", 160, "kg", "photo-1586201375761-83865001e31c"],
          ["Whole Wheat Flour", "Fresh pantry flour for soft rotis and everyday baking.", 58, "kg", "photo-1627485937980-221c88ac04f9"],
          ["Fresh Whole Milk", "Everyday dairy, selected fresh for your refrigerator.", 68, "litre", "photo-1563636619-e9143da7973b"],
          ["Fresh Bakery Bread", "Soft, freshly baked bread for breakfast and snacks.", 45, "loaf", "photo-1509440159596-0249088772ff"],
          ["Everyday Spice Mix", "Aromatic spices to bring warmth to home-cooked meals.", 75, "100 g", "photo-1596040033229-a9821ebd058d"]
        ];
  for (let index = 0; index < products.length; index += 1) {
    const [name, description, price, unit, imageId] = products[index];
    await Product.findOneAndUpdate(
      { name, category: category._id },
      { name, description, category: category._id, price, unit, image: `https://images.unsplash.com/${imageId}?auto=format&fit=crop&w=900&q=85`, inStock: true, featured: index < 2 },
      { upsert: true, new: true }
    );
  }
}
console.log("Starter categories and products are ready.");
await mongoose.disconnect();
