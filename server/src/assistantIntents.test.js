import test from "node:test";
import assert from "node:assert/strict";
import { cleanProductQuery, parseShoppingIntent } from "./assistantIntents.js";

test("recognizes greetings and the market process", () => {
  assert.deepEqual(parseShoppingIntent("Hi there"), { type: "greeting" });
  assert.deepEqual(parseShoppingIntent("How does quality checking work?"), { type: "process_info" });
});

test("parses product searches, categories, and recommendations", () => {
  assert.equal(parseShoppingIntent("Show me fruits under 200").type, "product_search");
  assert.equal(parseShoppingIntent("Recommend fresh vegetables").recommendation, true);
  assert.equal(parseShoppingIntent("What is the price of apples?").type, "product_search");
  assert.equal(parseShoppingIntent("Do you have tomatoes?").type, "product_search");
});

test("parses cart changes and keeps the requested quantity", () => {
  assert.deepEqual(parseShoppingIntent("add 2 kg of tomatoes to my cart"), {
    type: "add_cart", productQuery: "tomatoes", quantity: 2
  });
  assert.deepEqual(parseShoppingIntent("change quantity of mango to 3"), {
    type: "update_cart", productQuery: "mango", quantity: 3
  });
  assert.deepEqual(parseShoppingIntent("remove apples from my cart"), {
    type: "remove_cart", productQuery: "apples"
  });
  assert.deepEqual(parseShoppingIntent("Could you add 2 kg of tomatoes to my cart?"), {
    type: "add_cart", productQuery: "tomatoes", quantity: 2
  });
});

test("requires explicit order confirmation", () => {
  assert.equal(parseShoppingIntent("place my order").type, "place_order");
  assert.equal(parseShoppingIntent("yes, place it").type, "confirm_order");
  assert.equal(parseShoppingIntent("Yes, confirm order").type, "confirm_order");
  assert.equal(parseShoppingIntent("no thanks").type, "decline_confirmation");
});

test("recognizes cart and order status questions", () => {
  assert.equal(parseShoppingIntent("what is in my basket?").type, "cart_summary");
  assert.equal(parseShoppingIntent("track my order").type, "order_status");
});

test("cleans quantities and cart words from product queries", () => {
  assert.equal(cleanProductQuery("2 kg of fresh Alphonso mangoes"), "2 kg alphonso mangoes");
});
