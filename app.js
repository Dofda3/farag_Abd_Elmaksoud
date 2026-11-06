(() => {
  "use strict";

  const config = window.SHOP_CONFIG;
  const CART_KEY = "farag-butcher-cart-v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const money = (value) => `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(roundMoney(value))} ج`;
  const moneyCents = (cents) => money(cents / 100);
  const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const unitName = (unit) => ({ kg: "كجم", piece: "قطعة", pack: "عبوة" }[unit] || unit);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const imageUrl = (path) => {
    if (/^https?:\/\//i.test(path || "")) return path;
    const relativePath = String(path || "").replace(/^\/+/, "").replace(/^image\//, "");
    if (config.supabaseUrl) {
      const objectPath = relativePath.split("/").map(encodeURIComponent).join("/");
      return `${String(config.supabaseUrl).replace(/\/+$/, "")}/storage/v1/object/public/product-images/${objectPath}`;
    }
    return "";
  };
  let categories = window.SHOP_CATEGORIES;
  let products = window.SHOP_PRODUCTS;
  let supabaseClient = null;
  const state = {
    cart: readCart(),
    filter: "all",
    query: "",
    selectedSizes: {},
    toastTimer: null,
    dataReady: true
  };

  function lineKey(productId, sizeId = null) {
    return `${productId}::${sizeId || ""}`;
  }

  function readCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
      const cart = {};
      for (const [key, value] of Object.entries(saved)) {
        if (value && typeof value === "object" && typeof value.productId === "string") {
          const sizeId = value.sizeId || null;
          const amount = Math.max(0, Math.floor(Number(value.amount) || 0));
          if (amount) cart[lineKey(value.productId, sizeId)] = { productId: value.productId, sizeId, amount, saleType: value.saleType || null };
          continue;
        }
        const quantity = Number(value);
        if (Number.isFinite(quantity) && quantity > 0) {
          const productId = key.includes("::") ? key.split("::")[0] : key;
          cart[lineKey(productId)] = {
            productId,
            sizeId: null,
            amount: Math.max(1, Math.round(quantity * 4)),
            saleType: "weight",
            legacyWeight: true
          };
        }
      }
      return cart;
    } catch (error) {
      console.error("تعذر قراءة عربة التسوق المحفوظة:", error);
      return {};
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    } catch (error) {
      console.error("تعذر حفظ عربة التسوق:", error);
      showToast("تعذر حفظ السلة على هذا الجهاز.");
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  function showDataStatus(message, isError = false) {
    const status = $("#data-status");
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }

  function resolveSaleType(product) {
    if (product.saleType) return product.saleType;
    if (product.sale_type) return product.sale_type;
    return product.unit && product.unit !== "kg" ? "piece" : "weight";
  }

  function normalizeProduct(row, categorySlug, sizes = []) {
    const saleType = resolveSaleType(row);
    return {
      id: row.slug || row.id,
      dbId: row.id,
      name: row.name,
      category: categorySlug || row.category,
      saleType,
      price: Number(row.price),
      discountPrice: row.discount_price === null || row.discount_price === undefined ? null : Number(row.discount_price),
      unit: saleType === "weight" ? "kg" : (row.unit || "piece"),
      featured: row.is_featured ?? row.featured ?? false,
      available: row.is_available ?? row.available ?? true,
      description: row.description || "",
      image: row.image_url || row.image || "",
      sizes: sizes.map((size) => ({
        id: size.id,
        name: size.name,
        price: Number(size.price),
        available: size.is_available ?? size.available ?? true,
        sortOrder: Number(size.sort_order) || 0
      })).sort((a, b) => a.sortOrder - b.sortOrder)
    };
  }

  async function loadSupabaseData() {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      config.demoData = true;
      products = window.SHOP_PRODUCTS.map((product) => normalizeProduct(product));
      categories = window.SHOP_CATEGORIES;
      return;
    }
    config.demoData = false;
    state.dataReady = false;
    showDataStatus("جاري تحميل قائمة الأصناف...", false);
    try {
      if (!window.supabase?.createClient) throw new Error("تعذر تحميل مكتبة Supabase من شبكة التوزيع.");
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      const [categoryResult, productResult, sizeResult, settingsResult] = await Promise.all([
        supabaseClient.from("categories").select("id,slug,name,image_url,is_visible,sort_order").order("sort_order"),
        supabaseClient.from("products").select("id,slug,name,description,price,discount_price,unit,sale_type,image_url,is_available,is_featured,sort_order,category_id").order("sort_order"),
        supabaseClient.from("product_sizes").select("id,product_id,name,price,sort_order,is_available").order("sort_order"),
        supabaseClient.from("settings").select("key,value")
      ]);
      const failed = [categoryResult, productResult, sizeResult, settingsResult].find((result) => result.error);
      if (failed) throw failed.error;

      const allCategories = categoryResult.data || [];
      const categorySlugs = new Map(allCategories.map((category) => [category.id, category.slug]));
      categories = allCategories.filter((category) => category.is_visible).map((category) => ({
        id: category.slug,
        name: category.name,
        image: category.image_url,
        icon: window.SHOP_CATEGORIES.find((sample) => sample.id === category.slug)?.icon || "🥩"
      }));
      const visibleCategoryIds = new Set(allCategories.filter((category) => category.is_visible).map((category) => category.id));
      const sizesByProduct = new Map();
      for (const size of sizeResult.data || []) {
        if (!sizesByProduct.has(size.product_id)) sizesByProduct.set(size.product_id, []);
        sizesByProduct.get(size.product_id).push(size);
      }
      products = (productResult.data || [])
        .filter((product) => visibleCategoryIds.has(product.category_id))
        .map((product) => normalizeProduct(product, categorySlugs.get(product.category_id), sizesByProduct.get(product.id) || []));

      const settings = new Map((settingsResult.data || []).map((entry) => [entry.key, entry.value]));
      const shop = settings.get("shop");
      if (!shop || typeof shop !== "object" || !shop.shop_name || !/^\d{10,15}$/.test(shop.whatsapp || "") || !Array.isArray(shop.delivery_areas)) {
        throw new Error('إعدادات المتجر غير مكتملة. أضف صف "shop" إلى جدول settings.');
      }
      Object.assign(config, {
        shopName: shop.shop_name,
        whatsapp: shop.whatsapp,
        phone: shop.phone || "",
        address: shop.address || "",
        mapUrl: shop.map_url || "",
        workingHours: shop.working_hours || "",
        welcomeMessage: shop.welcome_message || "",
        minimumOrder: Number(shop.minimum_order || 0),
        orderPaused: Boolean(shop.order_paused),
        deliveryAreas: shop.delivery_areas,
        storeImages: shop.store_images && typeof shop.store_images === "object" ? shop.store_images : {}
      });
      state.dataReady = true;
      showDataStatus("", false);
    } catch (error) {
      console.error("تعذر تحميل بيانات المتجر من Supabase:", error);
      categories = [];
      products = [];
      state.dataReady = false;
      showDataStatus("تعذر تحميل قائمة المتجر من قاعدة البيانات. تحقق من اتصال Supabase وسياسات القراءة ثم أعد تحميل الصفحة.", true);
    }
  }

  function reconcileCart() {
    if (!state.dataReady) return 0;
    let removed = 0;
    const byId = new Map(products.map((product) => [product.id, product]));
    for (const [key, line] of Object.entries(state.cart)) {
      const product = byId.get(line.productId);
      const currentSaleType = product && resolveSaleType(product);
      const size = line.sizeId && product?.saleType === "size"
        ? product.sizes.find((item) => item.id === line.sizeId)
        : null;
      if (!product || !product.available || (line.saleType && line.saleType !== currentSaleType) ||
        (line.sizeId && (!size || !size.available)) ||
        (product.saleType === "size" && !line.sizeId) || (product.saleType !== "size" && line.sizeId)) {
        delete state.cart[key];
        removed++;
        continue;
      }
      line.amount = Math.max(1, Math.floor(Number(line.amount) || 1));
      line.saleType = currentSaleType;
      delete line.legacyWeight;
      if (product.saleType === "size" && !state.selectedSizes[product.id]) state.selectedSizes[product.id] = size.id;
    }
    if (removed) saveCart();
    return removed;
  }

  function fallbackImage(image, kind) {
    image.onerror = null;
    if (kind === "optional") {
      const block = image.closest(".about-photo");
      if (block) block.hidden = true;
      image.removeAttribute("src");
      return;
    }
    if (kind === "logo") {
      image.classList.add("logo-fallback");
      image.removeAttribute("src");
    } else {
      image.classList.add("image-fallback");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><rect width="160" height="120" fill="#f1e7da"/><path d="M56 40c-14-10-29-2-29 12 0 8 5 13 12 15-3 10 5 19 15 18 7 11 22 11 29 1 11 1 19-9 16-19 10-10 3-27-9-28-4-12-20-15-28-6Z" fill="#c98174" stroke="#7a1313" stroke-width="4"/><circle cx="68" cy="58" r="8" fill="#faf4ea"/><circle cx="91" cy="72" r="6" fill="#faf4ea"/><path d="M50 52c7-8 17-11 25-8" fill="none" stroke="#f4d0b9" stroke-width="4" stroke-linecap="round"/></svg>`;
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      image.setAttribute("aria-label", "صورة غير متاحة");
    }
  }

  function applyFallbacks() {
    document.querySelectorAll("img[data-fallback]").forEach((image) => {
      const handleError = () => fallbackImage(image, image.dataset.fallback);
      image.addEventListener("error", handleError, { once: true });
      if (image.complete && image.naturalWidth === 0) handleError();
    });
  }

  function setBusinessInfo() {
    if (config.demoData) $("#demo-banner").hidden = false;
    if (config.welcomeMessage) $("[data-welcome-message]").textContent = config.welcomeMessage;
    document.title = `${config.shopName} | لحوم طازجة كل يوم`;
    $('meta[property="og:title"]').content = document.title;
    const images = config.storeImages || {};
    for (const image of document.querySelectorAll("[data-store-image]")) {
      const source = images[image.dataset.storeImage];
      if (source) {
        image.src = imageUrl(source);
        if (image.dataset.fallback === "optional") image.closest(".about-photo").hidden = false;
      } else {
        image.removeAttribute("src");
        if (image.dataset.fallback === "optional") image.closest(".about-photo").hidden = true;
      }
    }
    const icon = images.logo || "";
    const favicon = $("#site-favicon");
    if (icon) {
      favicon.href = imageUrl(icon);
      let socialImage = $('meta[property="og:image"]');
      if (!socialImage) {
        socialImage = document.createElement("meta");
        socialImage.setAttribute("property", "og:image");
        document.head.append(socialImage);
      }
      socialImage.content = favicon.href;
      const localBusiness = $("#local-business-jsonld");
      const schema = JSON.parse(localBusiness.textContent);
      schema.image = favicon.href;
      localBusiness.textContent = JSON.stringify(schema);
    } else {
      favicon.removeAttribute("href");
      $('meta[property="og:image"]')?.remove();
    }
    document.querySelectorAll("[data-shop-name]").forEach((el) => { el.textContent = config.shopName; });
    $("[data-address]").textContent = config.address;
    $("[data-hours]").textContent = config.workingHours;
    const phone = config.phone || "رقم الهاتف يُضاف قريباً";
    $("[data-phone]").textContent = phone;
    if (config.phone) $("[data-phone-link]").href = `tel:${config.phone.replace(/[^\d+]/g, "")}`;
    $("[data-map-link]").href = config.mapUrl;
    if (/^\d{10,15}$/.test(config.whatsapp)) {
      $("[data-whatsapp-link]").href = `https://wa.me/${config.whatsapp}`;
    } else {
      $("[data-whatsapp-link]").addEventListener("click", (event) => {
        event.preventDefault();
        showToast("أضف رقم واتساب المحل في إعدادات المتجر أولاً.");
      });
    }
    if (config.orderPaused) {
      $("#pause-banner").hidden = false;
      document.body.classList.add("orders-paused");
    }
  }

  function renderCategories() {
    $("#category-cards").innerHTML = categories.map((category) => `
      <a class="category-card" href="#menu" data-open-category="${escapeHtml(category.id)}">
        <img src="${escapeHtml(imageUrl(category.image))}" alt="${escapeHtml(category.name)}" width="500" height="400" loading="lazy" data-fallback="meat">
        <span class="category-overlay"></span><span class="category-icon" aria-hidden="true">${category.icon}</span>
        <span class="category-name">${escapeHtml(category.name)}</span><span class="category-arrow" aria-hidden="true">←</span>
      </a>`).join("");
    $("#category-filters").innerHTML = `<button class="filter-chip is-active" type="button" data-filter="all">كل الأصناف</button>` +
      categories.map((category) => `<button class="filter-chip" type="button" data-filter="${escapeHtml(category.id)}">${escapeHtml(category.name)}</button>`).join("");
  }

  function weightLine(product) {
    return Object.values(state.cart).find((line) => line.productId === product.id && !line.sizeId);
  }

  function lineFor(productId, sizeId = null) {
    return state.cart[lineKey(productId, sizeId)];
  }

  function quantityLabel(product, amount) {
    if (product.saleType !== "weight") return `${amount} ${product.saleType === "piece" && product.unit === "pack" ? "عبوة" : "قطعة"}`;
    const quarters = amount;
    const whole = Math.floor(quarters / 4);
    const remainder = quarters % 4;
    if (quarters === 1) return "ربع كيلو";
    if (quarters === 2) return "نص كيلو";
    if (quarters === 3) return "ثلاثة أرباع كيلو";
    if (remainder === 0) return `${whole} كيلو`;
    if (whole === 1 && remainder === 1) return "1 كيلو وربع";
    if (whole === 1 && remainder === 2) return "1.5 كيلو";
    if (whole === 1 && remainder === 3) return "1 كيلو وثلاثة أرباع";
    const value = (quarters / 4).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${value} كيلو`;
  }

  function quantityNumber(product, amount) {
    if (product.saleType === "weight") return (amount / 4).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return String(amount);
  }

  function linePriceCents(product, amount, size = null) {
    const price = size ? size.price : (product.discountPrice || product.price);
    if (product.saleType === "weight") return Math.round(price * amount * 25);
    return Math.round(price * 100) * amount;
  }

  function quantityControl(product, size = null) {
    const line = lineFor(product.id, size?.id || null);
    const amount = line?.amount || 0;
    const price = size ? size.price : (product.discountPrice || product.price);
    const priceLabel = amount ? `<span class="live-line-price">${moneyCents(linePriceCents(product, amount, size))}</span>` : "";
    const text = product.saleType === "weight" ? quantityLabel(product, amount) : `${amount} ${product.unit === "pack" ? "عبوة" : "قطعة"}`;
    return `<div class="product-order-controls">
      <div class="quantity-control" aria-label="كمية ${escapeHtml(product.name)}">
        <button type="button" data-quantity="-1" data-id="${escapeHtml(product.id)}" ${size ? `data-size-id="${escapeHtml(size.id)}"` : ""} aria-label="تقليل كمية ${escapeHtml(product.name)}">−</button>
        <span class="quantity-value" aria-live="polite" aria-label="${escapeHtml(text)}">${amount ? escapeHtml(text) : "0"}</span>
        <button type="button" data-quantity="1" data-id="${escapeHtml(product.id)}" ${size ? `data-size-id="${escapeHtml(size.id)}"` : ""} aria-label="إضافة ${escapeHtml(product.name)}">+</button>
      </div>${priceLabel}
    </div>`;
  }

  function sizeOptions(product) {
    const selectedId = state.selectedSizes[product.id] || product.sizes.find((size) => size.available)?.id;
    if (selectedId) state.selectedSizes[product.id] = selectedId;
    return `<div class="size-options" role="group" aria-label="اختار حجم ${escapeHtml(product.name)}">${product.sizes.map((size) => `
      <button type="button" class="size-chip ${size.id === selectedId ? "is-selected" : ""}" data-select-size data-id="${escapeHtml(product.id)}" data-size-id="${escapeHtml(size.id)}" ${size.available ? "" : "disabled"}>
        <strong>${escapeHtml(size.name)}</strong><span>${size.available ? money(size.price) : "غير متاح"}</span>
      </button>`).join("")}</div>`;
  }

  function productCard(product) {
    const unavailable = product.available === false;
    const saleType = resolveSaleType(product);
    const price = product.discountPrice || product.price;
    let priceMarkup;
    let optionMarkup = "";
    let controls = "";
    if (saleType === "size") {
      const availableSizes = product.sizes.filter((size) => size.available);
      const startingPrice = availableSizes.length ? Math.min(...availableSizes.map((size) => size.price)) : product.price;
      priceMarkup = `<strong>يبدأ من ${money(startingPrice)}</strong>`;
      optionMarkup = sizeOptions(product);
      const selectedSize = product.sizes.find((size) => size.id === state.selectedSizes[product.id] && size.available) || availableSizes[0];
      controls = selectedSize ? quantityControl(product, selectedSize) : '<span class="quantity-button disabled">لا يوجد حجم متاح</span>';
    } else {
      const quantityNote = saleType === "weight" ? "للكيلو" : `لـ ${unitName(product.unit)}`;
      priceMarkup = `${product.discountPrice ? `<del>${money(product.price)}</del>` : ""}<strong>${money(price)}</strong><small>${quantityNote}</small>`;
      controls = quantityControl(product);
    }
    if (unavailable) {
      controls = '<button class="quantity-button disabled" type="button" disabled>غير متاح حالياً</button>';
      optionMarkup = saleType === "size" ? `<div class="size-options" aria-label="الأحجام">${product.sizes.map((size) => `<button class="size-chip" type="button" disabled><strong>${escapeHtml(size.name)}</strong><span>غير متاح</span></button>`).join("")}</div>` : "";
    }
    return `<article class="product-card ${unavailable ? "is-unavailable" : ""}">
      <div class="product-image-wrap"><img src="${escapeHtml(imageUrl(product.image))}" alt="${escapeHtml(product.name)}" width="520" height="440" loading="lazy" data-fallback="meat">
      ${product.discountPrice && saleType !== "size" ? '<span class="discount-label">عرض</span>' : ""}
      ${unavailable ? '<span class="unavailable-label">غير متاح حالياً</span>' : ""}</div>
      <div class="product-info"><div class="product-title-row"><h3>${escapeHtml(product.name)}</h3>${saleType === "size" ? '<span class="product-unit">بالقطعة</span>' : ""}</div>
      <p class="product-description">${escapeHtml(product.description || "")}</p>
      ${optionMarkup}<div class="product-bottom"><div class="product-price">${priceMarkup}</div>${controls}</div></div></article>`;
  }

  function renderProducts() {
    const matching = products.filter((product) => (state.filter === "all" || product.category === state.filter) &&
      `${product.name} ${product.description || ""}`.toLocaleLowerCase("ar").includes(state.query.toLocaleLowerCase("ar")));
    $("#menu-products").innerHTML = matching.map(productCard).join("");
    $("#empty-results").hidden = matching.length > 0;
    $("#featured-products").innerHTML = products.filter((product) => product.featured).slice(0, 4).map(productCard).join("");
    applyFallbacks();
  }

  function addQuantity(productId, sizeId, direction) {
    const product = products.find((item) => item.id === productId);
    if (!product || !product.available) return;
    const saleType = resolveSaleType(product);
    let size = null;
    if (saleType === "size") {
      size = product.sizes.find((item) => item.id === sizeId && item.available);
      if (!size) return;
    }
    const key = lineKey(productId, size?.id || null);
    const line = state.cart[key] || { productId, sizeId: size?.id || null, amount: 0 };
    const nextAmount = Math.max(0, line.amount + direction);
    if (nextAmount === 0) delete state.cart[key];
    else     state.cart[key] = { productId, sizeId: size?.id || null, amount: nextAmount, saleType };
    if (saleType === "size" && direction > 0) state.selectedSizes[product.id] = size.id;
    saveCart();
    renderProducts();
    renderCartIndicators();
    if (direction > 0) showToast(`اتضاف ${product.name}${size ? ` (${size.name})` : ""} للسلة`);
  }

  function cartRows() {
    return Object.values(state.cart).map((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product) return null;
      const size = line.sizeId ? product.sizes.find((item) => item.id === line.sizeId) : null;
      if (line.sizeId && !size) return null;
      return { product, size, amount: line.amount, quantity: product.saleType === "weight" ? line.amount / 4 : line.amount, price: size ? size.price : (product.discountPrice || product.price) };
    }).filter(Boolean);
  }

  function subtotalCents() {
    return cartRows().reduce((sum, row) => sum + linePriceCents(row.product, row.amount, row.size), 0);
  }

  function renderCartIndicators() {
    const count = cartRows().length;
    $("#cart-count").textContent = count;
    $("#floating-count").textContent = count;
    document.body.classList.toggle("has-cart", count > 0);
  }

  function cartLineLabel(product, size, amount) {
    if (size) return `${product.name} (${size.name})`;
    return product.name;
  }

  function renderCart() {
    const rows = cartRows();
    const areaOptions = config.deliveryAreas.map((area) => `<option value="${escapeHtml(area.name)}">${escapeHtml(area.name)} — ${money(area.fee)}</option>`).join("");
    const items = rows.length ? rows.map(({ product, size, amount }) => {
      const quantity = product.saleType === "weight" ? quantityLabel(product, amount) : `${amount} ${product.unit === "pack" ? "عبوة" : "قطعة"}`;
      const unitPriceLabel = product.saleType === "weight" ? `${money(product.discountPrice || product.price)} / كجم` : `${money(size ? size.price : product.discountPrice || product.price)} / ${size ? "قطعة" : unitName(product.unit)}`;
      return `<div class="cart-row" data-line-key="${escapeHtml(lineKey(product.id, size?.id || null))}"><img src="${escapeHtml(imageUrl(product.image))}" alt="" width="100" height="90" loading="lazy" data-fallback="meat">
        <div class="cart-row-info"><strong>${escapeHtml(cartLineLabel(product, size, amount))}</strong><small class="cart-unit-price">${unitPriceLabel}</small>
        <div class="cart-row-actions"><button type="button" data-cart-action="decrease" data-id="${escapeHtml(product.id)}" data-size-id="${escapeHtml(size?.id || "")}" aria-label="تقليل ${escapeHtml(product.name)}">−</button><span>${escapeHtml(quantity)}</span><button type="button" data-cart-action="increase" data-id="${escapeHtml(product.id)}" data-size-id="${escapeHtml(size?.id || "")}" aria-label="زيادة ${escapeHtml(product.name)}">+</button><button type="button" data-cart-action="remove" data-id="${escapeHtml(product.id)}" data-size-id="${escapeHtml(size?.id || "")}" class="remove-item">حذف</button></div></div><strong class="cart-line-total">${moneyCents(linePriceCents(product, amount, size))}</strong></div>`;
    }).join("") : `<div class="cart-empty"><span aria-hidden="true">🛒</span><strong>السلة لسه فاضية</strong><p>اختار اللي نفسك فيه وإحنا نجهزهولك.</p><button class="button button-primary" type="button" data-close-dialog>ابدأ التسوق</button></div>`;

    $("#dialog-root").innerHTML = `<div class="dialog-backdrop" data-close-dialog></div><section class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabindex="-1">
      <div class="drawer-header"><div><span class="eyebrow">طلبك على أصوله</span><h2 id="cart-title">عربة التسوق <span>(${rows.length})</span></h2></div><button class="icon-close" type="button" data-close-dialog aria-label="إغلاق السلة">×</button></div>
      ${rows.length ? `<div class="cart-body"><div class="cart-items">${items}</div><form id="checkout-form" novalidate>
      <fieldset class="delivery-choice"><legend>هتستلم طلبك إزاي؟</legend><label><input type="radio" name="fulfillment" value="delivery" checked> توصيل للبيت</label><label><input type="radio" name="fulfillment" value="pickup"> استلام من المحل</label></fieldset>
      <label class="field-label">الاسم <input name="name" autocomplete="name" required placeholder="الاسم بالكامل"></label>
      <label class="field-label">رقم الموبايل <input name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="01xxxxxxxxx"></label>
      <label class="field-label">المنطقة <select name="area" required><option value="">اختار منطقتك</option>${areaOptions}</select></label>
      <label class="field-label address-field">العنوان بالتفصيل <input name="address" autocomplete="street-address" placeholder="الشارع ورقم العقار وأقرب علامة"></label>
      <label class="field-label">ملاحظات للطلب <textarea name="notes" rows="2" placeholder="تقطيع، فرم، تنظيف..."></textarea></label>
      <div class="order-totals"><div><span>إجمالي الأصناف</span><strong id="cart-subtotal">${moneyCents(subtotalCents())}</strong></div><div class="delivery-total"><span>الدليفري</span><strong id="delivery-fee">${money(0)}</strong></div><div class="grand-total"><span>الإجمالي</span><strong id="grand-total">${moneyCents(subtotalCents())}</strong></div></div>
      ${config.minimumOrder > 0 ? `<p class="minimum-note">الحد الأدنى للطلب: ${money(config.minimumOrder)}</p>` : ""}
      <button class="button button-primary checkout-button" type="submit" ${config.orderPaused || !state.dataReady ? "disabled" : ""}>${config.orderPaused ? "الطلبات متوقفة مؤقتاً" : !state.dataReady ? "تعذر تحميل بيانات المتجر" : "إرسال الطلب عبر واتساب"} <span aria-hidden="true">←</span></button>
      <p class="payment-note">الدفع عند الاستلام أو في المحل — الأسعار مبدئية وهنأكدها معاك.</p></form></div>` : items}
      </section>`;
    $("#dialog-root").classList.add("is-open");
    document.body.classList.add("dialog-open");
    $(".cart-drawer").focus();
    applyFallbacks();
    bindCartDialog();
  }

  function selectedFulfillment(form) {
    return new FormData(form).get("fulfillment") || "delivery";
  }

  function selectedAreaFee(form) {
    const area = config.deliveryAreas.find((item) => item.name === form.elements.area.value);
    return area ? Number(area.fee) : 0;
  }

  function updateCheckoutTotals(form) {
    const delivery = selectedFulfillment(form) === "delivery" ? selectedAreaFee(form) : 0;
    $("#delivery-fee").textContent = money(delivery);
    $("#grand-total").textContent = moneyCents(subtotalCents() + Math.round(delivery * 100));
    $(".address-field").hidden = selectedFulfillment(form) !== "delivery";
    form.elements.area.closest(".field-label").hidden = selectedFulfillment(form) !== "delivery";
  }

  function updateCartPrices(form) {
    for (const row of cartRows()) {
      const element = $(`[data-line-key="${CSS.escape(lineKey(row.product.id, row.size?.id || null))}"]`);
      if (!element) continue;
      const unitPrice = row.size ? row.size.price : (row.product.discountPrice || row.product.price);
      element.querySelector(".cart-unit-price").textContent = row.product.saleType === "weight"
        ? `${money(unitPrice)} / كجم`
        : `${money(unitPrice)} / ${row.size ? "قطعة" : unitName(row.product.unit)}`;
      element.querySelector(".cart-line-total").textContent = moneyCents(linePriceCents(row.product, row.amount, row.size));
    }
    $("#cart-subtotal").textContent = moneyCents(subtotalCents());
    updateCheckoutTotals(form);
  }

  function normalizeEgyptianPhone(input) {
    let phone = input.replace(/[\s()-]/g, "");
    if (phone.startsWith("+20")) phone = `0${phone.slice(3)}`;
    else if (phone.startsWith("0020")) phone = `0${phone.slice(4)}`;
    else if (phone.startsWith("20") && phone.length === 12) phone = `0${phone.slice(2)}`;
    return /^01[0125]\d{8}$/.test(phone) ? phone : "";
  }

  async function refreshCurrentPrices() {
    if (!supabaseClient || !state.dataReady) return true;
    const slugs = [...new Set(cartRows().map((row) => row.product.id))];
    if (!slugs.length) return false;
    const { data: productRows, error: productError } = await supabaseClient
      .from("products")
      .select("id,slug,price,discount_price,sale_type,unit,is_available")
      .in("slug", slugs);
    if (productError) throw productError;
    const ids = (productRows || []).map((row) => row.id);
    const { data: sizeRows, error: sizeError } = ids.length
      ? await supabaseClient.from("product_sizes").select("id,product_id,name,price,is_available,sort_order").in("product_id", ids).order("sort_order")
      : { data: [], error: null };
    if (sizeError) throw sizeError;
    const sizesByProduct = new Map();
    for (const size of sizeRows || []) {
      if (!sizesByProduct.has(size.product_id)) sizesByProduct.set(size.product_id, []);
      sizesByProduct.get(size.product_id).push(size);
    }
    const freshBySlug = new Map((productRows || []).map((row) => [
      row.slug,
      normalizeProduct(row, null, sizesByProduct.get(row.id) || [])
    ]));
    let removed = 0;
    products = products.map((current) => freshBySlug.has(current.id)
      ? { ...current, ...freshBySlug.get(current.id), category: current.category, featured: current.featured, description: current.description, image: current.image }
      : current);
    for (const [key, line] of Object.entries(state.cart)) {
      const current = freshBySlug.get(line.productId);
      const size = line.sizeId ? current?.sizes.find((item) => item.id === line.sizeId) : null;
      if (!current || !current.available || (line.saleType && line.saleType !== current.saleType) ||
        (line.sizeId && (!size || !size.available))) {
        delete state.cart[key];
        removed++;
      }
    }
    if (removed) {
      saveCart();
      renderProducts();
      renderCartIndicators();
      showToast("اتحدّثت السلة لأن صنفاً أو حجماً لم يعد متاحاً. راجع طلبك.");
      return false;
    }
    return true;
  }

  function buildOrderMessage(form) {
    const formData = new FormData(form);
    const fulfillment = selectedFulfillment(form);
    const areaName = fulfillment === "delivery" ? formData.get("area") : "استلام من المحل";
    const address = fulfillment === "delivery" ? formData.get("address").trim() : "استلام من المحل";
    const fee = fulfillment === "delivery" ? selectedAreaFee(form) : 0;
    const lines = [
      "🥩 طلب جديد من الموقع",
      `👤 الاسم: ${formData.get("name").trim()}`,
      `📞 الموبايل: ${normalizeEgyptianPhone(formData.get("phone"))}`,
      `📍 العنوان/المنطقة: ${areaName}${fulfillment === "delivery" ? ` — ${address}` : ""}`,
      "━━━━━━━━━━",
      ...cartRows().map(({ product, size, amount }, index) => {
        const unitPrice = size ? size.price : (product.discountPrice || product.price);
        const quantity = product.saleType === "weight" ? `${quantityNumber(product, amount)} كجم` : `${amount} ${product.unit === "pack" ? "عبوة" : "قطعة"}`;
        return `${index + 1}) ${cartLineLabel(product, size, amount)} - ${quantity} × ${money(unitPrice).replace(" ج", "")} = ${moneyCents(linePriceCents(product, amount, size))}`;
      }),
      "━━━━━━━━━━",
      `💰 إجمالي الأصناف: ${moneyCents(subtotalCents())}`,
      `🛵 الدليفري: ${money(fee)}`,
      `✅ الإجمالي: ${moneyCents(subtotalCents() + Math.round(fee * 100))}`,
      `📝 ملاحظات: ${formData.get("notes").trim() || "لا يوجد"}`,
      "(الأسعار مبدئية وهتتأكد عند تجهيز الطلب)"
    ];
    return lines.join("\n");
  }

  function openOrderPreview(message) {
    const preview = document.createElement("section");
    preview.className = "preview-card";
    preview.setAttribute("role", "alertdialog");
    preview.setAttribute("aria-modal", "true");
    preview.setAttribute("aria-labelledby", "preview-title");
    preview.innerHTML = `<div class="drawer-header"><div><span class="eyebrow">راجع طلبك قبل الإرسال</span><h2 id="preview-title">ملخص الطلب</h2></div><button class="icon-close" type="button" data-close-preview aria-label="إغلاق">×</button></div><pre class="order-preview-text"></pre><p class="payment-note">للتأكيد، هيتفتح واتساب برسالة جاهزة. الدفع عند الاستلام أو في المحل.</p><div class="preview-actions"><button class="button button-outline" type="button" data-copy-order>نسخ الطلب</button><button class="button button-primary" type="button" data-send-order>تأكيد وفتح واتساب</button></div>`;
    $(".order-preview-text", preview).textContent = message;
    $("#dialog-root").append(preview);
    $("[data-send-order]", preview).addEventListener("click", () => {
      if (!/^\d{10,15}$/.test(config.whatsapp)) {
        showToast("رقم واتساب المحل غير صحيح. راجع إعدادات المحل.");
        return;
      }
      const target = `https://wa.me/${config.whatsapp}?text=${encodeURIComponent(message)}`;
      window.open(target, "_blank", "noopener,noreferrer");
      state.cart = {};
      saveCart();
      renderProducts();
      renderCartIndicators();
      $("#dialog-root").classList.remove("is-open");
      document.body.classList.remove("dialog-open");
      $("#dialog-root").replaceChildren();
      showToast("اتفتح واتساب لإرسال طلبك.");
    });
    $("[data-copy-order]", preview).addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(message);
        showToast("اتنسخ ملخص الطلب.");
      } catch (error) {
        console.error("تعذر نسخ الطلب:", error);
        showToast("تعذر النسخ تلقائياً. حدّد نص الطلب وانسخه.");
      }
    });
    $("[data-close-preview]", preview).addEventListener("click", () => preview.remove());
    preview.focus();
  }

  function bindCartDialog() {
    const form = $("#checkout-form");
    if (!form) return;
    form.addEventListener("change", () => updateCheckoutTotals(form));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (config.orderPaused) return showToast("استقبال الطلبات متوقف مؤقتاً.");
      if (!state.dataReady) return showToast("لا يمكن إرسال الطلب قبل تحميل بيانات المتجر.");
      const data = new FormData(form);
      const fulfillment = selectedFulfillment(form);
      const phone = normalizeEgyptianPhone(String(data.get("phone") || ""));
      form.querySelectorAll(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
      let invalid = false;
      if (!String(data.get("name") || "").trim()) { form.elements.name.classList.add("is-invalid"); invalid = true; }
      if (!phone) { form.elements.phone.classList.add("is-invalid"); invalid = true; }
      if (fulfillment === "delivery" && !String(data.get("address") || "").trim()) { form.elements.address.classList.add("is-invalid"); invalid = true; }
      if (fulfillment === "delivery" && !String(data.get("area") || "")) { form.elements.area.classList.add("is-invalid"); invalid = true; }
      if (invalid) {
        showToast(!phone ? "اكتب رقم موبايل مصري صحيح." : "راجع البيانات المطلوبة قبل إرسال الطلب.");
        form.querySelector(".is-invalid")?.focus();
        return;
      }
      if (subtotalCents() < Math.round(Number(config.minimumOrder || 0) * 100)) {
        showToast(`الحد الأدنى للطلب ${money(config.minimumOrder)}.`);
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const pricesCurrent = await refreshCurrentPrices();
        if (!pricesCurrent) {
          renderCart();
          return;
        }
        if (!cartRows().length) {
          showToast("السلة فاضية بعد تحديث التوفر.");
          renderCart();
          return;
        }
        updateCartPrices(form);
        openOrderPreview(buildOrderMessage(form));
      } catch (error) {
        console.error("تعذر تحديث الأسعار قبل إرسال الطلب:", error);
        showToast("تعذر تحديث الأسعار. تأكد من الاتصال وحاول مرة أخرى.");
      } finally {
        submit.disabled = false;
      }
    });
  }

  function closeDialog() {
    $("#dialog-root").classList.remove("is-open");
    document.body.classList.remove("dialog-open");
    $("#dialog-root").replaceChildren();
  }

  async function init() {
    await loadSupabaseData();
    setBusinessInfo();
    const removed = reconcileCart();
    if (removed) showToast("اتشالت أصناف أو أحجام لم تعد متاحة من سلتك.");
    saveCart();
    renderCategories();
    renderProducts();
    renderCartIndicators();
    $("#year").textContent = new Date().getFullYear();
    $("#category-filters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      $("#category-filters").querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("is-active", chip === button));
      renderProducts();
    });
    $("#category-cards").addEventListener("click", (event) => {
      const card = event.target.closest("[data-open-category]");
      if (!card) return;
      state.filter = card.dataset.openCategory;
      $("#category-filters").querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("is-active", chip.dataset.filter === state.filter));
      renderProducts();
    });
    $("#product-search").addEventListener("input", (event) => {
      state.query = event.target.value.trim();
      renderProducts();
    });
    document.addEventListener("click", (event) => {
      const sizeButton = event.target.closest("[data-select-size]");
      if (sizeButton) {
        state.selectedSizes[sizeButton.dataset.id] = sizeButton.dataset.sizeId;
        renderProducts();
      }
      const quantityButton = event.target.closest("[data-quantity]");
      if (quantityButton) addQuantity(quantityButton.dataset.id, quantityButton.dataset.sizeId || null, Number(quantityButton.dataset.quantity));
      if (event.target.closest('a[href="#cart"]')) { event.preventDefault(); renderCart(); }
      if (event.target.closest("[data-close-dialog]")) closeDialog();
      const cartAction = event.target.closest("[data-cart-action]");
      if (cartAction) {
        const product = products.find((item) => item.id === cartAction.dataset.id);
        const line = lineFor(cartAction.dataset.id, cartAction.dataset.sizeId || null);
        if (!product || !line) return;
        if (cartAction.dataset.cartAction === "remove") {
          delete state.cart[lineKey(cartAction.dataset.id, cartAction.dataset.sizeId || null)];
          saveCart();
          renderProducts();
          renderCartIndicators();
          renderCart();
          return;
        }
        addQuantity(cartAction.dataset.id, cartAction.dataset.sizeId || null, cartAction.dataset.cartAction === "increase" ? 1 : -1);
        renderCart();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("#dialog-root").classList.contains("is-open")) closeDialog();
    });
    applyFallbacks();
  }

  init();
})();
