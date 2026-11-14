const quantityPattern = "(\\d+(?:\\.\\d+)?)\\s*(?:kg|kgs|kilograms?|g|grams?|lb|lbs|pieces?|pcs|units?|packs?|boxes?)?";

export function parseShoppingIntent(input) {
  const message = input.trim().replace(/\s+/g, " ");
  const normalized = message.toLowerCase();

  if (/^(?:hi(?: there)?|hello(?: there)?|hey|good morning|good afternoon|good evening|help|start)[!. ]*$/.test(normalized)) {
    return { type: "greeting" };
  }
  if (/^(?:no|no thanks|cancel|don't|do not|not now|stop)[!. ]*$/.test(normalized)) {
    return { type: "decline_confirmation" };
  }
  if (/^(?:(?:yes|yeah|yep|sure|okay|ok)(?:[,. ]+(?:please|go ahead|do it|place it|place (?:my )?order|confirm(?: order)?))?|confirm(?:ed)?(?: order)?|go ahead|do it|place it|continue)[!. ]*$/.test(normalized)) {
    return { type: "confirm_order" };
  }
  if (/\b(?:how|what).{0,35}\b(?:market|freshness|quality|purchase|buying|approval|approve|work)\b|\b(?:market purchasing|quality check|price change|price approval|market process)\b/.test(normalized)) {
    return { type: "process_info" };
  }
  if (/\b(?:place|submit|checkout|check out|order now|buy my|complete my)\b/.test(normalized)) {
    return { type: "place_order" };
  }
  if (/\b(?:track|tracking|delivery status|order status|my last order|my recent order|where is my order|where's my order)\b/.test(normalized)) {
    return { type: "order_status" };
  }

  const updateMatch = normalized.match(
    new RegExp(`^(?:(?:please|i want to|can you|could you)\\s+)?(?:change|update|set)\\s+(?:(?:the\\s+)?quantity\\s+(?:of\\s+)?)?(.+?)\\s+(?:to|as)\\s+${quantityPattern}(?:\\s+(?:in|on)\\s+my\\s+(?:cart|bag|basket))?[.!?]*$`, "i")
  );
  if (updateMatch) return { type: "update_cart", productQuery: cleanProductQuery(updateMatch[1]), quantity: Number(updateMatch[2]) };

  const removeMatch = normalized.match(
    /^(?:(?:please|i want to|can you|could you)\s+)?(?:remove|delete)\s+(?:all\s+)?(.+?)(?:\s+from\s+my\s+(?:cart|bag|basket))?[.!?]*$/i
  );
  if (removeMatch && !/\b(?:cart|bag|basket|item|items|everything)\b/.test(removeMatch[1])) {
    return { type: "remove_cart", productQuery: cleanProductQuery(removeMatch[1]) };
  }

  const addMatch = normalized.match(
    new RegExp(`^(?:(?:please|i want to|can you|could you)\\s+)?(?:add|put|include)\\s+(?:${quantityPattern}\\s+(?:of\\s+)?)?(.+?)(?:\\s+to\\s+my\\s+(?:cart|bag|basket))?[.!?]*$`, "i")
  );
  if (addMatch) {
    const quantity = normalized.match(new RegExp(`^(?:(?:please|i want to|can you|could you)\\s+)?(?:add|put|include)\\s+${quantityPattern}\\s+(?:of\\s+)?`, "i"));
    return {
      type: "add_cart",
      productQuery: cleanProductQuery(addMatch[2] || addMatch[1]),
      quantity: quantity ? Number(quantity[1]) : 1
    };
  }

  if (/\b(?:my\s+)?(?:cart|basket|bag)\b|\b(?:cart|basket)\s+total\b|\bhow much (?:is|does) my\b/.test(normalized)) {
    return { type: "cart_summary" };
  }
  if (/\b(?:recommend|recommendation|suggest|suggestion|best|ideas|something|looking for|want|need)\b/.test(normalized)) {
    return { type: "product_search", recommendation: true };
  }
  if (/\b(?:fruit|fruits|vegetable|vegetables|veggie|veggies|grocery|groceries|product|products|show|find|search|browse|under|below|less than|budget|price|pricing|cost|available|availability|in stock|how much|how much is|what is the price|have)\b/.test(normalized)) {
    return { type: "product_search", recommendation: false };
  }
  return { type: "unknown" };
}

export function cleanProductQuery(input) {
  return input
    .toLowerCase()
    .replace(/\b(?:please|some|fresh|the|of|my|cart|bag|basket|to|from|all|item|items)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
