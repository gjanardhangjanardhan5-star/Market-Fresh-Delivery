import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Bot, Check, ChevronDown, ChevronRight, Clock3, Eye, EyeOff, Headphones, Heart, Leaf, LoaderCircle, LockKeyhole, Mail, MapPin, Menu, MessageCircle, Minus, PackageCheck, Phone, Plus, Search, Send, ShieldCheck, ShoppingBag, Sparkles, Star, Truck, UserRound, X } from "lucide-react";
import { api, money } from "./api.js";

const AuthContext = createContext(null);
const CartContext = createContext(null);
const useAuth = () => useContext(AuthContext);
const useCart = () => useContext(CartContext);
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80";
const productCollections = [
  {
    slug: "fruits",
    name: "Fruits",
    eyebrow: "SUN-RIPENED & HAND-SELECTED",
    title: "Nature's sweetest picks.",
    description: "From crisp apples to fragrant mangoes, discover the best of today's fruit market.",
    photo: "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=900&q=82",
    fallback: "https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=900&q=82"
  },
  {
    slug: "vegetables",
    name: "Vegetables",
    eyebrow: "CRISP, COLORFUL & SEASONAL",
    title: "Good greens, gathered fresh.",
    description: "Market-fresh tomatoes, leafy greens, carrots and kitchen essentials picked with care.",
    photo: "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=900&q=82",
    fallback: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=82"
  },
  {
    slug: "groceries",
    name: "Groceries",
    eyebrow: "EVERYDAY PANTRY FAVORITES",
    title: "The essentials, made easy.",
    description: "Reliable pantry staples and everyday favorites, brought home in one thoughtful delivery.",
    photo: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=82",
    fallback: "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=900&q=82"
  }
];

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try { setUser((await api("/auth/me")).user); } finally { setReady(true); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const value = useMemo(() => ({ user, ready, refresh, setUser }), [user, ready, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState({ items: [] });
  const refresh = useCallback(async () => {
    if (!user || user.role !== "user") { setCart({ items: [] }); return; }
    try { setCart(await api("/cart")); } catch { setCart({ items: [] }); }
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);
  const value = useMemo(() => ({ cart, refresh }), [cart, refresh]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

function App() {
  return <AuthProvider><CartProvider><Site /></CartProvider></AuthProvider>;
}

function Site() {
  const { user, ready } = useAuth();
  return <><Header /><main>{!ready ? <div className="loading-screen"><LoaderCircle className="spin" /> Preparing your fresh picks…</div> :
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/shop/:category" element={<Shop />} />
      <Route path="/products/:id" element={<ProductPage />} />
      <Route path="/cart" element={<CartPage />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/orders" element={<Orders />} />
      <Route path="/orders/:id" element={<OrderDetail />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/admin" element={user?.role === "admin" ? <AdminDashboard /> : <AdminLogin />} />
      <Route path="/delivery" element={user?.role === "delivery" ? <DeliveryDashboard /> : <DeliveryLogin />} />
      <Route path="*" element={<NotFound />} />
    </Routes>}</main><Footer /><AssistantWidget /></>;
}

function AssistantWidget() {
  const { user } = useAuth();
  const { refresh } = useCart();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingToken, setPendingToken] = useState(null);
  const messagesEndRef = useRef(null);
  const [messages, setMessages] = useState([{
    role: "assistant",
    text: "Hi! I’m your Market Fresh AI Shopping Assistant. I can find live catalog products, help with your cart, check saved order updates, or explain our market-purchase process.",
    data: { suggestions: ["Show me fruits", "Find vegetables", "What's in my cart?", "How does quality checking work?"] }
  }]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, open]);

  async function sendMessage(value, explicitToken = null) {
    const text = value.trim();
    if (!text || busy) return;
    const isConfirmation = /^(?:(?:yes|yeah|yep|sure|okay|ok)(?:[,. ]+(?:please|go ahead|do it|place it|place (?:my )?order|confirm(?: order)?))?|confirm(?:ed)?(?: order)?|go ahead|do it|place it|continue)[!. ]*$/i.test(text);
    const token = explicitToken || (isConfirmation ? pendingToken : null);
    if (!isConfirmation) setPendingToken(null);
    setInput("");
    setMessages((current) => [...current, { role: "user", text }]);
    setBusy(true);
    try {
      const data = await api("/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, ...(token ? { confirmationToken: token } : {}) })
      });
      if (data.cart || data.order) await refresh();
      if (data.confirmationToken) setPendingToken(data.confirmationToken);
      else if (isConfirmation || /^(?:no|no thanks|cancel|not now|stop)[!. ]*$/i.test(text)) setPendingToken(null);
      setMessages((current) => [...current, { role: "assistant", text: data.message, data }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: error.message || "I couldn't reach the shopping assistant right now. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return <div className={`assistant-widget ${open ? "is-open" : ""}`}>
    {open && <section className="assistant-panel" aria-label="Market Fresh AI Shopping Assistant">
      <header className="assistant-header">
        <span className="assistant-avatar"><Bot size={19} /></span>
        <span><strong>Market Fresh AI</strong><small>Shopping Assistant · live catalog</small></span>
        <button type="button" className="assistant-close" aria-label="Close assistant" onClick={() => setOpen(false)}><X size={19} /></button>
      </header>
      <div className="assistant-messages" aria-live="polite">
        {messages.map((message, index) => <article key={`${index}-${message.role}`} className={`assistant-message ${message.role}`}>
          <p>{message.text}</p>
          {message.data?.unavailable?.length > 0 && <p className="assistant-warning">Unavailable: {message.data.unavailable.join(", ")}</p>}
          {message.data?.products?.length > 0 && <div className="assistant-products">
            {message.data.products.map((product) => <div className="assistant-product" key={product.id}>
              <Link to={`/products/${product.id}`} onClick={() => setOpen(false)} className="assistant-product-image">
                <img src={product.image || FALLBACK_IMAGE} alt="" />
              </Link>
              <div className="assistant-product-info">
                <Link to={`/products/${product.id}`} onClick={() => setOpen(false)}>{product.name}</Link>
                <strong>{money(product.price)} <small>/ {product.unit}</small></strong>
                <span className={product.inStock ? "assistant-stock" : "assistant-stock unavailable"}>{product.inStock ? "Available" : "Currently unavailable"}</span>
                {user?.role === "user" && product.inStock && <button type="button" onClick={() => sendMessage(`Add 1 ${product.name} to my cart`)} disabled={busy}>Add to cart</button>}
              </div>
            </div>)}
          </div>}
          {message.data?.cart && <div className="assistant-cart">
            {message.data.cart.items.length > 0 ? message.data.cart.items.map((item) => <div className="assistant-cart-line" key={item.productId}>
              <span>{item.name} × {item.quantity} <small>{money(item.price)} / {item.unit}</small></span><b>{money(item.lineTotal)}</b>
            </div>) : <div className="assistant-cart-empty">Your cart is empty.</div>}
            <div className="assistant-total-line"><span>Products</span><b>{money(message.data.cart.subtotal)}</b></div>
            <div className="assistant-total-line"><span>Service charge</span><b>{money(message.data.cart.serviceCharge)}</b></div>
            <div className="assistant-total-line"><span>Delivery</span><b>{money(message.data.cart.deliveryCharge)}</b></div>
            <div className="assistant-total-line final"><span>Estimated total</span><b>{money(message.data.cart.total)}</b></div>
          </div>}
          {message.data?.quote && <div className="assistant-quote">
            <div className="assistant-quote-items">{message.data.quote.items.map((item, itemIndex) => <div className="assistant-cart-line" key={`${item.name}-${itemIndex}`}>
              <span>{item.name} × {item.quantity} <small>{money(item.unitPrice)} / {item.unit}</small></span><b>{money(item.lineTotal)}</b>
            </div>)}</div>
            <div className="assistant-address"><MapPin size={14} /><span>{message.data.quote.address.recipient}, {message.data.quote.address.line1}, {message.data.quote.address.city}, {message.data.quote.address.state} {message.data.quote.address.postalCode}</span></div>
            <div className="assistant-total-line"><span>Products</span><b>{money(message.data.quote.subtotal)}</b></div>
            <div className="assistant-total-line"><span>Service charge</span><b>{money(message.data.quote.serviceCharge)}</b></div>
            <div className="assistant-total-line"><span>Delivery</span><b>{money(message.data.quote.deliveryCharge)}</b></div>
            <div className="assistant-total-line final"><span>Estimated total · {message.data.quote.paymentMethod}</span><b>{money(message.data.quote.total)}</b></div>
            {message.data.confirmationToken && <div className="assistant-confirm-actions">
              <button type="button" onClick={() => sendMessage("Yes, confirm order", message.data.confirmationToken)} disabled={busy}>Confirm order</button>
              <button type="button" onClick={() => sendMessage("No thanks", message.data.confirmationToken)} disabled={busy}>Not now</button>
            </div>}
          </div>}
          {message.data?.order && <div className="assistant-order">
            <strong>Order {message.data.order.statusLabel}</strong>
            <span>{message.data.order.items.map((item) => `${item.name} × ${item.quantity}`).join(" · ")}</span>
            <b>Final bill: {money(message.data.order.total)}</b>
          </div>}
          {message.data?.orders?.length > 0 && <div className="assistant-orders">
            {message.data.orders.map((order) => <Link key={order.id} to={`/orders/${order.id}`} onClick={() => setOpen(false)}>
              <span>#{order.id.slice(-8).toUpperCase()} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"}</span><strong>{order.statusLabel}</strong>
              {order.priceApprovalLabel && <small className="assistant-approval-label">{order.priceApprovalLabel}</small>}
            </Link>)}
          </div>}
          {message.data?.links?.map((link) => <Link className="assistant-inline-link" to={link.href} key={`${link.href}-${link.label}`} onClick={() => setOpen(false)}>{link.label}<ArrowRight size={14} /></Link>)}
          {message.data?.suggestions?.length > 0 && <div className="assistant-suggestions">{message.data.suggestions.map((suggestion) =>
            <button type="button" key={suggestion} onClick={() => sendMessage(suggestion)} disabled={busy}>{suggestion}</button>
          )}</div>}
        </article>)}
        {busy && <div className="assistant-typing"><LoaderCircle size={15} className="spin" /> Checking the live catalog…</div>}
        <div ref={messagesEndRef} />
      </div>
      <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); sendMessage(input); }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about products, cart or orders…" aria-label="Message the shopping assistant" maxLength={1000} disabled={busy} />
        <button type="submit" aria-label="Send message" disabled={busy || !input.trim()}><Send size={17} /></button>
      </form>
      <div className="assistant-disclaimer">Prices and stock are read from the current catalog. Order updates come from your account.</div>
    </section>}
    <button className="assistant-launcher" type="button" aria-label={open ? "Close Market Fresh AI" : "Open Market Fresh AI Shopping Assistant"} aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? <X size={21} /> : <><MessageCircle size={20} /><span>Ask Fresh AI</span></>}
    </button>
  </div>;
}

function Header() {
  const { user, setUser } = useAuth();
  const { cart } = useCart();
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const quantity = cart.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const previousQuantity = useRef(quantity);
  const [cartPulse, setCartPulse] = useState(false);
  useEffect(() => {
    if (quantity > previousQuantity.current) {
      setCartPulse(true);
      const timeout = window.setTimeout(() => setCartPulse(false), 650);
      previousQuantity.current = quantity;
      return () => window.clearTimeout(timeout);
    }
    previousQuantity.current = quantity;
    return undefined;
  }, [quantity]);
  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); setUser(null); navigate("/"); }
    catch (error) { window.alert(error.message); }
  }
  function submitSearch(event) {
    event.preventDefault();
    const query = search.trim();
    navigate(query ? `/shop/search?search=${encodeURIComponent(query)}` : "/shop/fruits");
    setMenuOpen(false);
  }
  return <><div className="announcement"><span><Sparkles size={14} /> Fresh from your local market, delivered with care</span><span className="announcement-right"><ShieldCheck size={14} /> Market prices confirmed with you before purchase</span></div>
    <header className="header"><div className="header-inner wrap">
      <button className="menu-toggle icon-button" aria-label="Toggle menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
      <Link to="/" className="brand"><span className="brand-mark"><Leaf size={22} fill="currentColor" /></span><span className="brand-name">MARKET FRESH DELIVERY</span></Link>
      <nav className={`main-nav ${menuOpen ? "open" : ""}`}>
        <NavLink to="/shop/fruits" onClick={() => setMenuOpen(false)}>Fruits</NavLink><NavLink to="/shop/vegetables" onClick={() => setMenuOpen(false)}>Vegetables</NavLink><NavLink to="/shop/groceries" onClick={() => setMenuOpen(false)}>Groceries</NavLink><NavLink to="/about" onClick={() => setMenuOpen(false)}>Our story</NavLink>
      </nav>
      <form className="searchbox" onSubmit={submitSearch}><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fresh picks" aria-label="Search products" /><button aria-label="Search"><Search size={17} /></button></form>
      <div className="header-actions">
        {user ? <div className="account-menu"><NavLink to={user.role === "admin" ? "/admin" : user.role === "delivery" ? "/delivery" : "/orders"} className="account-link"><span className="avatar">{user.name?.slice(0, 1)}</span><span className="account-name">{user.role === "admin" ? "Admin" : user.role === "delivery" ? "Delivery" : user.name?.split(" ")[0]}</span></NavLink><button className="text-button signout" onClick={logout}>Sign out</button></div> : <><Link to="/login" className="login-link">Login</Link><Link to="/register" className="register-link">Register</Link></>}
        {user?.role === "user" ? <NavLink to="/orders" className="orders-link">My orders</NavLink> : !user ? <NavLink to="/orders" className="orders-link">My orders</NavLink> : null}
        {user?.role !== "admin" && user?.role !== "delivery" && <Link to="/cart" className={`cart-button ${cartPulse ? "cart-pulse" : ""}`} aria-label={`Shopping cart, ${quantity} items`}><ShoppingBag size={19} /><span>Cart</span><b>{quantity}</b></Link>}
      </div>
    </div></header></>;
}

function Footer() {
  return <footer className="footer">
    <div className="wrap footer-main">
      <div className="footer-brand">
        <Link to="/" className="brand"><span className="brand-mark"><Leaf size={22} fill="currentColor" /></span><span className="brand-name">MARKET FRESH DELIVERY</span></Link>
        <p>We visit your local market, choose each item with care, and bring the good stuff right home.</p>
        <div className="footer-promise"><BadgeCheck size={17} /> Market-picked. Quality checked.</div>
      </div>
      <nav className="footer-links" aria-label="Explore">
        <h4>Explore</h4>
        <Link to="/shop/fruits">Fresh fruits</Link><Link to="/shop/vegetables">Good greens</Link><Link to="/shop/groceries">Pantry essentials</Link><Link to="/about">Our story</Link>
      </nav>
      <nav className="footer-links" aria-label="Customer help">
        <h4>Here to help</h4>
        <Link to="/orders">Track an order</Link><Link to="/cart">Your shopping bag</Link><Link to="/contact">Contact our team</Link>
      </nav>
      <div className="footer-contact">
        <h4>Get in touch</h4>
        <p>Questions about an order or how our market runs work? We’re happy to help.</p>
        <a href="mailto:hello@marketfresh.local"><Mail size={16} /><span><small>Email our team</small><b>hello@marketfresh.local</b></span><ArrowUpRight size={14} /></a>
      </div>
    </div>
    <div className="footer-bottom">
      <div className="wrap footer-bottom-inner">
        <span>© {new Date().getFullYear()} MARKET FRESH DELIVERY</span>
        <span className="footer-bottom-promise">Made for fresher everyday living <Leaf size={14} /></span>
        <div className="footer-staff-links"><Link to="/admin">Admin sign in</Link><Link to="/delivery">Delivery sign in</Link></div>
      </div>
    </div>
  </footer>;
}

function ProductCard({ product, index = 0, imageFallback = FALLBACK_IMAGE }) {
  const { user } = useAuth();
  const { refresh } = useCart();
  const cardRef = useRef(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    if (!("IntersectionObserver" in window)) {
      card.classList.add("is-visible");
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        card.classList.add("is-visible");
        observer.disconnect();
      }
    }, { threshold: 0.12 });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  async function addToCart(event) {
    event.preventDefault();
    if (!user) return window.location.assign("/login");
    setAdding(true);
    try {
      await api("/cart/items", { method: "POST", body: JSON.stringify({ productId: product._id, quantity: 1 }) });
      await refresh();
      setAdded(true);
      window.setTimeout(() => setAdded(false), 1000);
    }
    catch (error) { window.alert(error.message); }
    finally { setAdding(false); }
  }
  const avg = product.reviews?.length ? (product.reviews.reduce((sum, review) => sum + review.rating, 0) / product.reviews.length).toFixed(1) : null;
  return <article ref={cardRef} className={`product-card reveal-on-scroll ${added ? "product-added" : ""}`} style={{ "--card-delay": `${(index % 4) * 65}ms` }}>
    <Link to={`/products/${product._id}`} className="product-image"><img src={product.image || imageFallback} alt={product.name} loading="lazy" onError={(e) => { if (e.currentTarget.src !== imageFallback) e.currentTarget.src = imageFallback; }} />{product.featured && <span className="product-tag">Market favorite</span>}</Link>
    <button className={`save-product ${saved ? "saved" : ""}`} onClick={() => setSaved(!saved)} aria-label={saved ? "Remove from saved items" : "Save product"}><Heart size={17} fill={saved ? "currentColor" : "none"} /></button>
    <div className="product-info"><Link to={`/products/${product._id}`}><h3>{product.name}</h3></Link><div className="product-rating">{avg ? <><Star size={13} fill="currentColor" /> {avg} <span>({product.reviews.length})</span></> : <span className="rating-new">Fresh pick</span>}</div><div className="product-bottom"><div><strong>{money(product.price)}</strong><span> / {product.unit}</span></div><button className={`add-button ${added ? "is-added" : ""}`} onClick={addToCart} disabled={adding || !product.inStock} aria-label={added ? `${product.name} added to cart` : `Add ${product.name} to cart`}>{adding ? <LoaderCircle size={15} className="spin" /> : added ? <><Check size={15} /><span>Added</span></> : <><Plus size={15} /><span>Add</span></>}</button></div></div>
  </article>;
}

function SectionHeading({ eyebrow, title, description, link, linkText = "Explore all" }) {
  return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{link && <Link className="arrow-link" to={link}>{linkText}<ArrowRight size={16} /></Link>}</div>;
}

function ProductCollection({ collection, products }) {
  const sectionRef = useRef(null);
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;
    if (!("IntersectionObserver" in window)) {
      section.classList.add("is-visible");
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        section.classList.add("is-visible");
        observer.disconnect();
      }
    }, { threshold: 0.08 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return <section ref={sectionRef} className={`collection-section collection-${collection.slug} reveal-on-scroll`}>
    <div className="wrap">
      <div className="collection-intro">
        <div className="collection-copy">
          <span className="eyebrow">{collection.eyebrow}</span>
          <h2>{collection.title}</h2>
          <p>{collection.description}</p>
          <Link className="collection-link" to={`/shop/${collection.slug}`}>Shop {collection.name.toLowerCase()} <ArrowRight size={16} /></Link>
        </div>
        <Link className="collection-photo" to={`/shop/${collection.slug}`} aria-label={`Shop ${collection.name}`}>
          <img src={collection.photo} alt={`Fresh ${collection.name.toLowerCase()} from the local market`} loading="lazy" onError={(event) => {
            if (event.currentTarget.src !== collection.fallback) event.currentTarget.src = collection.fallback;
          }} />
          <span>FRESH FROM THE MARKET</span>
        </Link>
      </div>
      {products.length ? <div className="product-grid collection-products">
        {products.slice(0, 8).map((product, index) => <ProductCard key={product._id} product={product} index={index} imageFallback={collection.fallback} />)}
      </div> : <div className="collection-empty">More fresh {collection.name.toLowerCase()} are on their way. <Link to={`/shop/${collection.slug}`}>Browse the collection <ArrowRight size={14} /></Link></div>}
    </div>
  </section>;
}

function Home() {
  const [productsByCategory, setProductsByCategory] = useState({ fruits: [], vegetables: [], groceries: [] });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      api("/categories"),
      ...productCollections.map((collection) => api(`/products?category=${collection.slug}`))
    ]).then(([groups, fruits, vegetables, groceries]) => {
      setCategories(groups);
      setProductsByCategory({ fruits, vegetables, groceries });
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  return <div className="home-page">
    <section className="hero premium-hero"><div className="hero-copy"><span className="hero-kicker"><span className="kicker-line" /> YOUR LOCAL MARKET, AT YOUR DOOR</span><h1>Fresh from the Market.<br /><em>Made for Your Table.</em></h1><p>Fresh fruits, crisp vegetables and everyday groceries, hand-selected at your local market and delivered to your door.</p><div className="hero-actions"><Link className="button button-dark" to="/shop/fruits">Explore Products <ArrowRight size={17} /></Link><Link className="button button-outline" to="/about">Our promise</Link></div><div className="hero-social"><span className="avatar-stack"><i>J</i><i>A</i><i>M</i></span><span><strong>Good food, picked for you.</strong><small>Real people. Your local market.</small></span><span className="hero-rating"><Star size={14} fill="currentColor" /> 4.9</span></div></div><div className="hero-visual premium-hero-visual"><div className="hero-photo-collage"><figure className="hero-photo-main"><img src="https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=1200&q=84" alt="A natural assortment of fresh fruits and vegetables" loading="eager" /><figcaption><span className="caption-dot" /><span><b>Picked today, delivered with care.</b><small>Your neighborhood market run, made easy.</small></span><ArrowUpRight size={19} /></figcaption></figure><figure className="hero-photo-secondary hero-photo-fruit"><img src="https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=700&q=80" alt="Fresh seasonal fruit at the market" loading="lazy" /></figure><figure className="hero-photo-secondary hero-photo-greens"><img src="https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=700&q=80" alt="Fresh leafy greens and vegetables" loading="lazy" /></figure><div className="hero-fresh-note"><span><Check size={15} /></span><span><b>From local growers</b><small>Chosen fresh for you</small></span></div><div className="photo-caption"><Leaf size={14} /> REAL FOOD. REAL FRESH.</div></div></div>
    </section>
    <div className="trust-strip wrap"><div><span className="trust-icon"><Leaf size={18} /></span><span><b>Picked with care</b><small>Only the good stuff</small></span></div><div><span className="trust-icon"><ShieldCheck size={18} /></span><span><b>Quality checked</b><small>Before it gets to you</small></span></div><div><span className="trust-icon"><Truck size={18} /></span><span><b>At your doorstep</b><small>Fresh from the market</small></span></div><div><span className="trust-icon"><Heart size={18} /></span><span><b>Made for real life</b><small>Good food, less fuss</small></span></div></div>
    <section className="category-section wrap"><SectionHeading eyebrow="THE GOOD STUFF" title="A market basket, your way." description="Shop fresh fruit, vegetables and pantry favorites from one neighborhood market." link="/shop/fruits" /><div className="category-grid">{categories.map((category, i) => <Link to={`/shop/${category.slug}`} className={`category-card category-${i}`} key={category._id}><img src={category.image || productCollections[i]?.photo || FALLBACK_IMAGE} alt={`Fresh ${category.name.toLowerCase()} at the market`} loading="lazy" onError={(e) => { if (e.currentTarget.src !== productCollections[i]?.fallback) e.currentTarget.src = productCollections[i]?.fallback || FALLBACK_IMAGE; }} /><span className="category-overlay"></span><span className="category-content"><small>FRESH FROM THE MARKET</small><b>{category.name}</b><span>Find your favorites <ArrowRight size={16} /></span></span><span className="category-number">0{i + 1}</span></Link>)}</div></section>
    {error && <div className="wrap inline-error">{error} — check that the server is running.</div>}
    {loading ? <div className="loading-screen"><LoaderCircle className="spin" /> Gathering today's fresh picks…</div> : productCollections.map((collection) => <ProductCollection key={collection.slug} collection={collection} products={productsByCategory[collection.slug]} />)}
    <section className="market-story wrap"><div className="story-images"><img className="story-main" src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1000&q=85" alt="Fresh produce at a local market" /><img className="story-inset" src="https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=600&q=85" alt="Fresh leafy greens" /><span className="story-seal"><span>LOCAL<br />MARKET<br /><b>GOODNESS</b></span><Leaf size={18} /></span></div><div className="story-copy"><span className="eyebrow">A DIFFERENT KIND OF GROCERY RUN</span><h2>Your order.<br />Our market run.</h2><p>We don't pull from a warehouse. When your order comes in, our team heads to the local market to find the freshest versions of what you asked for — choosing each item like it's for our own table.</p><div className="story-check"><span><Check size={15} /></span> Hand-picked after you order</div><div className="story-check"><span><Check size={15} /></span> Quality and freshness checked</div><div className="story-check"><span><Check size={15} /></span> You approve any price changes</div><Link className="arrow-link story-link" to="/about">More about our way <ArrowRight size={16} /></Link></div></section>
    <section className="cta-section"><div className="wrap cta-inner"><span className="eyebrow">YOUR MARKET BASKET IS WAITING</span><h2>Make room for<br /><em>the good stuff.</em></h2><p>A fresh market run, made just for you.</p><Link className="button button-dark" to="/shop/vegetables">Start shopping <ArrowRight size={17} /></Link><div className="cta-leaf leaf-a"><Leaf /></div><div className="cta-leaf leaf-b"><Leaf /></div><span className="cta-sun"></span></div></section>
  </div>;
}

function Shop() {
  const { category } = useParams();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("search") || "";
  const [products, setProducts] = useState([]);
  const [sort, setSort] = useState("featured");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    const categoryQuery = category === "search" ? "" : `category=${encodeURIComponent(category)}`;
    api(`/products?${categoryQuery}${query ? `${categoryQuery ? "&" : ""}search=${encodeURIComponent(query)}` : ""}`)
      .then(setProducts).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [category, query]);
  const ordered = [...products].sort((a, b) => sort === "price-low" ? a.price - b.price : sort === "price-high" ? b.price - a.price : sort === "name" ? a.name.localeCompare(b.name) : Number(b.featured) - Number(a.featured));
  const title = category === "search" ? "Search" : category[0]?.toUpperCase() + category.slice(1);
  return <div className="wrap page-wrap shop-page"><div className="breadcrumb"><Link to="/">Home</Link><ChevronRight size={14} /> {title}</div><div className="shop-head"><div><span className="eyebrow">FRESH FROM YOUR LOCAL MARKET</span><h1>{query ? "Search results" : `Good ${category}, picked fresh.`}</h1><p>{query ? <>Showing picks for “{query}” across all categories</> : `Our team hand-picks the best ${category} after your order.`}</p></div><div className="shop-count"><span>{products.length.toString().padStart(2, "0")}</span> fresh finds</div></div><div className="shop-toolbar"><div className="filter-pills">{["Fruits", "Vegetables", "Groceries"].map((name) => <Link key={name} className={category === name.toLowerCase() ? "active" : ""} to={`/shop/${name.toLowerCase()}${query ? `?search=${encodeURIComponent(query)}` : ""}`}>{name}</Link>)}</div><label className="sort-select">Sort by <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name</option></select><ChevronDown size={14} /></label></div>{loading ? <div className="loading-screen"><LoaderCircle className="spin" /> Finding your fresh picks…</div> : error ? <div className="inline-error">{error}</div> : ordered.length ? <div className="product-grid shop-products">{ordered.map((product, i) => <ProductCard key={product._id} product={product} index={i} />)}</div> : <div className="empty-state"><span className="empty-icon"><Search /></span><h3>No market finds just yet.</h3><p>Try a different search, or come back soon for fresh picks.</p><Link className="button button-dark" to="/shop/fruits">Browse all fruits</Link></div>}</div>;
}

function ProductPage() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState({ rating: 5, comment: "" });
  const { user } = useAuth();
  const { refresh } = useCart();
  const [message, setMessage] = useState("");
  const load = useCallback(() => api(`/products/${id}`).then(setProduct).catch((e) => setMessage(e.message)).finally(() => setLoading(false)), [id]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    if (!user) return window.location.assign("/login");
    try { await api("/cart/items", { method: "POST", body: JSON.stringify({ productId: id, quantity }) }); await refresh(); setMessage("Added to your shopping bag."); }
    catch (e) { setMessage(e.message); }
  }
  async function submitReview(e) {
    e.preventDefault();
    try { await api(`/products/${id}/reviews`, { method: "POST", body: JSON.stringify(review) }); setMessage("Thanks for sharing your review."); await load(); }
    catch (error) { setMessage(error.message); }
  }
  if (loading) return <div className="loading-screen"><LoaderCircle className="spin" /> Loading product…</div>;
  if (!product) return <div className="wrap page-wrap"><div className="empty-state"><h3>We couldn't find that product.</h3><Link to="/shop/fruits" className="button button-dark">Browse the market</Link></div></div>;
  const average = product.reviews?.length ? (product.reviews.reduce((sum, item) => sum + item.rating, 0) / product.reviews.length).toFixed(1) : "New";
  return <div className="wrap page-wrap"><div className="breadcrumb"><Link to="/">Home</Link><ChevronRight size={14} /><Link to={`/shop/${product.category?.slug}`}>{product.category?.name}</Link><ChevronRight size={14} />{product.name}</div><div className="product-detail"><div className="detail-image"><img src={product.image || FALLBACK_IMAGE} alt={product.name} onError={(e) => { e.currentTarget.src = FALLBACK_IMAGE; }} /><span className="detail-fresh"><Leaf size={15} /> MARKET PICKED</span></div><div className="detail-copy"><span className="eyebrow">{product.category?.name?.toUpperCase()} · PICKED AFTER YOUR ORDER</span><h1>{product.name}</h1><div className="detail-rating"><Star size={15} fill="currentColor" /> {average} <span>{product.reviews?.length ? `(${product.reviews.length} reviews)` : "Just in from the market"}</span></div><div className="detail-price">{money(product.price)} <small>/ {product.unit}</small></div><p>{product.description || "A fresh local-market pick, chosen for quality and delivered with care."}</p><div className="price-note"><ShieldCheck size={17} /><span>Your estimated market price. If the market price changes, we'll ask your approval before final billing.</span></div><div className="detail-purchase"><div className="quantity-control"><button aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(0.1, +(quantity - 0.5).toFixed(1)))}><Minus size={16} /></button><span>{quantity}</span><button aria-label="Increase quantity" onClick={() => setQuantity(+(quantity + 0.5).toFixed(1))}><Plus size={16} /></button></div><button onClick={add} className="button button-dark add-wide"><ShoppingBag size={17} /> Add to bag · {money(product.price * quantity)}</button></div>{message && <div className="form-message">{message}</div>}<div className="detail-promises"><span><Check size={14} /> Quality checked</span><span><Check size={14} /> Picked to order</span><span><Check size={14} /> Delivered fresh</span></div></div></div>
    <section className="reviews-section"><SectionHeading eyebrow="FROM OUR COMMUNITY" title="Fresh thoughts." description={`${product.reviews?.length || 0} reviews from our community`} />{product.reviews?.length ? <div className="reviews-grid">{product.reviews.map((item, i) => <div className="review-card" key={item._id || i}><div className="review-stars">{Array.from({ length: 5 }).map((_, n) => <Star key={n} size={14} fill={n < item.rating ? "currentColor" : "none"} />)}</div><p>{item.comment || "A lovely fresh market pick."}</p><b>{item.name || "Market Fresh customer"}</b></div>)}</div> : <p className="muted-text">Once you've enjoyed this in a delivered order, come back and leave a review.</p>}{user?.role === "user" && <form className="review-form" onSubmit={submitReview}><h3>Share your experience</h3><label>Rating<select value={review.rating} onChange={(e) => setReview({ ...review, rating: Number(e.target.value) })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}</select></label><label>Your review<textarea value={review.comment} onChange={(e) => setReview({ ...review, comment: e.target.value })} maxLength={600} placeholder="What did you think?" /></label><button className="button button-dark">Submit review</button></form>}</section>
  </div>;
}

function CartPage() {
  const { user } = useAuth();
  const { cart, refresh } = useCart();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  async function change(product, quantity) {
    try {
      if (quantity <= 0) await api(`/cart/items/${product}`, { method: "DELETE" });
      else await api(`/cart/items/${product}`, { method: "PATCH", body: JSON.stringify({ quantity }) });
      await refresh();
    } catch (e) { setError(e.message); }
  }
  const subtotal = cart.items.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0);
  if (!user) return <div className="wrap page-wrap"><div className="empty-state"><span className="empty-icon"><ShoppingBag /></span><h2>Your market bag awaits.</h2><p>Sign in to shop and keep your picks together.</p><Link to="/login" className="button button-dark">Sign in to shop</Link></div></div>;
  return <div className="wrap page-wrap cart-page"><div className="breadcrumb"><Link to="/">Home</Link><ChevronRight size={14} /> Shopping bag</div><div className="page-title"><span className="eyebrow">YOUR MARKET BASKET</span><h1>A bag full of good.</h1><p>Everything you picked, all in one place.</p></div>{error && <div className="inline-error">{error}</div>}{cart.items.length ? <div className="cart-layout"><div className="cart-items">{cart.items.map((item) => <div className="cart-item" key={item.product._id}><Link to={`/products/${item.product._id}`}><img src={item.product.image || FALLBACK_IMAGE} alt={item.product.name} onError={(e) => { e.currentTarget.src = FALLBACK_IMAGE; }} /></Link><div className="cart-item-info"><Link to={`/products/${item.product._id}`}><h3>{item.product.name}</h3></Link><span>{money(item.product.price)} / {item.product.unit}</span><div className="quantity-control quantity-small"><button onClick={() => change(item.product._id, +(item.quantity - 0.5).toFixed(1))}><Minus size={14} /></button><span>{item.quantity}</span><button onClick={() => change(item.product._id, +(item.quantity + 0.5).toFixed(1))}><Plus size={14} /></button></div></div><div className="cart-item-price"><b>{money(item.product.price * item.quantity)}</b><button className="remove-button" onClick={() => change(item.product._id, 0)}>Remove</button></div></div>)}<Link to="/shop/fruits" className="continue-link"><ArrowDown size={15} /> Keep exploring</Link></div><aside className="order-summary"><h3>Basket summary</h3><p className="summary-caption">Your market run, at a glance.</p><div className="summary-row"><span>Products (estimated)</span><b>{money(subtotal)}</b></div><div className="summary-row"><span>Service charge</span><span>Calculated at checkout</span></div><div className="summary-row"><span>Delivery</span><span>Free</span></div><div className="summary-total"><span>Estimated total</span><b>{money(subtotal)}</b></div><p className="summary-footnote"><ShieldCheck size={15} /> Your team confirms actual market prices before purchase.</p><button className="button button-dark button-full" onClick={() => navigate("/checkout")}>Continue to checkout <ArrowRight size={17} /></button><div className="secure-note"><LockKeyhole size={13} /> Secure checkout</div></aside></div> : <div className="empty-state"><span className="empty-icon"><ShoppingBag /></span><h2>Your bag is taking a little break.</h2><p>Find something fresh and make it yours.</p><Link className="button button-dark" to="/shop/fruits">Explore the market <ArrowRight size={16} /></Link></div>}</div>;
}

function Checkout() {
  const { user } = useAuth();
  const { cart, refresh } = useCart();
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState([]);
  const [selected, setSelected] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cod");
  const [showAddress, setShowAddress] = useState(false);
  const [address, setAddress] = useState({ label: "Home", recipient: user?.name || "", phone: user?.phone || "", line1: "", line2: "", city: "", state: "", postalCode: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feePercent, setFeePercent] = useState(5);
  const [onlineAvailable, setOnlineAvailable] = useState(false);
  useEffect(() => {
    if (!user) return;
    Promise.all([api("/addresses"), api("/store/config")]).then(([items, config]) => {
      setAddresses(items);
      if (items[0]) setSelected(items[0]._id);
      setFeePercent(config.serviceChargePercent);
      setOnlineAvailable(config.onlinePaymentsEnabled);
    }).catch((e) => setError(e.message));
  }, [user]);
  const subtotal = cart.items.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0);
  const fee = subtotal * feePercent / 100;
  async function saveAddress(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const created = await api("/addresses", { method: "POST", body: JSON.stringify(address) });
      setAddresses([created, ...addresses]); setSelected(created._id); setShowAddress(false);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function placeOrder() {
    setBusy(true); setError("");
    try {
      const order = await api("/orders", { method: "POST", body: JSON.stringify({ addressId: selected, paymentMethod }) });
      await refresh();
      navigate(`/orders/${order._id}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (!user) return <div className="wrap page-wrap"><div className="empty-state"><h2>Sign in to check out.</h2><Link to="/login" className="button button-dark">Sign in</Link></div></div>;
  if (!cart.items.length) return <div className="wrap page-wrap"><div className="empty-state"><h2>Your bag is empty.</h2><Link to="/shop/fruits" className="button button-dark">Shop the market</Link></div></div>;
  return <div className="wrap page-wrap checkout-page"><div className="breadcrumb"><Link to="/">Home</Link><ChevronRight size={14} /><Link to="/cart">Shopping bag</Link><ChevronRight size={14} /> Checkout</div><div className="page-title"><span className="eyebrow">ONE LAST THING</span><h1>Let's get the good stuff home.</h1><p>Your market run is almost ready.</p></div>{error && <div className="inline-error">{error}</div>}<div className="checkout-layout"><div className="checkout-main"><section className="checkout-section"><div className="checkout-step"><span>01</span><div><h2>Where should we deliver?</h2><p>Pick a saved address or add a new one.</p></div></div>{addresses.length > 0 && <div className="address-list">{addresses.map((item) => <label className={`address-card ${selected === item._id ? "selected" : ""}`} key={item._id}><input type="radio" name="address" checked={selected === item._id} onChange={() => setSelected(item._id)} /><span className="radio-check"></span><span className="address-copy"><b>{item.label} · {item.recipient}</b><span>{item.line1}{item.line2 ? `, ${item.line2}` : ""}, {item.city}, {item.state} {item.postalCode}</span><small>{item.phone}</small></span><MapPin size={17} /></label>)}</div>}<button className="add-address-button" onClick={() => setShowAddress(!showAddress)}><Plus size={16} /> {showAddress ? "Close address form" : "Add a delivery address"}</button>{showAddress && <form onSubmit={saveAddress} className="address-form">{[["label", "Label"], ["recipient", "Recipient name"], ["phone", "Phone"], ["line1", "Address line 1"], ["line2", "Address line 2 (optional)"], ["city", "City"], ["state", "State"], ["postalCode", "Postal code"]].map(([key, label]) => <label key={key} className={key === "line1" || key === "line2" ? "field-full" : ""}>{label}<input required={!["line2"].includes(key)} value={address[key]} onChange={(e) => setAddress({ ...address, [key]: e.target.value })} /></label>)}<button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save address"}</button></form>}</section>
      <section className="checkout-section"><div className="checkout-step"><span>02</span><div><h2>How would you like to pay?</h2><p>We only finalize your total after your market run.</p></div></div><div className="payment-options"><label className={`payment-option ${paymentMethod === "cod" ? "selected" : ""}`}><input type="radio" name="payment" value="cod" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} /><span className="radio-check"></span><span className="payment-icon"><PackageCheck size={21} /></span><span><b>Cash on delivery</b><small>Pay your final total when your order arrives.</small></span><span className="payment-recommended">POPULAR</span></label>{onlineAvailable && <label className={`payment-option ${paymentMethod === "stripe" ? "selected" : ""}`}><input type="radio" name="payment" value="stripe" checked={paymentMethod === "stripe"} onChange={() => setPaymentMethod("stripe")} /><span className="radio-check"></span><span className="payment-icon"><LockKeyhole size={19} /></span><span><b>Pay online with Stripe</b><small>Secure online payment after price approval.</small></span></label>}</div></section>
      <div className="market-confirmation"><span><ShieldCheck size={19} /></span><div><b>A note about market prices</b><p>Prices are estimates based on today's listings. If an item costs more at the market, we'll ask for your approval before the team buys it. You'll never be charged without knowing your final total.</p></div></div></div>
      <aside className="order-summary checkout-summary"><h3>Your market basket</h3><div className="checkout-products">{cart.items.map((item) => <div className="checkout-product" key={item.product._id}><img src={item.product.image || FALLBACK_IMAGE} alt="" onError={(e) => { e.currentTarget.src = FALLBACK_IMAGE; }} /><span><b>{item.product.name}</b><small>{item.quantity} × {money(item.product.price)} / {item.product.unit}</small></span><b>{money(item.product.price * item.quantity)}</b></div>)}</div><div className="summary-row"><span>Product costs (estimated)</span><b>{money(subtotal)}</b></div><div className="summary-row"><span>Service charge ({feePercent}%)</span><b>{money(fee)}</b></div><div className="summary-row"><span>Delivery</span><span>Free</span></div><div className="summary-total"><span>Estimated total</span><b>{money(subtotal + fee)}</b></div><p className="summary-footnote"><Truck size={15} /> Your final bill follows your approved market prices.</p><button className="button button-dark button-full" disabled={busy || !selected} onClick={placeOrder}>{busy ? <><LoaderCircle className="spin" size={17} /> Placing your order…</> : <>Place your order <ArrowRight size={17} /></>}</button><div className="secure-note"><LockKeyhole size={13} /> Your details stay secure</div></aside></div></div>;
}

function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { setUser, refresh } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    line1: "",
    city: "",
    state: "",
    postalCode: ""
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError("");
    if (isRegister) {
      const phoneDigits = values.phone.replace(/\D/g, "");
      if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        setError("Enter a valid mobile number with 7 to 15 digits.");
        return;
      }
      if (values.password.length < 8 || values.password.length > 128) {
        setError("Your password must be between 8 and 128 characters.");
        return;
      }
    }
    setBusy(true);
    try {
      const credentials = isRegister
        ? { name: values.name.trim(), phone: values.phone.trim(), email: values.email.trim(), password: values.password }
        : { email: values.email.trim(), password: values.password };
      const result = await api(`/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(credentials)
      });
      setUser(result.user);

      if (isRegister) {
        try {
          await api("/addresses", {
            method: "POST",
            body: JSON.stringify({
              label: "Home",
              recipient: values.name.trim(),
              phone: values.phone.trim(),
              line1: values.line1.trim(),
              city: values.city.trim(),
              state: values.state.trim(),
              postalCode: values.postalCode.trim()
            })
          });
        } catch (addressError) {
          setAccountCreated(true);
          setError(`Your account was created, but we couldn't save your delivery address: ${addressError.message} You can add it at checkout.`);
          return;
        }
      }

      await refresh().catch(() => {});
      navigate("/shop/fruits");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const photo = isRegister
    ? "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=1400&q=90"
    : "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=90";
  return <div className={`auth-page ${isRegister ? "register-page" : "login-page"}`}>
    <section className="auth-image">
      <img src={photo} alt="Freshly picked fruits and vegetables at a local market" />
      <div className="auth-image-shade"></div>
      <div className="auth-image-copy">
        <span className="auth-photo-kicker"><Leaf size={14} /> A FRESHER WAY TO SHOP</span>
        <h2>Good food.<br /><em>Right at home.</em></h2>
        <p>Picked fresh from your local market, delivered with care.</p>
        <div className="auth-photo-note"><ShieldCheck size={17} /><span><b>Hand-picked after you order</b><small>Quality checked. Prices confirmed with you.</small></span></div>
      </div>
      <span className="auth-image-orbit auth-orbit-one"></span><span className="auth-image-orbit auth-orbit-two"></span>
    </section>
    <section className="auth-panel">
      <div className="auth-form-wrap">
        <div className="auth-card-brand"><span className="auth-card-mark"><Leaf size={17} fill="currentColor" /></span><span>MARKET FRESH DELIVERY</span></div>
        <span className="eyebrow">{isRegister ? "JOIN YOUR NEIGHBORHOOD MARKET" : "WELCOME BACK"}</span>
        <h1>{isRegister ? "Create your account" : "Good to see you."}</h1>
        <p>{isRegister ? "A few details and your next market run is sorted." : "Sign in to see what's fresh at the market."}</p>
        {accountCreated ? <div className="registration-result" role="status"><div className="registration-result-icon"><Check size={19} /></div><div><b>Your account is ready.</b><p>{error}</p></div><Link className="button button-register" to="/shop/fruits">Continue shopping <ArrowRight size={16} /></Link></div> :
          <form onSubmit={submit} className="auth-form registration-form">
            {isRegister && <>
              <label className="auth-field"><span>Full name</span><span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" required minLength={2} maxLength={100} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} placeholder="e.g. Maya Patel" /></span></label>
              <label className="auth-field"><span>Mobile number</span><span className="auth-input-wrap"><Phone size={17} /><input autoComplete="tel" type="tel" inputMode="tel" required minLength={7} maxLength={30} pattern="[0-9+\s\x28\x29\x2e\x2d]{7,30}" title="Enter a valid mobile number." value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} placeholder="+91 98765 43210" /></span></label>
            </>}
            <label className="auth-field"><span>Email address</span><span className="auth-input-wrap"><Mail size={17} /><input type="email" autoComplete="email" required maxLength={254} value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} placeholder="you@example.com" /></span></label>
            <label className="auth-field"><span>Password</span><span className="auth-input-wrap"><LockKeyhole size={17} /><input type={showPassword ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} required minLength={isRegister ? 8 : 1} maxLength={128} value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} placeholder={isRegister ? "At least 8 characters" : "Your password"} />{isRegister && <button className="password-visibility" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>}</span>{isRegister && <small className="field-hint">Use at least 8 characters.</small>}</label>
            {isRegister && <fieldset className="delivery-address-fields"><legend><MapPin size={15} /> Delivery address</legend><label className="auth-field"><span>Street address</span><span className="auth-input-wrap"><MapPin size={17} /><input autoComplete="street-address" required maxLength={200} value={values.line1} onChange={(e) => setValues({ ...values, line1: e.target.value })} placeholder="House number and street" /></span></label><div className="address-fields-row"><label className="auth-field"><span>City</span><span className="auth-input-wrap"><input autoComplete="address-level2" required minLength={2} maxLength={100} value={values.city} onChange={(e) => setValues({ ...values, city: e.target.value })} placeholder="City" /></span></label><label className="auth-field"><span>State</span><span className="auth-input-wrap"><input autoComplete="address-level1" required minLength={2} maxLength={100} value={values.state} onChange={(e) => setValues({ ...values, state: e.target.value })} placeholder="State" /></span></label><label className="auth-field"><span>Postal code</span><span className="auth-input-wrap"><input autoComplete="postal-code" inputMode="numeric" required minLength={3} maxLength={20} value={values.postalCode} onChange={(e) => setValues({ ...values, postalCode: e.target.value })} placeholder="Postal code" /></span></label></div></fieldset>}
            {error && <div className="registration-error" role="alert"><span>!</span>{error}</div>}
            <button className={`button ${isRegister ? "button-register" : "button-dark"} button-full registration-submit`} disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin" /> Creating your account…</> : isRegister ? <>Register now <ArrowRight size={18} /></> : <>Sign in <ArrowRight size={17} /></>}</button>
          </form>}
        {!accountCreated && <div className="auth-switch">{isRegister ? <>Already have an account? <Link to="/login">Login here</Link></> : <>New to Market Fresh? <Link to="/register">Create an account</Link></>}</div>}
        <div className="auth-secure"><ShieldCheck size={15} /> Your details are kept safe and secure.</div>
      </div>
    </section>
  </div>;
}

function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => { if (user?.role === "user") api("/orders").then(setOrders).catch((e) => setError(e.message)); }, [user]);
  if (!user) return <div className="wrap page-wrap"><div className="empty-state"><h2>Your orders live here.</h2><p>Sign in to check on your market runs.</p><Link className="button button-dark" to="/login">Sign in</Link></div></div>;
  return <div className="wrap page-wrap orders-page"><div className="page-title"><span className="eyebrow">YOUR MARKET RUNS</span><h1>Good things, on the way.</h1><p>All your orders, right where you left them.</p></div>{error && <div className="inline-error">{error}</div>}{orders.length ? <div className="orders-list">{orders.map((order) => <OrderCard key={order._id} order={order} />)}</div> : <div className="empty-state"><span className="empty-icon"><PackageCheck /></span><h3>Your order story starts here.</h3><p>Once you place your first order, you can follow every step from this page.</p><Link className="button button-dark" to="/shop/fruits">Shop the market <ArrowRight size={16} /></Link></div>}</div>;
}

function OrderCard({ order }) {
  const statusCopy = { placed: "Order Placed", confirmed: "Order Confirmed", purchasing: "Market Purchasing", quality_check: "Quality Checking", packed: "Packed", out_for_delivery: "Out for Delivery", delivered: "Delivered", cancelled: "Cancelled" };
  const approvalPending = order.priceApproval === "pending";
  return <Link to={`/orders/${order._id}`} className="order-card"><div className="order-card-top"><span className={`status-pill status-${approvalPending ? "price_approval" : order.status}`}><span></span>{approvalPending ? "Price approval needed" : statusCopy[order.status] || order.status}</span><small>ORDER #{order._id.slice(-8).toUpperCase()}</small></div><div className="order-card-items">{order.items.slice(0, 4).map((item, i) => <img key={i} src={item.image || FALLBACK_IMAGE} alt="" onError={(e) => { e.currentTarget.src = FALLBACK_IMAGE; }} />)}<span>{order.items.length} {order.items.length === 1 ? "item" : "items"}</span></div><div className="order-card-bottom"><span>{new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span><b>{money(order.total)}</b><span className="order-view-link">Track order <ArrowRight size={15} /></span></div></Link>;
}

function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchParams] = useSearchParams();
  const [notice, setNotice] = useState(searchParams.get("payment") === "success" ? "Payment is processing. Your status will update once Stripe confirms it." : searchParams.get("payment") === "cancelled" ? "Payment was cancelled. You can try again when you're ready." : "");
  const load = useCallback(() => api(`/orders/${id}`).then(setOrder).catch((e) => setError(e.message)), [id]);
  useEffect(() => { if (user?.role === "user") { load(); const interval = window.setInterval(load, 15000); return () => window.clearInterval(interval); } }, [user, load]);
  async function approvePrice(approve) {
    setBusy(true); setError("");
    try { setOrder(await api(`/orders/${id}/price-approval`, { method: "POST", body: JSON.stringify({ approve }) })); setNotice(approve ? "Market prices approved. Your team is getting your order ready." : "Order cancelled because the updated prices were declined."); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function cancelOrder() {
    if (!window.confirm("Cancel this order?")) return;
    setBusy(true);
    try { setOrder(await api(`/orders/${id}/cancel`, { method: "POST" })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function payOnline() {
    setBusy(true); setError("");
    try { const result = await api(`/payments/checkout/${id}`, { method: "POST" }); window.location.assign(result.url); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  if (!user) return <div className="wrap page-wrap"><div className="empty-state"><h2>Sign in to track your order.</h2><Link to="/login" className="button button-dark">Sign in</Link></div></div>;
  if (error && !order) return <div className="wrap page-wrap"><div className="inline-error">{error}</div></div>;
  if (!order) return <div className="loading-screen"><LoaderCircle className="spin" /> Finding your order…</div>;
  const flow = [
    { status: "placed", label: "Order Placed" },
    { status: "confirmed", label: "Order Confirmed" },
    { status: "purchasing", label: "Market Purchasing" },
    { status: "quality_check", label: "Quality Checking" },
    { status: "packed", label: "Packed" },
    { status: "out_for_delivery", label: "Out for Delivery" },
    { status: "otp_verification", label: "OTP Verification" },
    { status: "delivered", label: "Delivered" }
  ];
  const statusForTimeline = order.priceApproval === "pending" ? "quality_check"
    : order.status === "out_for_delivery" && order.deliveryProgress === "arrived" ? "otp_verification"
      : order.status;
  const stateIndex = flow.findIndex((step) => step.status === statusForTimeline);
  const statusLabels = Object.fromEntries(flow.map((step) => [step.status, step.label]));
  return <div className="wrap page-wrap tracking-page"><div className="breadcrumb"><Link to="/">Home</Link><ChevronRight size={14} /><Link to="/orders">My orders</Link><ChevronRight size={14} /> Track order</div><div className="tracking-header"><div><span className="eyebrow">ORDER #{order._id.slice(-8).toUpperCase()}</span><h1>{order.status === "delivered" ? "Delivered with care." : order.status === "cancelled" ? "Order cancelled." : "Your market run is underway."}</h1><p>Placed {new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })}</p></div><span className={`status-pill status-${order.priceApproval === "pending" ? "price_approval" : order.status}`}><span></span>{order.priceApproval === "pending" ? "Price approval needed" : statusLabels[order.status] || order.status.replaceAll("_", " ")}</span></div>{notice && <div className="notice-box"><Check size={17} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div>}{error && <div className="inline-error">{error}</div>}
    {order.status !== "cancelled" && <div className="tracking-timeline" aria-label="Order progress">{flow.map((step, index) => { const complete = stateIndex >= index; const active = index === stateIndex && order.status !== "delivered"; return <div className={`timeline-step ${complete ? "complete" : ""} ${active ? "current" : ""}`} key={step.status}><span className="timeline-dot">{complete ? <Check size={14} /> : index + 1}</span><b>{step.label}</b>{index < flow.length - 1 && <span className={`timeline-line ${complete && stateIndex > index ? "filled" : ""}`}></span>}</div>; })}</div>}
    {order.status === "delivered" && <div className="delivery-confirmation"><span><BadgeCheck size={19} /></span><div><b>Delivery confirmed</b><p>{order.deliveredAt ? new Date(order.deliveredAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }) : "Your order has been delivered."}{order.deliveredBy?.name ? ` · Delivered by ${order.deliveredBy.name}` : ""}</p></div></div>}
    {order.priceApproval === "pending" && <div className="approval-panel"><div className="approval-icon"><Sparkles size={20} /></div><div className="approval-content"><span className="eyebrow">WE FOUND YOUR MARKET PICKS</span><h2>A quick price check.</h2><p>A few market prices changed. Please review your updated total and let us know if you'd like us to continue.</p><div className="updated-items">{order.items.map((item, i) => <div key={i}><span>{item.name} · {item.quantity} {item.unit}</span><span>{money(item.estimatedUnitPrice)} → <b>{money(item.actualUnitPrice ?? item.estimatedUnitPrice)}</b></span></div>)}</div><div className="summary-row"><span>Updated product costs</span><b>{money(order.subtotal)}</b></div><div className="summary-row"><span>Service charge</span><b>{money(order.serviceCharge)}</b></div><div className="summary-total"><span>New total</span><b>{money(order.total)}</b></div><div className="approval-actions"><button className="button button-dark" onClick={() => approvePrice(true)} disabled={busy}>Approve & continue <Check size={16} /></button><button className="button button-outline" onClick={() => approvePrice(false)} disabled={busy}>Decline & cancel</button></div></div></div>}
    <div className="tracking-layout"><div className="tracking-main"><section className="tracking-card"><h2>Your market basket <span>{order.items.length} items</span></h2>{order.items.map((item, i) => <div className="tracking-item" key={i}><img src={item.image || FALLBACK_IMAGE} alt="" onError={(e) => { e.currentTarget.src = FALLBACK_IMAGE; }} /><div><b>{item.name}</b><small>{item.quantity} {item.unit} × {money(item.actualUnitPrice ?? item.estimatedUnitPrice)}</small></div><b>{money(item.lineTotal)}</b></div>)}<div className="tracking-costs"><div><span>Products {order.priceApproval === "pending" ? "(updated)" : ""}</span><b>{money(order.subtotal)}</b></div><div><span>Service charge</span><b>{money(order.serviceCharge)}</b></div><div><span>Delivery</span><b>{money(order.deliveryCharge)}</b></div><div className="tracking-total"><span>Total</span><b>{money(order.total)}</b></div></div><p className="small-muted">Payment: {order.paymentMethod === "cod" ? "Cash on delivery" : "Secure online payment"} · {order.paymentStatus}</p>{order.paymentMethod === "stripe" && order.paymentStatus !== "paid" && ["packed", "out_for_delivery"].includes(order.status) && <button className="button button-dark button-full" onClick={payOnline} disabled={busy}>Pay securely online <ArrowRight size={16} /></button>}{order.paymentMethod === "cod" && <div className="cod-note"><PackageCheck size={16} /> Pay in cash when your order arrives.</div>}{["placed", "confirmed", "purchasing", "quality_check"].includes(order.status) && order.priceApproval !== "pending" && <button className="cancel-order-button" onClick={cancelOrder} disabled={busy}>Cancel this order</button>}</section></div><aside className="tracking-side"><section className="tracking-card"><h3><MapPin size={17} /> Delivering to</h3><b>{order.deliveryAddress.recipient}</b><p>{order.deliveryAddress.line1}{order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ""}<br />{order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.postalCode}</p><small>{order.deliveryAddress.phone}</small></section><section className="tracking-card help-card"><span className="help-icon"><Headphones size={19} /></span><h3>Need a hand?</h3><p>We're real people, happy to help with your order.</p><Link to="/contact">Talk to our team <ArrowRight size={15} /></Link></section></aside></div></div>;
}

function About() {
  return <div className="about-page"><section className="about-hero wrap"><div><span className="eyebrow">A LITTLE ABOUT US</span><h1>Grocery shopping,<br /><em>with a human touch.</em></h1><p>We're not a warehouse. We're the people who walk the market aisles for you — choosing every fruit, vegetable, and pantry staple with a little extra care.</p><Link className="button button-dark" to="/shop/fruits">Meet your market <ArrowRight size={17} /></Link></div><img src="https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1000&q=90" alt="Fresh market shopping" onError={(e) => { e.currentTarget.src = FALLBACK_IMAGE; }} /></section><section className="about-process"><div className="wrap"><SectionHeading eyebrow="SIMPLE, THOUGHTFUL, FRESH" title="Here's how your market run works." description="Your order gets a real person on the other end, every time." /><div className="process-grid">{[[1, "You make your list", "Browse what you're after and place an order. Your prices are estimates from our latest market run.", ShoppingBag], [2, "We hit the market", "A member of our team picks every item fresh, checking quality and the actual market price.", Leaf], [3, "You approve changes", "If prices changed, you review the update before we buy. No surprises, ever.", ShieldCheck], [4, "Fresh arrives home", "We pack it all with care and bring your market basket to your door.", Truck]].map(([num, title, text, Icon]) => <div className="process-card" key={num}><span className="process-number">0{num}</span><span className="process-icon"><Icon size={21} /></span><h3>{title}</h3><p>{text}</p></div>)}</div></div></section><section className="about-values wrap"><div className="values-visual"><img src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1000&q=85" alt="Colorful market produce" /><span>LOCAL<br /><b>MATTERS.</b></span></div><div><span className="eyebrow">ROOTED IN THE NEIGHBORHOOD</span><h2>A better kind of<br />market run.</h2><p>Local markets are full of incredible food and the people behind it. We bring that goodness to your doorstep — supporting our local sellers and giving your family more time for the things that matter.</p><div className="value-stat"><b>Every order.</b><span>Picked to order, never sitting around a warehouse.</span></div><div className="value-stat"><b>Every item.</b><span>Chosen and checked by a real person at the market.</span></div><Link to="/contact" className="arrow-link">Say hello to our team <ArrowRight size={16} /></Link></div></section></div>;
}

function Contact() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setStatus("");
    try { const result = await api("/contact", { method: "POST", body: JSON.stringify(form) }); setStatus(result.message); setForm({ name: "", email: "", subject: "", message: "" }); }
    catch (e) { setStatus(e.message); } finally { setBusy(false); }
  }
  return <div className="contact-page wrap page-wrap"><div className="contact-intro"><span className="eyebrow">WE'RE RIGHT HERE</span><h1>Let's talk<br /><em>fresh.</em></h1><p>Questions about your order? Wondering how it works? We're real people, and we'd love to hear from you.</p><div className="contact-detail"><span><Headphones size={19} /></span><div><small>REAL PEOPLE, REAL HELP</small><b>Reach out and we'll be right back</b></div></div><div className="contact-detail"><span><Clock3 size={19} /></span><div><small>WHEN WE'RE AROUND</small><b>Monday – Saturday, 8 am – 7 pm</b></div></div><div className="contact-detail"><span><MapPin size={19} /></span><div><small>FRESH, FROM YOUR AREA</small><b>Serving our local neighborhoods</b></div></div></div><form className="contact-form" onSubmit={submit}><span className="eyebrow">SEND US A NOTE</span><h2>What's on your mind?</h2><p>We'll get back to you as soon as we can.</p><label>Your name<input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Subject<input required minLength={3} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label><label>Your message<textarea required minLength={10} rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>{status && <div className={status.startsWith("Thanks") ? "form-message success" : "inline-error"}>{status}</div>}<button className="button button-dark button-full" disabled={busy}>{busy ? "Sending…" : <>Send your message <ArrowRight size={17} /></>}</button></form></div>;
}

function AdminLogin() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault(); setError("");
    try { const result = await api("/auth/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }); setUser(result.user); navigate("/admin"); }
    catch (e) { setError(e.message); }
  }
  return <div className="admin-login-wrap"><div className="admin-login-card"><span className="admin-lock"><LockKeyhole size={22} /></span><span className="eyebrow">TEAM ACCESS</span><h1>Welcome behind the scenes.</h1><p>Sign in to manage orders, products, and your market team.</p><form onSubmit={submit} className="auth-form"><label>Admin email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error && <div className="inline-error">{error}</div>}<button className="button button-dark button-full">Sign in to dashboard <ArrowRight size={16} /></button></form><Link to="/" className="back-home">← Back to Market Fresh</Link></div></div>;
}

function DeliveryLogin() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const result = await api("/auth/delivery/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setUser(result.user);
      navigate("/delivery");
    } catch (loginError) { setError(loginError.message); }
  }
  return <div className="admin-login-wrap"><div className="admin-login-card"><span className="admin-lock"><Truck size={22} /></span><span className="eyebrow">DELIVERY TEAM</span><h1>Your delivery route.</h1><p>Sign in to view orders assigned to you and securely confirm deliveries.</p><form onSubmit={submit} className="auth-form"><label>Delivery email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <div className="inline-error">{error}</div>}<button className="button button-dark button-full">Sign in to delivery dashboard <ArrowRight size={16} /></button></form><Link to="/" className="back-home">← Back to Market Fresh</Link></div></div>;
}

function DeliveryDashboard() {
  const { user, setUser } = useAuth();
  const [orders, setOrders] = useState([]);
  const [otpDrafts, setOtpDrafts] = useState({});
  const [failureReasons, setFailureReasons] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setOrders(await api("/delivery/orders")); setError(""); }
    catch (loadError) { setError(loadError.message); }
  }, []);
  useEffect(() => {
    if (user?.role !== "delivery") return undefined;
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [user, load]);
  async function runAction(id, path, body, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await api(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      setNotice(response?.message || successMessage);
      await load();
      return true;
    } catch (actionError) { setError(actionError.message); return false; }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); setUser(null); }
    catch (logoutError) { setError(logoutError.message); }
  }
  const activeOrders = orders.filter((order) => order.status === "out_for_delivery");
  const completedOrders = orders.filter((order) => order.status === "delivered");
  return <div className="wrap page-wrap delivery-page">
    <div className="delivery-heading"><div><span className="eyebrow">DELIVERY TEAM / TODAY</span><h1>Your assigned deliveries.</h1><p>Welcome, {user?.name}. Customer codes are delivered by SMS and are never shown here.</p></div><button type="button" className="button button-outline" onClick={logout}>Sign out</button></div>
    {notice && <div className="notice-box"><Check size={16} />{notice}</div>}
    {error && <div className="inline-error">{error}</div>}
    {activeOrders.length > 0 ? <div className="delivery-order-list">{activeOrders.map((order) => <DeliveryOrderCard
      key={order._id}
      order={order}
      busy={busy}
      otp={otpDrafts[order._id] || ""}
      reason={failureReasons[order._id] || "customer_unavailable"}
      onOtpChange={(value) => setOtpDrafts((drafts) => ({ ...drafts, [order._id]: value.replace(/\D/g, "").slice(0, 6) }))}
      onReasonChange={(value) => setFailureReasons((drafts) => ({ ...drafts, [order._id]: value }))}
      onArrival={() => runAction(order._id, `/delivery/orders/${order._id}/attempt`, { progress: "arrived" }, "Arrival recorded.")}
      onFailure={() => runAction(order._id, `/delivery/orders/${order._id}/attempt`, { progress: "failed", reason: failureReasons[order._id] || "customer_unavailable" }, "Delivery attempt recorded.")}
      onResend={() => runAction(order._id, `/delivery/orders/${order._id}/delivery-otp`, null, "A new code was sent to the customer's registered mobile number.")}
      onDeliver={() => runAction(order._id, `/delivery/orders/${order._id}/deliver`, { otp: otpDrafts[order._id] || "" }, "Delivery confirmed.")}
    />)}</div> : <div className="empty-state"><span className="empty-icon"><PackageCheck /></span><h2>No active deliveries.</h2><p>New orders assigned to you will appear here.</p></div>}
    {completedOrders.length > 0 && <section className="delivery-completed"><h2>Recently completed</h2>{completedOrders.slice(0, 10).map((order) => <div key={order._id}><span>#{order._id.slice(-8).toUpperCase()} · {order.deliveryAddress.recipient}</span><b>{order.deliveredAt ? new Date(order.deliveredAt).toLocaleString("en-IN") : "Delivered"}</b></div>)}</section>}
  </div>;
}

function DeliveryOrderCard({ order, busy, otp, reason, onOtpChange, onReasonChange, onArrival, onFailure, onResend, onDeliver }) {
  const address = order.deliveryAddress;
  return <article className="delivery-order-card">
    <div className="delivery-order-head"><div><span className="eyebrow">ORDER #{order._id.slice(-8).toUpperCase()}</span><h2>{address.recipient}</h2><p>{order.user?.name} · {new Date(order.createdAt).toLocaleDateString("en-IN")}</p></div><span className="status-pill status-out_for_delivery"><span></span>Out for delivery</span></div>
    <div className="delivery-order-details"><section><h3><MapPin size={16} /> Delivery address</h3><p>{address.line1}{address.line2 ? `, ${address.line2}` : ""}<br />{address.city}, {address.state} {address.postalCode}</p><a href={`tel:${address.phone}`}><Phone size={14} /> {address.phone}</a></section><section><h3><PackageCheck size={16} /> Order details</h3><ul>{order.items.map((item, index) => <li key={`${item.name}-${index}`}>{item.name} × {item.quantity} {item.unit}</li>)}</ul><b>Total {money(order.total)} · {order.paymentMethod === "cod" ? "Cash on delivery" : order.paymentStatus}</b></section></div>
    {order.deliveryProgress === "arrived" ? <div className="delivery-otp-entry"><label>Customer's 6-digit delivery code<input inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={otp} onChange={(event) => onOtpChange(event.target.value)} placeholder="Enter code from customer" /></label><button className="button button-dark" disabled={busy || !/^\d{6}$/.test(otp)} onClick={onDeliver}>Verify & complete delivery <Check size={15} /></button><button type="button" className="table-action" disabled={busy} onClick={onResend}>Send a new customer code</button></div> : <div className="delivery-arrival-actions"><button type="button" className="button button-dark" disabled={busy} onClick={onArrival}><MapPin size={15} /> Record arrival at address</button><label>Unable to deliver<select value={reason} onChange={(event) => onReasonChange(event.target.value)}><option value="customer_unavailable">Customer unavailable</option><option value="address_issue">Address issue</option><option value="customer_rescheduled">Customer rescheduled</option><option value="other">Other reason</option></select></label><button type="button" className="table-action danger" disabled={busy} onClick={onFailure}>Record failed attempt</button></div>}
    <p className="delivery-security-note"><LockKeyhole size={14} /> The code is verified securely by the server; order status changes only after a valid code.</p>
  </article>;
}

function DeliveryManagement({ deliveryPersonnel, onCreate, onToggle, onPasswordChange, busy }) {
  const [draft, setDraft] = useState({ name: "", email: "", phone: "", password: "" });
  const [passwordDrafts, setPasswordDrafts] = useState({});
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setNotice("");
    setFormError("");
    try {
      await onCreate(draft);
      setDraft({ name: "", email: "", phone: "", password: "" });
      setNotice("Delivery account created. Share its credentials securely with the team member.");
    } catch (error) { setFormError(error.message); }
  }
  async function changePassword(person) {
    const password = passwordDrafts[person.id || person._id] || "";
    if (password.length < 8) { setFormError("A delivery password must be at least 8 characters."); return; }
    try {
      await onPasswordChange(person.id || person._id, password);
      setPasswordDrafts((drafts) => ({ ...drafts, [person.id || person._id]: "" }));
      setNotice(`Password updated for ${person.name}.`);
      setFormError("");
    } catch (error) { setFormError(error.message); }
  }
  return <div className="delivery-management">
    <div className="admin-section-heading"><div><span className="eyebrow">DELIVERY TEAM</span><h1>People behind every doorstep.</h1><p>Create delivery logins, reset passwords, and deactivate accounts when access should end.</p></div></div>
    {notice && <div className="notice-box"><Check size={16} />{notice}</div>}
    {formError && <div className="inline-error">{formError}</div>}
    <form className="admin-edit-form delivery-create-form" onSubmit={submit}>
      <div className="panel-heading"><div><span className="eyebrow">NEW ACCOUNT</span><h3>Add a delivery person</h3></div></div>
      <div className="admin-form-grid"><label>Full name<input required minLength="2" maxLength="100" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Email<input type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label><label>Phone<input type="tel" required minLength="7" maxLength="30" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label><label>Temporary password<input type="password" required minLength="8" maxLength="128" autoComplete="new-password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></label></div>
      <button className="button button-dark" disabled={busy}>Create delivery account <Plus size={15} /></button>
    </form>
    <section className="admin-panel delivery-people-panel"><div className="panel-heading"><div><span className="eyebrow">ACCOUNTS</span><h3>Delivery personnel</h3></div><span>{deliveryPersonnel.length} total</span></div>
      {deliveryPersonnel.length ? deliveryPersonnel.map((person) => {
        const personId = person.id || person._id;
        return <div className="delivery-person-row" key={personId}><span className="admin-user-avatar">{person.name.slice(0, 1)}</span><div className="delivery-person-info"><b>{person.name}</b><small>{person.email} · {person.phone}</small></div><span className={`status-pill ${person.active ? "status-delivered" : "status-cancelled"}`}><span></span>{person.active ? "Active" : "Inactive"}</span><input aria-label={`New password for ${person.name}`} type="password" minLength="8" maxLength="128" placeholder="Reset password" autoComplete="new-password" value={passwordDrafts[personId] || ""} onChange={(event) => setPasswordDrafts({ ...passwordDrafts, [personId]: event.target.value })} /><button type="button" className="table-action" disabled={busy || (passwordDrafts[personId] || "").length < 8} onClick={() => changePassword(person)}>Reset</button><button type="button" className="table-action" disabled={busy} onClick={() => onToggle(person)}>{person.active ? "Deactivate" : "Activate"}</button></div>;
      }) : <p className="small-muted">No delivery accounts yet.</p>}
    </section>
  </div>;
}

function ProductManagement({
  products,
  allProducts,
  productCount,
  categories,
  search,
  setSearch,
  categoryFilter,
  setCategoryFilter,
  stockFilter,
  setStockFilter,
  editProduct,
  setEditProduct,
  saveProduct,
  removeProduct,
  busy
}) {
  const availableCount = allProducts.filter((product) => product.inStock).length;
  const outOfStockCount = allProducts.length - availableCount;
  const formValue = (key) => editProduct[key] ?? "";
  const updateProduct = (key, value) => setEditProduct((current) => ({ ...current, [key]: value }));

  return <>
    <div className="admin-section-heading">
      <div>
        <span className="eyebrow">THE MARKET SHELF</span>
        <h1>Product management.</h1>
        <p>Add listings, edit prices and images, and keep inventory up to date.</p>
      </div>
      <button className="button button-dark" onClick={() => setEditProduct({
        name: "", description: "", category: categories[0]?._id || "", price: "", unit: "kg",
        image: "", stockQuantity: "0", inStock: false, featured: false
      })} disabled={!categories.length}>
        <Plus size={16} /> Add a product
      </button>
    </div>
    <div className="product-management-stats">
      <div><span>Products in catalog</span><strong>{productCount}</strong></div>
      <div><span>Available</span><strong>{availableCount}</strong></div>
      <div><span>Unavailable</span><strong>{outOfStockCount}</strong></div>
    </div>
    {!categories.length && <div className="inline-error">No supported categories were found. Run the existing catalog seed before adding products.</div>}
    {editProduct && <form className="admin-edit-form product-editor" onSubmit={saveProduct}>
      <div className="panel-heading">
        <div><span className="eyebrow">{editProduct._id ? "UPDATE YOUR CATALOG" : "NEW MARKET PICK"}</span><h3>{editProduct._id ? "Edit product" : "Add a product"}</h3></div>
        <button type="button" className="icon-button" aria-label="Close product form" onClick={() => setEditProduct(null)}><X size={18} /></button>
      </div>
      <div className="admin-form-grid product-form-grid">
        <label>Product name<input required minLength="2" maxLength="140" value={formValue("name")} onChange={(event) => updateProduct("name", event.target.value)} placeholder="e.g. Fresh guava" /></label>
        <label>Category<select required value={formValue("category")} onChange={(event) => updateProduct("category", event.target.value)}>
          <option value="" disabled>Select a category</option>
          {categories.map((category) => <option key={category._id} value={category._id}>{category.name}</option>)}
        </select></label>
        <label>Price (₹)<input required type="number" min="0" max="10000000" step="0.01" value={formValue("price")} onChange={(event) => updateProduct("price", event.target.value)} placeholder="0.00" /></label>
        <label>Price unit<input required maxLength="20" value={formValue("unit")} onChange={(event) => updateProduct("unit", event.target.value)} placeholder="kg, bunch, dozen…" /></label>
        <label>Stock quantity <span className="product-label-hint">Leave blank for untracked legacy items</span><input type="number" min="0" max="100000" step="1" value={formValue("stockQuantity")} onChange={(event) => updateProduct("stockQuantity", event.target.value)} placeholder="Enter available quantity" /></label>
        <label>Product image URL<input type="url" maxLength="2048" value={formValue("image")} onChange={(event) => updateProduct("image", event.target.value)} placeholder="https://…" /></label>
        <label className="product-description-field">Description<textarea maxLength="3000" rows="3" value={formValue("description")} onChange={(event) => updateProduct("description", event.target.value)} placeholder="Describe this product for customers" /></label>
      </div>
      {formValue("image") && <div className="product-image-preview"><img src={formValue("image")} alt="Product image preview" onError={(event) => { event.currentTarget.src = FALLBACK_IMAGE; }} /><span>Image preview</span></div>}
      <div className="admin-toggle-row product-editor-actions">
        <label><input type="checkbox" checked={Boolean(editProduct.inStock) && (formValue("stockQuantity") === "" || Number(formValue("stockQuantity")) > 0)} disabled={formValue("stockQuantity") !== "" && Number(formValue("stockQuantity")) === 0} onChange={(event) => updateProduct("inStock", event.target.checked)} /> Available to customers</label>
        <label><input type="checkbox" checked={Boolean(editProduct.featured)} onChange={(event) => updateProduct("featured", event.target.checked)} /> Feature on storefront</label>
        <div className="product-form-buttons">
          <button type="button" className="button button-outline" onClick={() => setEditProduct(null)} disabled={busy}>Cancel</button>
          <button className="button button-dark" disabled={busy || !categories.length}>{busy ? "Saving…" : editProduct._id ? "Save changes" : "Create product"}</button>
        </div>
      </div>
      {formValue("stockQuantity") !== "" && Number(formValue("stockQuantity")) === 0 && <p className="product-stock-note">Quantity is zero, so this product will be marked unavailable.</p>}
    </form>}
    <div className="product-catalog-toolbar">
      <label className="product-search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products by name" /></label>
      <label>Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
        <option value="all">All categories</option>
        {categories.map((category) => <option key={category._id} value={category.slug}>{category.name}</option>)}
      </select></label>
      <label>Availability<select value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}>
        <option value="all">All products</option><option value="available">Available</option><option value="unavailable">Unavailable</option>
      </select></label>
      <span>{products.length} shown</span>
    </div>
    <div className="admin-panel admin-table-wrap product-catalog-table">
      <table className="data-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock quantity</th><th>Availability</th><th>Featured</th><th>Actions</th></tr></thead>
        <tbody>{products.map((product) => <tr key={product._id}>
          <td><div className="table-product"><img src={product.image || FALLBACK_IMAGE} alt="" onError={(event) => { event.currentTarget.src = FALLBACK_IMAGE; }} /><span><b>{product.name}</b><small>per {product.unit}</small></span></div></td>
          <td>{product.category?.name}</td><td><b>{money(product.price)}</b></td>
          <td>{product.stockQuantity == null ? "Not tracked" : product.stockQuantity}</td>
          <td><span className={`status-pill ${product.inStock ? "status-delivered" : "status-cancelled"}`}><span></span>{product.inStock ? "Available" : "Unavailable"}</span></td>
          <td>{product.featured ? "Yes" : "—"}</td>
          <td className="product-row-actions">
            <button className="table-action" onClick={() => setEditProduct({ ...product, price: String(product.price), stockQuantity: product.stockQuantity == null ? "" : String(product.stockQuantity), category: product.category?._id || "" })}>Edit</button>
            <button className="table-action danger" onClick={() => removeProduct(product._id)} disabled={busy}>Delete</button>
          </td>
        </tr>)}
        {!products.length && <tr><td className="product-empty-row" colSpan="7">No products match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  </>;
}

function AdminDashboard() {
  const { user, setUser } = useAuth();
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [deliveryPersonnel, setDeliveryPersonnel] = useState([]);
  const [messages, setMessages] = useState([]);
  const [settings, setSettings] = useState({ serviceChargePercent: 5 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [editCategory, setEditCategory] = useState(null);
  const [priceDrafts, setPriceDrafts] = useState({});
  const [filter, setFilter] = useState("all");
  const [productSearch, setProductSearch] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [productStockFilter, setProductStockFilter] = useState("all");
  const load = useCallback(async () => {
    try {
      const [s, o, p, c, u, d, g, m] = await Promise.all([
        api("/admin/summary"), api("/admin/orders"), api("/admin/products"), api("/categories"), api("/admin/customers"), api("/admin/delivery-personnel"), api("/admin/settings"), api("/admin/messages")
      ]);
      setSummary(s); setOrders(o); setProducts(p); setCategories(c); setCustomers(u); setDeliveryPersonnel(d); setSettings(g); setMessages(m);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => {
    if (user?.role !== "admin") return undefined;
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [user, load]);
  async function updateOrder(id, body) {
    setBusy(true); setError("");
    try { await api(`/admin/orders/${id}`, { method: "PATCH", body: JSON.stringify(body) }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function createDeliveryPerson(body) {
    setBusy(true); setError("");
    try { await api("/admin/delivery-personnel", { method: "POST", body: JSON.stringify(body) }); await load(); }
    catch (e) { setError(e.message); throw e; } finally { setBusy(false); }
  }
  async function toggleDeliveryPerson(person) {
    setBusy(true); setError("");
    try { await api(`/admin/delivery-personnel/${person.id}`, { method: "PATCH", body: JSON.stringify({ active: !person.active }) }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function changeDeliveryPassword(id, password) {
    setBusy(true); setError("");
    try { await api(`/admin/delivery-personnel/${id}`, { method: "PATCH", body: JSON.stringify({ password }) }); await load(); }
    catch (e) { setError(e.message); throw e; } finally { setBusy(false); }
  }
  async function removeProduct(id) {
    const product = products.find((item) => item._id === id);
    if (!window.confirm(`Delete "${product?.name || "this product"}"? It will also be removed from customer carts.`)) return;
    setBusy(true); setError("");
    try { await api(`/products/${id}`, { method: "DELETE" }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function saveProduct(e) {
    e.preventDefault(); setBusy(true); setError("");
    const payload = {
      ...editProduct,
      price: Number(editProduct.price),
      stockQuantity: editProduct.stockQuantity === "" ? null : Number(editProduct.stockQuantity),
      inStock: Boolean(editProduct.inStock) && (editProduct.stockQuantity === "" || Number(editProduct.stockQuantity) > 0),
      featured: Boolean(editProduct.featured)
    };
    try {
      if (editProduct._id) await api(`/products/${editProduct._id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/products", { method: "POST", body: JSON.stringify(payload) });
      setEditProduct(null); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function saveCategory(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await api(`/categories/${editCategory._id}`, { method: "PUT", body: JSON.stringify(editCategory) });
      setEditCategory(null); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function saveSettings(e) {
    e.preventDefault();
    try { setSettings(await api("/admin/settings", { method: "PUT", body: JSON.stringify({ serviceChargePercent: Number(settings.serviceChargePercent) }) })); await load(); }
    catch (e) { setError(e.message); }
  }
  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); setUser(null); }
    catch (e) { setError(e.message); }
  }
  const shownOrders = filter === "all" ? orders : filter === "price_approval"
    ? orders.filter((order) => order.priceApproval === "pending")
    : orders.filter((order) => order.status === filter);
  const shownProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch = !query || product.name.toLowerCase().includes(query);
      const matchesCategory = productCategoryFilter === "all" || product.category?.slug === productCategoryFilter;
      const matchesStock = productStockFilter === "all"
        || (productStockFilter === "available" ? product.inStock : !product.inStock);
      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [products, productSearch, productCategoryFilter, productStockFilter]);
  if (error && !summary) return <div className="wrap page-wrap"><div className="inline-error">{error}</div></div>;
  return <div className="admin-shell"><aside className="admin-sidebar"><Link to="/" className="brand"><span className="brand-mark"><Leaf size={21} fill="currentColor" /></span><span>market<span className="brand-light">fresh</span><small>TEAM DASHBOARD</small></span></Link><div className="admin-nav-label">WORKSPACE</div>{[["overview", "Overview"], ["orders", "Orders"], ["delivery", "Delivery"], ["products", "Products"], ["categories", "Categories"], ["customers", "Customers"], ["reports", "Reports"], ["messages", "Messages"]].map(([key, label]) => <button key={key} className={`admin-nav-item ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}><span className="admin-nav-dot"></span>{label}{key === "orders" && summary?.pending > 0 && <b>{summary.pending}</b>}</button>)}<div className="admin-sidebar-bottom"><span className="admin-user-avatar">{user?.name?.slice(0, 1)}</span><span><b>{user?.name}</b><small>Store administrator</small></span><button className="admin-logout" onClick={logout} aria-label="Sign out"><ArrowUpRight size={16} /></button></div></aside><div className="admin-main"><header className="admin-topbar"><div><span className="admin-top-kicker">MARKET FRESH / WORKSPACE</span><h2>{tab[0].toUpperCase() + tab.slice(1)}</h2></div><select className="admin-mobile-nav" value={tab} onChange={(event) => setTab(event.target.value)} aria-label="Admin section"><option value="overview">Overview</option><option value="orders">Orders</option><option value="delivery">Delivery</option><option value="products">Products</option><option value="categories">Categories</option><option value="customers">Customers</option><option value="reports">Reports</option><option value="messages">Messages</option></select><div className="admin-top-right"><span className="admin-live"><i></i> Store is live</span><Link to="/" className="view-store">View store <ArrowUpRight size={15} /></Link></div></header><div className="admin-content">{error && <div className="inline-error">{error}<button onClick={() => setError("")}><X size={14} /></button></div>}
    {tab === "overview" && <><div className="admin-welcome"><div><span className="eyebrow">YOUR MARKET, AT A GLANCE</span><h1>Good morning, {user?.name?.split(" ")[0]} <span>✳</span></h1><p>Here's what's happening with your market runs today.</p></div><span className="admin-date">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span></div><div className="stat-grid">{[["Orders to prepare", summary?.pending ?? "—", "Need a little attention", PackageCheck, "sage"], ["Market runs", orders.filter((o) => ["purchasing", "quality_check"].includes(o.status)).length, "In progress now", Leaf, "peach"], ["Happy customers", summary?.customers ?? "—", "People who shop local", Heart, "lavender"], ["Sales collected", money(summary?.revenue), "Paid & delivered orders", ArrowUpRight, "mint"]].map(([label, value, note, Icon, color]) => <div className="stat-card" key={label}><div className={`stat-icon ${color}`}><Icon size={19} /></div><span className="stat-label">{label}</span><b className="stat-number">{value}</b><small>{note}</small></div>)}</div><div className="admin-overview-grid"><section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">THE LATEST</span><h3>Recent orders</h3></div><button className="panel-link" onClick={() => setTab("orders")}>All orders <ArrowRight size={15} /></button></div><OrdersTable orders={orders.slice(0, 5)} compact /></section><section className="admin-panel market-panel"><span className="eyebrow">GOOD WORK, GOOD FOOD</span><h3>Every order is<br />a neighborhood<br /><em>market run.</em></h3><div className="market-panel-note"><span><Leaf size={17} /></span><p>Hand-picked by your team, fresh from the local market.</p></div><div className="market-panel-shape"><Leaf /></div></section></div><section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">FRESHLY ADDED</span><h3>Your market favorites</h3></div><button className="panel-link" onClick={() => setTab("products")}>Manage products <ArrowRight size={15} /></button></div><div className="admin-mini-products">{products.slice(0, 4).map((product) => <div key={product._id}><img src={product.image || FALLBACK_IMAGE} alt="" onError={(e) => { e.currentTarget.src = FALLBACK_IMAGE; }} /><span><b>{product.name}</b><small>{product.category?.name} · {product.unit}</small></span><strong>{money(product.price)}</strong></div>)}</div></section></>}
    {tab === "orders" && <><div className="admin-section-heading"><div><span className="eyebrow">THE MARKET RUNS</span><h1>Orders from your neighbors.</h1><p>Track each basket from order to doorstep.</p></div></div><div className="admin-filter-row">{["all", "placed", "confirmed", "purchasing", "quality_check", "price_approval", "packed", "out_for_delivery", "delivered", "cancelled"].map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status === "all" ? "All orders" : status === "price_approval" ? "price approval" : status.replaceAll("_", " ")}</button>)}</div><OrdersTable orders={shownOrders} deliveryPersonnel={deliveryPersonnel} onUpdate={updateOrder} busy={busy} /></>}
    {tab === "delivery" && <DeliveryManagement deliveryPersonnel={deliveryPersonnel} onCreate={createDeliveryPerson} onToggle={toggleDeliveryPerson} onPasswordChange={changeDeliveryPassword} busy={busy} />}
    {tab === "products" && <ProductManagement
      products={shownProducts}
      allProducts={products}
      productCount={products.length}
      categories={categories}
      search={productSearch}
      setSearch={setProductSearch}
      categoryFilter={productCategoryFilter}
      setCategoryFilter={setProductCategoryFilter}
      stockFilter={productStockFilter}
      setStockFilter={setProductStockFilter}
      editProduct={editProduct}
      setEditProduct={setEditProduct}
      saveProduct={saveProduct}
      removeProduct={removeProduct}
      busy={busy}
    />}
    {tab === "categories" && <>
      <div className="admin-section-heading"><div><span className="eyebrow">STORE CATEGORIES</span><h1>Fruits, Vegetables, and Groceries.</h1><p>These are the only product categories supported in the market.</p></div></div>
      {editCategory && <form className="admin-edit-form" onSubmit={saveCategory}>
        <div className="panel-heading"><div><span className="eyebrow">CATEGORY DETAILS</span><h3>Edit {editCategory.name}</h3></div><button type="button" className="icon-button" aria-label="Close category form" onClick={() => setEditCategory(null)}><X size={18} /></button></div>
        <div className="admin-form-grid">
          <label>Category name<input disabled value={editCategory.name} /></label>
          <label>URL slug<input disabled value={editCategory.slug} /></label>
          <label>Description<input maxLength="500" value={editCategory.description || ""} onChange={(event) => setEditCategory({ ...editCategory, description: event.target.value })} /></label>
          <label>Category image URL<input type="url" value={editCategory.image || ""} onChange={(event) => setEditCategory({ ...editCategory, image: event.target.value })} /></label>
        </div>
        <div className="product-form-buttons"><button type="button" className="button button-outline" onClick={() => setEditCategory(null)}>Cancel</button><button className="button button-dark" disabled={busy}>Save category details</button></div>
      </form>}
      <div className="admin-category-grid">{categories.map((category) => <div className="admin-category-card" key={category._id}>
        <img src={category.image || FALLBACK_IMAGE} alt="" onError={(event) => { event.currentTarget.src = FALLBACK_IMAGE; }} />
        <div><span className="eyebrow">/{category.slug}</span><h3>{category.name}</h3><p>{category.description}</p><button className="table-action" onClick={() => setEditCategory({ ...category })}>Edit details</button></div>
      </div>)}</div>
    </>}
    {tab === "customers" && <><div className="admin-section-heading"><div><span className="eyebrow">YOUR NEIGHBORS</span><h1>The people behind the baskets.</h1><p>Customers who make your local market run special.</p></div></div><div className="admin-panel admin-table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Joined</th><th>Orders</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer._id}><td><b>{customer.name}</b></td><td>{customer.email}</td><td>{customer.phone}</td><td>{new Date(customer.createdAt).toLocaleDateString("en-IN")}</td><td>{orders.filter((order) => order.user?._id === customer._id).length}</td></tr>)}</tbody></table></div></>}
    {tab === "reports" && <><div className="admin-section-heading"><div><span className="eyebrow">THE BIGGER PICTURE</span><h1>Good things, adding up.</h1><p>A simple snapshot of how your market is doing.</p></div></div><div className="stat-grid"><div className="stat-card"><div className="stat-icon sage"><PackageCheck size={19} /></div><span className="stat-label">Total orders</span><b className="stat-number">{summary?.orders ?? 0}</b><small>All time</small></div><div className="stat-card"><div className="stat-icon mint"><ArrowUpRight size={19} /></div><span className="stat-label">Collected revenue</span><b className="stat-number">{money(summary?.revenue)}</b><small>Confirmed payments</small></div><div className="stat-card"><div className="stat-icon peach"><Check size={19} /></div><span className="stat-label">Delivered</span><b className="stat-number">{summary?.delivered ?? 0}</b><small>Happy doorsteps</small></div><div className="stat-card"><div className="stat-icon lavender"><Heart size={19} /></div><span className="stat-label">Customers</span><b className="stat-number">{summary?.customers ?? 0}</b><small>Local shoppers</small></div></div><form className="admin-edit-form settings-form" onSubmit={saveSettings}><span className="eyebrow">TRANSPARENT PRICING</span><h3>Service charge</h3><p>A clear service charge helps cover the market run, quality checks, and delivery coordination.</p><label>Service charge (%)<input type="number" min="0" max="50" step="0.25" value={settings.serviceChargePercent} onChange={(e) => setSettings({ ...settings, serviceChargePercent: e.target.value })} /></label><button className="button button-dark">Save service charge</button></form><section className="admin-panel"><div className="panel-heading"><div><span className="eyebrow">ORDER ACTIVITY</span><h3>All-time order statuses</h3></div></div><div className="report-status-grid">{["placed", "confirmed", "purchasing", "quality_check", "price_approval", "packed", "out_for_delivery", "delivered", "cancelled"].map((status) => <div key={status}><span>{status === "price_approval" ? "Price approval needed" : status === "confirmed" ? "Order confirmed" : status.replaceAll("_", " ")}</span><b>{status === "price_approval" ? orders.filter((order) => order.priceApproval === "pending").length : orders.filter((order) => order.status === status).length}</b></div>)}</div></section></>}
    {tab === "messages" && <><div className="admin-section-heading"><div><span className="eyebrow">A NOTE FROM THE NEIGHBORHOOD</span><h1>Messages from your customers.</h1><p>Customer support requests are kept here for your team.</p></div><span className="admin-date">{messages.length} messages</span></div><div className="message-list">{messages.map((message) => <article className="message-card" key={message._id}><div><b>{message.subject}</b><small>{message.name} · {message.email} · {new Date(message.createdAt).toLocaleString("en-IN")}</small></div><p>{message.message}</p><a href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`}>Reply by email <ArrowUpRight size={14} /></a></article>)}</div></>}
  </div></div></div>;
}

function OrdersTable({ orders, deliveryPersonnel = [], onUpdate, compact = false, busy = false }) {
  const [expanded, setExpanded] = useState("");
  const [priceDrafts, setPriceDrafts] = useState({});
  if (!orders.length) return <div className="empty-note admin-empty">No orders here just yet.</div>;
  const statusOptions = [["placed", "Order Placed"], ["confirmed", "Order Confirmed"], ["purchasing", "Market Purchasing"], ["quality_check", "Quality Checking"], ["packed", "Packed"], ["out_for_delivery", "Out for Delivery"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]];
  const nextStatus = {
    placed: ["confirmed", "cancelled"],
    confirmed: ["purchasing", "cancelled"],
    purchasing: ["quality_check", "cancelled"],
    quality_check: ["packed", "cancelled"],
    packed: ["out_for_delivery", "cancelled"],
    out_for_delivery: ["delivered"],
    delivered: [],
    cancelled: []
  };
  return <div className="admin-panel admin-table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th>{!compact && <th>Market & delivery</th>}</tr></thead><tbody>{orders.map((order) => {
    const approvalPending = order.priceApproval === "pending";
    const canSetMarketPrices = ["purchasing", "quality_check"].includes(order.status) && order.paymentStatus !== "paid";
    const options = approvalPending
      ? statusOptions.filter(([value]) => value === order.status || value === "cancelled")
      : statusOptions.filter(([value]) => value === order.status || (value !== "delivered" && nextStatus[order.status]?.includes(value)));
    return <Fragment key={order._id}>
      <tr className="order-table-row">
        <td><b>#{order._id.slice(-8).toUpperCase()}</b><small>{new Date(order.createdAt).toLocaleDateString("en-IN")}</small></td>
        <td>{order.user?.name || "Customer"}<small>{order.user?.phone}</small></td><td>{order.items.length} items</td><td><b>{money(order.total)}</b></td>
        <td><span className={`status-pill ${order.paymentStatus === "paid" ? "status-delivered" : "status-placed"}`}><span></span>{order.paymentMethod === "cod" ? `Cash · ${order.paymentStatus}` : order.paymentStatus}</span></td>
        <td><span className={`status-pill status-${approvalPending ? "price_approval" : order.status}`}><span></span>{approvalPending ? "Price approval needed" : statusOptions.find(([value]) => value === order.status)?.[1] || order.status}</span></td>
        {!compact && <td><button className="table-action" onClick={() => setExpanded(expanded === order._id ? "" : order._id)}>{expanded === order._id ? "Close" : "Manage"}</button></td>}
      </tr>
      {!compact && expanded === order._id && <tr><td colSpan="7"><div className="order-manage-panel">
        <div><h4>Market purchase · {order.user?.email}</h4><p>Set the market price for each item. Customers approve any price changes before packing.</p></div>
        <div className="market-price-list">{order.items.map((item) => <label key={item.product}>{item.name}<span>Estimate {money(item.estimatedUnitPrice)}</span><input aria-label={`Actual price for ${item.name}`} type="number" min="0" step="0.01" disabled={!canSetMarketPrices || busy} value={priceDrafts[`${order._id}-${item.product}`] ?? item.actualUnitPrice ?? item.estimatedUnitPrice} onChange={(e) => setPriceDrafts({ ...priceDrafts, [`${order._id}-${item.product}`]: e.target.value })} /></label>)}</div>
        <div className="manage-actions">
          <label>Assigned market shopper<input placeholder="Team member name" defaultValue={order.assignedTo} onBlur={(event) => event.target.value !== order.assignedTo && onUpdate(order._id, { assignedTo: event.target.value })} /></label>
          <label>Delivery person<select value={order.deliveryPerson?._id || ""} onChange={(event) => onUpdate(order._id, { deliveryPersonId: event.target.value || null })} disabled={busy || order.status === "delivered" || (order.status === "out_for_delivery" && Boolean(order.deliveryPerson))}><option value="">Not assigned</option>{deliveryPersonnel.filter((person) => person.active).map((person) => <option value={person.id || person._id} key={person.id || person._id}>{person.name}</option>)}</select></label>
          <label>Order status<select value={order.status} onChange={(e) => onUpdate(order._id, { status: e.target.value })} disabled={busy}>{options.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label>
          <button className="button button-dark" disabled={busy || !canSetMarketPrices || approvalPending} onClick={() => onUpdate(order._id, { prices: order.items.map((item) => ({ product: item.product, actualUnitPrice: Number(priceDrafts[`${order._id}-${item.product}`] ?? item.actualUnitPrice ?? item.estimatedUnitPrice) })) })}>Confirm market prices <ArrowRight size={15} /></button>
        </div>
        {["out_for_delivery", "delivered"].includes(order.status) && <div className="delivery-verification-summary">
          <b>Delivery verification: {order.deliveryVerification?.status || "not_sent"}</b>
          <span>{order.deliveryVerification?.events?.filter((event) => event.type === "otp_invalid").length || 0} incorrect code attempt(s) · {order.deliveryVerification?.events?.filter((event) => event.type === "failed").length || 0} failed delivery attempt(s)</span>
          {order.deliveryProgress && <span>Driver progress: {order.deliveryProgress.replaceAll("_", " ")}</span>}
          {order.status === "delivered" && <small>{order.deliveredAt ? new Date(order.deliveredAt).toLocaleString("en-IN") : "Delivered"}{order.deliveredBy?.name ? ` · Verified by ${order.deliveredBy.name}` : ""}</small>}
          {order.status === "out_for_delivery" && <small>Delivery OTP is sent only to the customer by SMS. The assigned delivery person verifies it from their dashboard.</small>}
          <div className="delivery-event-list">{(order.deliveryVerification?.events || []).filter((event) => ["failed", "otp_invalid", "otp_expired", "otp_verified", "delivered"].includes(event.type)).slice(-5).reverse().map((event) => <div key={event._id || `${event.type}-${event.createdAt}`}><span>{event.note || event.type.replaceAll("_", " ")}</span><small>{new Date(event.createdAt).toLocaleString("en-IN")}</small></div>)}</div>
        </div>}
        {approvalPending && <p className="approval-wait"><Clock3 size={15} /> Waiting for the customer to approve updated prices.</p>}
        {!canSetMarketPrices && !approvalPending && <p className="small-muted">Market prices are locked after packing or payment.</p>}
        <div className="admin-address"><MapPin size={14} /> {order.deliveryAddress.line1}, {order.deliveryAddress.city}, {order.deliveryAddress.state} {order.deliveryAddress.postalCode} · {order.deliveryAddress.phone}</div>
      </div></td></tr>}
    </Fragment>;
  })}</tbody></table></div>;
}

function NotFound() {
  return <div className="wrap page-wrap"><div className="empty-state"><span className="empty-icon"><Leaf /></span><span className="eyebrow">A LITTLE OFF THE MARKET PATH</span><h1>Nothing fresh here.</h1><p>The page you're looking for may have moved. Let's find you something good.</p><Link className="button button-dark" to="/">Back to the good stuff <ArrowRight size={16} /></Link></div></div>;
}

export default App;
