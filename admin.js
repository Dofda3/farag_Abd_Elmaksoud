(() => {
  "use strict";

  const config = window.SHOP_CONFIG;
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { client: null, user: null, categories: [], products: [], settings: null, toastTimer: null, draggedCategory: null };
  const BUCKET = "product-images";
  const $login = $("#login-panel");
  const $dashboard = $("#dashboard");
  const $status = $("#admin-status");

  function showStatus(message, isError = false) {
    $status.hidden = !message;
    $status.textContent = message;
    $status.classList.toggle("is-error", isError);
  }

  function toast(message) {
    const element = $("#admin-toast");
    element.textContent = message;
    element.classList.add("is-visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.remove("is-visible"), 2600);
  }

  function reportError(error, message = "حصلت مشكلة أثناء الحفظ. راجع الاتصال وحاول مرة أخرى.") {
    console.error(message, error);
    showStatus(`${message} ${error?.message || ""}`.trim(), true);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function unitName(unit) {
    return ({ kg: "كيلو", piece: "قطعة", pack: "عبوة" })[unit] || unit;
  }

  function saleType(product) {
    return product.sale_type || (product.unit === "kg" ? "weight" : "piece");
  }

  function isMissingMigrationError(error) {
    return ["PGRST204", "PGRST205", "42703", "42P01"].includes(error?.code) ||
      /product_sizes|sale_type|schema cache|does not exist/i.test(error?.message || "");
  }

  async function checkSizesMigration() {
    const [productCheck, sizesCheck] = await Promise.all([
      state.client.from("products").select("sale_type").limit(1),
      state.client.from("product_sizes").select("id,product_id,name,price,sort_order,is_available,created_at").limit(1)
    ]);
    const failed = [productCheck, sizesCheck].find((result) => result.error);
    if (failed) {
      if (isMissingMigrationError(failed.error)) {
        console.error("Supabase product sizes migration is missing:", failed.error);
        showStatus("لازم تشغّل ملف الـ migration في Supabase قبل استخدام لوحة الأحجام.", true);
        $("#login-form").querySelector('[type="submit"]').disabled = true;
        return false;
      }
      throw failed.error;
    }
    return true;
  }

  function slugPrefix(prefix) {
    return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  }

  async function authorize(user) {
    state.user = user;
    const { data, error } = await state.client.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      await state.client.auth.signOut();
      $login.hidden = false;
      $dashboard.hidden = true;
      $("#signout-button").hidden = true;
      showStatus("الحساب ده مش مضاف كمشرف. اطلب من مسؤول المتجر تفعيله في جدول admin_users.", true);
      return;
    }
    $login.hidden = true;
    $dashboard.hidden = false;
    $("#signout-button").hidden = false;
    showStatus("");
    await loadDashboard();
  }

  async function loadDashboard() {
    showStatus("جاري تحميل بيانات المتجر...");
    const [categoryResult, productResult, sizeResult, settingResult] = await Promise.all([
      state.client.from("categories").select("*").order("sort_order"),
      state.client.from("products").select("*, categories(name)").order("sort_order"),
      state.client.from("product_sizes").select("*").order("sort_order"),
      state.client.from("settings").select("key,value").eq("key", "shop").maybeSingle()
    ]);
    const failed = [categoryResult, productResult, sizeResult, settingResult].find((result) => result.error);
    if (failed) {
      if (isMissingMigrationError(failed.error)) {
        throw new Error("لازم تشغّل ملف الـ migration في Supabase قبل استخدام لوحة الأحجام.");
      }
      throw failed.error;
    }
    state.categories = categoryResult.data || [];
    state.products = productResult.data || [];
    const sizesByProduct = new Map();
    for (const size of sizeResult.data || []) {
      if (!sizesByProduct.has(size.product_id)) sizesByProduct.set(size.product_id, []);
      sizesByProduct.get(size.product_id).push(size);
    }
    state.products.forEach((product) => { product.sizes = sizesByProduct.get(product.id) || []; });
    state.settings = settingResult.data?.value || {
      shop_name: config.shopName,
      whatsapp: config.whatsapp,
      phone: config.phone,
      address: config.address,
      map_url: config.mapUrl,
      working_hours: config.workingHours,
      welcome_message: config.welcomeMessage,
      minimum_order: config.minimumOrder,
      order_paused: config.orderPaused,
      delivery_areas: config.deliveryAreas
    };
    renderAll();
    showStatus("");
  }

  function publicImage(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    const relativePath = String(path).replace(/^\/+/, "").replace(/^image\//, "");
    if (!config.supabaseUrl) return "";
    const objectPath = relativePath.split("/").map(encodeURIComponent).join("/");
    return `${String(config.supabaseUrl).replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  }

  function renderAll() {
    renderProducts();
    renderCategories();
    renderPrices();
    renderSettings();
    renderCategorySelect();
  }

  function renderProducts() {
    const rows = [...state.products].sort((a, b) => a.sort_order - b.sort_order);
    $("#products-table").innerHTML = rows.map((product) => `<tr>
      <td><div class="product-cell">${product.image_url ? `<img src="${escapeHtml(publicImage(product.image_url))}" alt="" loading="lazy">` : '<span class="image-blank">🥩</span>'}<span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || "")}</small></span></div></td>
      <td>${escapeHtml(product.categories?.name || "—")}</td>
      <td>${saleType(product) === "size" ? `<strong>${product.sizes.length ? `${money(Math.min(...product.sizes.map((size) => Number(size.price))))} – ${money(Math.max(...product.sizes.map((size) => Number(size.price))))} ج` : "لا توجد أحجام"}</strong>` : `<strong>${money(product.price)} ج</strong>${product.discount_price ? `<small class="discount-price"> / عرض ${money(product.discount_price)} ج</small>` : ""}`}<small class="sale-type-tag">${saleType(product) === "weight" ? "بالوزن" : saleType(product) === "size" ? "بالأحجام" : "بالقطعة"}</small></td>
      <td><span class="status-pill ${product.is_available ? "" : "off"}">${product.is_available ? "متاح" : "غير متاح"}</span></td>
      <td><div class="table-actions"><button type="button" class="small-button" data-edit-product="${product.id}">تعديل</button><button type="button" class="small-button danger" data-delete-product="${product.id}">حذف</button></div></td>
    </tr>`).join("");
    $("#products-table").querySelectorAll("img").forEach((image) => {
      const removeBrokenImage = () => {
        const placeholder = document.createElement("span");
        placeholder.className = "image-blank";
        placeholder.textContent = "🥩";
        image.replaceWith(placeholder);
      };
      image.addEventListener("error", removeBrokenImage, { once: true });
      if (image.complete && image.naturalWidth === 0) removeBrokenImage();
    });
  }

  function renderCategories() {
    const rows = [...state.categories].sort((a, b) => a.sort_order - b.sort_order);
    $("#categories-list").innerHTML = rows.length ? rows.map((category) => `<div class="category-row" draggable="true" data-category-row="${category.id}">
      <span class="drag-handle" aria-label="اسحب لإعادة الترتيب">⠿</span>
      ${category.image_url ? `<img src="${escapeHtml(publicImage(category.image_url))}" alt="" loading="lazy">` : '<span class="category-image-blank">🥩</span>'}
      <strong>${escapeHtml(category.name)}</strong>
      <label class="visibility-control"><input class="status-toggle" type="checkbox" data-toggle-category="${category.id}" ${category.is_visible ? "checked" : ""}> ظاهر</label>
      <div class="category-actions"><button class="small-button" type="button" data-move-category="${category.id}" data-direction="-1" aria-label="تحريك ${escapeHtml(category.name)} لأعلى">↑</button><button class="small-button" type="button" data-move-category="${category.id}" data-direction="1" aria-label="تحريك ${escapeHtml(category.name)} لأسفل">↓</button><button class="small-button" type="button" data-edit-category="${category.id}">تعديل</button><button class="small-button danger" type="button" data-delete-category="${category.id}">حذف</button></div>
    </div>`).join("") : '<p class="helper-text">لا توجد أقسام بعد. أضف أول قسم من النموذج أعلاه.</p>';
    $("#categories-list").querySelectorAll("img").forEach((image) => {
      const removeBrokenImage = () => {
        const placeholder = document.createElement("span");
        placeholder.className = "category-image-blank";
        placeholder.textContent = "🥩";
        image.replaceWith(placeholder);
      };
      image.addEventListener("error", removeBrokenImage, { once: true });
      if (image.complete && image.naturalWidth === 0) removeBrokenImage();
    });
  }

  function renderPrices() {
    $("#prices-table").innerHTML = [...state.products].sort((a, b) => a.sort_order - b.sort_order).map((product) => {
      if (saleType(product) === "size") {
        return product.sizes.map((size) => `<tr>
          <td><strong>${escapeHtml(product.name)} (${escapeHtml(size.name)})</strong><small> ${escapeHtml(product.categories?.name || "")} · ${size.is_available ? "متاح" : "غير متاح"}</small></td>
          <td>قطعة</td>
          <td><label class="sr-only" for="size-price-${size.id}">سعر ${escapeHtml(product.name)} ${escapeHtml(size.name)}</label><input id="size-price-${size.id}" class="price-input" type="number" min="0" step="0.01" value="${Number(size.price)}" data-size-price-id="${size.id}"></td>
        </tr>`).join("") || `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td colspan="2">لا توجد أحجام مسجلة</td></tr>`;
      }
      return `<tr>
        <td><strong>${escapeHtml(product.name)}</strong><small> ${escapeHtml(product.categories?.name || "")}</small></td>
        <td>${saleType(product) === "weight" ? "كيلو" : escapeHtml(unitName(product.unit))}</td>
        <td><label class="sr-only" for="price-${product.id}">سعر ${escapeHtml(product.name)}</label><input id="price-${product.id}" class="price-input" type="number" min="0" step="0.01" value="${Number(product.price)}" data-price-id="${product.id}"></td>
      </tr>`;
    }).join("");
  }

  function renderCategorySelect(selectedId = "") {
    const select = $("#product-form").elements.category_id;
    const options = [...state.categories].sort((a, b) => a.sort_order - b.sort_order).map((category) =>
      `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
    select.innerHTML = `<option value="">اختار القسم</option>${options}`;
    if (selectedId) select.value = selectedId;
  }

  function renderSizeOptions(sizes = []) {
    $("#size-options-list").innerHTML = sizes.map((size, index) => `<div class="size-option-row" data-size-row>
      <input type="hidden" data-size-option-id value="${escapeHtml(size.id || "")}">
      <label class="field-label">اسم الحجم<input data-size-option-name required maxlength="60" value="${escapeHtml(size.name || "")}" placeholder="مثال: كبير"><small class="size-field-error" data-name-error hidden></small></label>
      <label class="field-label">السعر (جنيه)<input data-size-option-price type="number" min="0" step="0.01" required value="${size.price ?? ""}" placeholder="مثال: 60"><small class="size-field-error" data-price-error hidden></small></label>
      <label class="size-availability"><input data-size-option-available type="checkbox" ${size.is_available === false || size.available === false ? "" : "checked"}> متاح</label>
      <div class="size-row-actions">
        <button class="small-button" type="button" data-size-move="-1" aria-label="تحريك الحجم لأعلى" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="small-button" type="button" data-size-move="1" aria-label="تحريك الحجم لأسفل" ${index === sizes.length - 1 ? "disabled" : ""}>↓</button>
        <button class="small-button danger" type="button" data-remove-size="${escapeHtml(size.id || "")}" aria-label="حذف الحجم">🗑</button>
      </div>
    </div>`).join("");
    updateQuickAddButtons();
  }

  function updateQuickAddButtons() {
    const names = new Set([...$("#size-options-list").querySelectorAll("[data-size-option-name]")]
      .map((input) => input.value.trim().toLocaleLowerCase("ar")));
    document.querySelectorAll("[data-quick-size]").forEach((button) => {
      button.disabled = names.has(button.dataset.quickSize.toLocaleLowerCase("ar"));
    });
  }

  function updateSaleTypeFields() {
    const form = $("#product-form");
    const type = form.elements.sale_type.value;
    const priceField = $("[data-single-price-field]", form);
    const discountField = $("[data-offer-price-field]", form);
    const sizeEditor = $("#size-options-editor");
    priceField.hidden = type === "size";
    form.elements.price.required = type !== "size";
    discountField.hidden = type === "size";
    form.elements.discount_price.disabled = type === "size";
    sizeEditor.hidden = type !== "size";
    $("[data-single-price-label]", form).textContent = type === "weight" ? "سعر الكيلو (جنيه)" : "سعر القطعة (جنيه)";
    $("[data-price-help]", form).textContent = type === "weight" ? "الكمية بتزيد ربع كيلو ربع كيلو." : "سعر القطعة الواحدة.";
    if (type === "size" && !$("#size-options-list").children.length) {
      renderSizeOptions([{ name: "", price: "", is_available: true }, { name: "", price: "", is_available: true }]);
    }
  }

  function changeSaleType() {
    const form = $("#product-form");
    const previous = form.dataset.saleType || "weight";
    const selected = form.elements.sale_type.value;
    if (previous === selected) return;
    if (previous === "size" && selected !== "size" &&
      !window.confirm("هتتمسح الأحجام الحالية لو كملت. متأكد؟")) {
      form.elements.sale_type.value = previous;
      return;
    }
    if (selected === "size" && previous !== "size") {
      const currentPrice = form.elements.price.value;
      if (!$("#size-options-list").children.length) {
        renderSizeOptions([
          { name: "", price: currentPrice, is_available: true },
          { name: "", price: "", is_available: true }
        ]);
      } else {
        const firstPrice = $("#size-options-list [data-size-option-price]");
        if (firstPrice && firstPrice.value === "" && currentPrice !== "") firstPrice.value = currentPrice;
      }
    }
    form.dataset.saleType = selected;
    updateSaleTypeFields();
  }

  function renderSettings() {
    const form = $("#settings-form");
    const settings = state.settings || {};
    for (const key of ["shop_name", "whatsapp", "phone", "working_hours", "address", "map_url", "welcome_message", "minimum_order"]) {
      form.elements[key].value = settings[key] ?? "";
    }
    form.elements.order_paused.checked = Boolean(settings.order_paused);
    renderAreas(Array.isArray(settings.delivery_areas) ? settings.delivery_areas : []);
    renderStoreImages(settings.store_images || {});
  }

  function renderStoreImages(images) {
    document.querySelectorAll("[data-store-image-row]").forEach((row) => {
      const input = row.querySelector("[data-image-file]");
      const preview = row.querySelector("[data-image-preview]");
      const placeholder = row.querySelector("[data-image-placeholder]");
      row.dataset.imageCleared = "false";
      input.value = "";
      const source = images[row.dataset.imageKey];
      preview.hidden = !source;
      placeholder.hidden = Boolean(source);
      if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
      preview.onerror = () => {
        preview.hidden = true;
        placeholder.hidden = false;
      };
      if (source) {
        preview.src = publicImage(source);
      } else {
        preview.removeAttribute("src");
        preview.onerror = null;
      }
    });
  }

  function renderAreas(areas) {
    $("#delivery-areas").innerHTML = areas.map((area) => `<div class="area-row">
      <label class="area-field">اسم المنطقة<input data-area-name type="text" value="${escapeHtml(area.name)}" maxlength="100" placeholder="اسم المنطقة" required></label>
      <label class="area-field">رسوم التوصيل (جنيه)<input data-area-fee type="number" min="0" step="0.01" value="${Number(area.fee)}" placeholder="رسوم التوصيل" required></label>
      <button class="area-remove" type="button" data-remove-area aria-label="حذف المنطقة">×</button>
    </div>`).join("");
  }

  function resetProductForm() {
    const form = $("#product-form");
    form.reset();
    form.elements.id.value = "";
    form.elements.slug.value = "";
    form.elements.sale_type.value = "weight";
    form.dataset.saleType = "weight";
    renderSizeOptions([]);
    $("#product-form-title").textContent = "صنف جديد";
    renderCategorySelect();
    updateSaleTypeFields();
    form.hidden = true;
  }

  function editProduct(id) {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    const form = $("#product-form");
    form.hidden = false;
    form.elements.id.value = product.id;
    form.elements.slug.value = product.slug;
    form.elements.name.value = product.name;
    form.elements.category_id.value = product.category_id;
    form.elements.price.value = product.price;
    form.elements.discount_price.value = product.discount_price ?? "";
    form.elements.sale_type.value = saleType(product);
    form.dataset.saleType = saleType(product);
    form.elements.description.value = product.description || "";
    form.elements.is_available.checked = product.is_available;
    form.elements.is_featured.checked = product.is_featured;
    form.elements.image.value = "";
    renderSizeOptions(product.sizes || []);
    updateSaleTypeFields();
    $("#product-form-title").textContent = `تعديل: ${product.name}`;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.name.focus({ preventScroll: true });
  }

  async function compressedImage(file, preserveTransparency = false) {
    if (!file) return null;
    if (!file.type.startsWith("image/")) throw new Error("اختار ملف صورة صالح.");
    if (file.size > 12 * 1024 * 1024) throw new Error("حجم الصورة أكبر من 12 ميجابايت.");
    const bitmap = await createImageBitmap(file);
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("المتصفح لم يتمكن من تجهيز الصورة.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(
      resolve,
      preserveTransparency ? "image/webp" : "image/jpeg",
      0.82
    ));
    if (!blob) throw new Error("تعذر ضغط الصورة. جرّب صورة أخرى.");
    return blob;
  }

  async function uploadImage(file, folder, preserveTransparency = false) {
    const blob = await compressedImage(file, preserveTransparency);
    if (!blob) return null;
    const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    if (blob.size > 5 * 1024 * 1024) throw new Error("الصورة بعد الضغط أكبر من الحد المسموح (5 ميجابايت). اختار صورة أصغر.");
    const path = `${folder}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await state.client.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type,
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw error;
    return state.client.storage.from(BUCKET).getPublicUrl(data.path).data.publicUrl;
  }

  function readSizeOptions() {
    return [...$("#size-options-list").querySelectorAll(".size-option-row")].map((row, index) => ({
      id: row.querySelector("[data-size-option-id]").value || null,
      name: row.querySelector("[data-size-option-name]").value.trim(),
      price: row.querySelector("[data-size-option-price]").value === "" ? "" : Number(row.querySelector("[data-size-option-price]").value),
      sort_order: index + 1,
      is_available: row.querySelector("[data-size-option-available]").checked
    }));
  }

  function validateSizeOptions(options) {
    const listError = $("#size-list-error");
    const rows = [...$("#size-options-list").querySelectorAll("[data-size-row]")];
    listError.hidden = true;
    listError.textContent = "";
    rows.forEach((row) => {
      row.querySelector("[data-name-error]").hidden = true;
      row.querySelector("[data-name-error]").textContent = "";
      row.querySelector("[data-price-error]").hidden = true;
      row.querySelector("[data-price-error]").textContent = "";
    });
    let valid = true;
    if (options.length < 2) {
      listError.textContent = "لازم تضيف حجمين على الأقل.";
      listError.hidden = false;
      valid = false;
    }
    const names = new Map();
    options.forEach((option, index) => {
      const row = rows[index];
      const nameError = row.querySelector("[data-name-error]");
      const priceError = row.querySelector("[data-price-error]");
      const normalizedName = option.name.trim().toLocaleLowerCase("ar");
      if (!normalizedName) {
        nameError.textContent = "اكتب اسم الحجم.";
        nameError.hidden = false;
        valid = false;
      } else if (names.has(normalizedName)) {
        nameError.textContent = "اسم الحجم مكرر.";
        nameError.hidden = false;
        rows[names.get(normalizedName)].querySelector("[data-name-error]").textContent = "اسم الحجم مكرر.";
        rows[names.get(normalizedName)].querySelector("[data-name-error]").hidden = false;
        valid = false;
      } else {
        names.set(normalizedName, index);
      }
      if (!Number.isFinite(option.price) || option.price < 0) {
        priceError.textContent = "السعر لازم يكون رقماً صفر أو أكبر.";
        priceError.hidden = false;
        valid = false;
      }
    });
    if (!valid) $("#size-options-editor").scrollIntoView({ behavior: "smooth", block: "center" });
    return valid;
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const originalButtonText = submit.textContent;
    submit.textContent = "جاري الحفظ...";
    showStatus("");
    try {
      const current = form.elements.id.value ? state.products.find((item) => item.id === form.elements.id.value) : null;
      const selectedSaleType = form.elements.sale_type.value;
      const options = selectedSaleType === "size" ? readSizeOptions() : [];
      if (selectedSaleType === "size") {
        if (!validateSizeOptions(options)) return;
      }
      if (!form.reportValidity()) return;
      const rawPrice = selectedSaleType === "size"
        ? Math.min(...options.map((option) => option.price))
        : Number(form.elements.price.value);
      const discountRaw = form.elements.discount_price.value;
      const discount = selectedSaleType === "size" || discountRaw === "" ? null : Number(discountRaw);
      if (!Number.isFinite(rawPrice) || rawPrice < 0 || (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount >= rawPrice))) {
        throw new Error("راجع السعر وسعر العرض. لازم سعر العرض يكون أقل من السعر الأصلي.");
      }
      let imageUrl = current?.image_url || "";
      const file = form.elements.image.files[0];
      if (file) imageUrl = await uploadImage(file, "products");
      const row = {
        id: current?.id || null,
        slug: current?.slug || slugPrefix("product"),
        category_id: form.elements.category_id.value,
        name: form.elements.name.value.trim(),
        description: form.elements.description.value.trim(),
        price: rawPrice,
        discount_price: discount,
        sale_type: selectedSaleType,
        unit: selectedSaleType === "weight" ? "kg" : selectedSaleType === "size" ? "piece" : (current?.unit === "pack" ? "pack" : "piece"),
        quantity_step: selectedSaleType === "weight" ? 0.25 : 1,
        image_url: imageUrl,
        is_available: form.elements.is_available.checked,
        is_featured: form.elements.is_featured.checked,
        sort_order: current?.sort_order ?? state.products.length + 1
      };
      const { error } = await state.client.rpc("save_product_with_sizes", {
        product_data: row,
        sizes_data: options
      });
      if (error) {
        console.error("Supabase save_product_with_sizes RPC failed:", error);
        if (error.code === "PGRST202" || /save_product_with_sizes/i.test(error.message || "")) {
          throw new Error("لازم تشغّل ملف الـ migration الخاص بحفظ الأصناف والأحجام في Supabase.");
        }
        throw error;
      }
      resetProductForm();
      await loadDashboard();
      toast("تم الحفظ ✅");
    } catch (error) {
      console.error("Supabase product save failed:", error);
      const message = error.message?.startsWith("لازم تشغّل")
        ? error.message
        : error.code === "42501"
          ? "لا تملك صلاحية حفظ الصنف. سجّل الدخول بحساب موجود في admin_users."
          : error.code === "23505"
            ? "اسم الحجم مكرر أو يوجد تعارض في بيانات الصنف."
            : `تعذر حفظ الصنف. ${error.message || "راجع البيانات والاتصال ثم حاول مرة أخرى."}`;
      showStatus(message, true);
    } finally {
      submit.disabled = false;
      submit.textContent = originalButtonText;
    }
  }

  async function saveCategory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const current = form.elements.id.value ? state.categories.find((item) => item.id === form.elements.id.value) : null;
      let imageUrl = current?.image_url || "";
      if (form.elements.image.files[0]) imageUrl = await uploadImage(form.elements.image.files[0], "categories");
      const row = {
        slug: current?.slug || slugPrefix("category"),
        name: form.elements.name.value.trim(),
        image_url: imageUrl,
        sort_order: current?.sort_order ?? state.categories.length + 1,
        updated_at: new Date().toISOString()
      };
      const result = current
        ? await state.client.from("categories").update(row).eq("id", current.id)
        : await state.client.from("categories").insert(row);
      if (result.error) throw result.error;
      resetCategoryForm();
      await loadDashboard();
      toast(current ? "اتحفظ تعديل القسم." : "اتضاف القسم.");
    } finally {
      submit.disabled = false;
    }
  }

  function resetCategoryForm() {
    const form = $("#category-form");
    form.reset();
    form.elements.id.value = "";
    form.elements.slug.value = "";
    $("#cancel-category-edit").hidden = true;
    form.querySelector('[type="submit"]').textContent = "حفظ القسم";
  }

  async function savePrices() {
    const inputs = [...document.querySelectorAll("[data-price-id]")];
    const updates = inputs.map((input) => ({ id: input.dataset.priceId, price: Number(input.value) }));
    const sizeInputs = [...document.querySelectorAll("[data-size-price-id]")];
    const sizeUpdates = sizeInputs.map((input) => ({ id: input.dataset.sizePriceId, price: Number(input.value) }));
    if ([...updates, ...sizeUpdates].some((item) => !Number.isFinite(item.price) || item.price < 0)) {
      showStatus("تأكد إن كل الأسعار أرقام صفر أو أكبر.", true);
      return;
    }
    const button = $("#save-prices-button");
    button.disabled = true;
    try {
      if (updates.length) {
        const { error } = await state.client.rpc("update_product_prices", { price_updates: updates });
        if (error) throw error;
      }
      if (sizeUpdates.length) {
        const { error } = await state.client.rpc("update_size_prices", { size_price_updates: sizeUpdates });
        if (error) throw error;
      }
      await loadDashboard();
      toast("اتحفظت كل الأسعار.");
    } finally {
      button.disabled = false;
    }
  }

  async function deleteProduct(id) {
    const product = state.products.find((item) => item.id === id);
    if (!product || !window.confirm(`متأكد إنك عايز تحذف «${product.name}»؟ الحذف نهائي.`)) return;
    const { error } = await state.client.from("products").delete().eq("id", id);
    if (error) throw error;
    await loadDashboard();
    toast("اتحذف الصنف.");
  }

  async function deleteCategory(id) {
    const category = state.categories.find((item) => item.id === id);
    if (!category || !window.confirm(`متأكد إنك عايز تحذف قسم «${category.name}»؟ لازم تنقل أو تحذف أصنافه الأول.`)) return;
    const { error } = await state.client.from("categories").delete().eq("id", id);
    if (error) throw error;
    await loadDashboard();
    toast("اتحذف القسم.");
  }

  async function toggleCategory(id, visible) {
    const { error } = await state.client.from("categories").update({ is_visible: visible, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    await loadDashboard();
    toast(visible ? "القسم بقى ظاهر للعملاء." : "القسم اتخفى من المتجر.");
  }

  async function reorderCategory(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const ordered = [...state.categories].sort((a, b) => a.sort_order - b.sort_order);
    const from = ordered.findIndex((item) => item.id === sourceId);
    const to = ordered.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    const results = await Promise.all(ordered.map((category, index) =>
      state.client.from("categories").update({ sort_order: index + 1 }).eq("id", category.id)));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    await loadDashboard();
    toast("اتحدث ترتيب الأقسام.");
  }

  async function moveCategory(id, direction) {
    const ordered = [...state.categories].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((item) => item.id === id);
    const target = ordered[index + direction];
    if (index >= 0 && target) await reorderCategory(id, target.id);
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const originalButtonText = submit.textContent;
    submit.disabled = true;
    submit.textContent = "جاري الحفظ...";
    try {
      const whatsapp = form.elements.whatsapp.value.replace(/\s/g, "");
      if (!/^\d{10,15}$/.test(whatsapp)) throw new Error("اكتب واتساب دولي بالأرقام فقط، مثل 2010XXXXXXXX.");
      const areas = [...$("#delivery-areas").querySelectorAll(".area-row")].map((row) => ({
        name: row.querySelector("[data-area-name]").value.trim(),
        fee: Number(row.querySelector("[data-area-fee]").value)
      }));
      if (areas.some((area) => !area.name || !Number.isFinite(area.fee) || area.fee < 0)) {
        throw new Error("راجع اسم ورسوم كل منطقة توصيل.");
      }
      const storeImages = { ...(state.settings?.store_images || {}) };
      for (const row of document.querySelectorAll("[data-store-image-row]")) {
        const key = row.dataset.imageKey;
        const input = row.querySelector("[data-image-file]");
        if (row.dataset.imageCleared === "true") delete storeImages[key];
        if (input.files[0]) {
          storeImages[key] = await uploadImage(input.files[0], "store", key === "logo");
        }
      }
      const value = {
        ...(state.settings || {}),
        shop_name: form.elements.shop_name.value.trim(),
        whatsapp,
        phone: form.elements.phone.value.trim(),
        working_hours: form.elements.working_hours.value.trim(),
        address: form.elements.address.value.trim(),
        map_url: form.elements.map_url.value.trim(),
        welcome_message: form.elements.welcome_message.value.trim(),
        minimum_order: Number(form.elements.minimum_order.value),
        order_paused: form.elements.order_paused.checked,
        delivery_areas: areas,
        store_images: storeImages
      };
      if (!Number.isFinite(value.minimum_order) || value.minimum_order < 0) throw new Error("الحد الأدنى لازم يكون صفر أو أكبر.");
      const { error } = await state.client.from("settings").upsert({ key: "shop", value, updated_at: new Date().toISOString() });
      if (error) throw error;
      state.settings = value;
      renderSettings();
      toast("اتحفظت إعدادات المحل.");
    } finally {
      submit.disabled = false;
      submit.textContent = originalButtonText;
    }
  }

  function selectTab(id) {
    document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === id));
    document.querySelectorAll(".panel").forEach((panel) => {
      const active = panel.id === id;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    if (id === "products-panel") renderCategorySelect();
  }

  function bindEvents() {
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      showStatus("جاري تسجيل الدخول...");
      try {
        const { data, error } = await state.client.auth.signInWithPassword({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value
        });
        if (error) throw error;
        if (data.user) await authorize(data.user);
      } catch (error) {
        reportError(error, "تعذر تسجيل الدخول. راجع البريد وكلمة المرور.");
      } finally {
        button.disabled = false;
      }
    });

    $("#signout-button").addEventListener("click", async () => {
      const { error } = await state.client.auth.signOut();
      if (error) reportError(error, "تعذر تسجيل الخروج.");
    });
    $("#dashboard").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-tab]");
      if (tab) selectTab(tab.dataset.tab);
      const move = event.target.closest("[data-move-category]");
      if (move) moveCategory(move.dataset.moveCategory, Number(move.dataset.direction)).catch((error) => reportError(error, "تعذر تغيير ترتيب الأقسام."));
      const edit = event.target.closest("[data-edit-product]");
      if (edit) editProduct(edit.dataset.editProduct);
      const delProduct = event.target.closest("[data-delete-product]");
      if (delProduct) deleteProduct(delProduct.dataset.deleteProduct).catch((error) => reportError(error, "تعذر حذف الصنف."));
      const editCategoryButton = event.target.closest("[data-edit-category]");
      if (editCategoryButton) {
        const category = state.categories.find((item) => item.id === editCategoryButton.dataset.editCategory);
        if (!category) return;
        const form = $("#category-form");
        form.elements.id.value = category.id;
        form.elements.slug.value = category.slug;
        form.elements.name.value = category.name;
        form.elements.image.value = "";
        $("#cancel-category-edit").hidden = false;
        form.querySelector('[type="submit"]').textContent = "حفظ التعديل";
        form.elements.name.focus();
      }
      const delCategory = event.target.closest("[data-delete-category]");
      if (delCategory) deleteCategory(delCategory.dataset.deleteCategory).catch((error) => reportError(error, "تعذر حذف القسم."));
      if (event.target.closest("[data-reset-product]")) resetProductForm();
      if (event.target.closest("#new-product-button")) {
        resetProductForm();
        $("#product-form").hidden = false;
        $("#product-form").scrollIntoView({ behavior: "smooth", block: "start" });
        $("#product-form").elements.name.focus({ preventScroll: true });
      }
      if (event.target.closest("#cancel-category-edit")) resetCategoryForm();
      if (event.target.closest("#add-area-button")) {
        const rows = [...$("#delivery-areas").querySelectorAll(".area-row")].map((row) => ({
          name: row.querySelector("[data-area-name]").value,
          fee: row.querySelector("[data-area-fee]").value
        }));
        rows.push({ name: "", fee: "" });
        renderAreas(rows);
        $("#delivery-areas .area-row:last-child [data-area-name]").focus();
      }
      if (event.target.closest("[data-remove-area]")) {
        if (!window.confirm("متأكد إنك عايز تحذف منطقة التوصيل دي؟")) return;
        event.target.closest(".area-row").remove();
      }
    });

    $("#product-form").addEventListener("submit", (event) => saveProduct(event).catch((error) => reportError(error, "تعذر حفظ الصنف.")));
    $("#product-form").elements.sale_type.addEventListener("change", changeSaleType);
    $("#add-size-option").addEventListener("click", () => {
      const options = readSizeOptions();
      options.push({ name: "", price: "", is_available: true });
      renderSizeOptions(options);
      $("#size-options-list .size-option-row:last-child [data-size-option-name]").focus();
    });
    document.querySelectorAll("[data-quick-size]").forEach((button) => {
      button.addEventListener("click", () => {
        const options = readSizeOptions();
        options.push({ name: button.dataset.quickSize, price: "", is_available: true });
        renderSizeOptions(options);
        $("#size-options-list .size-option-row:last-child [data-size-option-price]").focus();
      });
    });
    $("#size-options-list").addEventListener("click", (event) => {
      const moveButton = event.target.closest("[data-size-move]");
      if (moveButton) {
        const options = readSizeOptions();
        const row = moveButton.closest("[data-size-row]");
        const index = [...$("#size-options-list").children].indexOf(row);
        const target = index + Number(moveButton.dataset.sizeMove);
        if (target >= 0 && target < options.length) {
          const [moved] = options.splice(index, 1);
          options.splice(target, 0, moved);
          renderSizeOptions(options);
        }
        return;
      }
      const removeButton = event.target.closest("[data-remove-size]");
      if (!removeButton) return;
      if (removeButton.dataset.removeSize && !window.confirm("متأكد إنك عايز تحذف الحجم ده؟")) return;
      removeButton.closest(".size-option-row").remove();
      renderSizeOptions(readSizeOptions());
    });
    $("#size-options-list").addEventListener("input", updateQuickAddButtons);
    $("#category-form").addEventListener("submit", (event) => saveCategory(event).catch((error) => reportError(error, "تعذر حفظ القسم.")));
    $("#save-prices-button").addEventListener("click", () => savePrices().catch((error) => reportError(error, "تعذر حفظ الأسعار.")));
    $("#settings-form").addEventListener("submit", (event) => saveSettings(event).catch((error) => reportError(error, "تعذر حفظ الإعدادات.")));
    $("#store-image-settings").addEventListener("change", (event) => {
      const input = event.target.closest("[data-image-file]");
      if (!input) return;
      const row = input.closest("[data-store-image-row]");
      const file = input.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        input.value = "";
        showStatus("اختار ملف صورة صالح.", true);
        return;
      }
      const preview = row.querySelector("[data-image-preview]");
      const placeholder = row.querySelector("[data-image-placeholder]");
      if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      placeholder.hidden = true;
      row.dataset.imageCleared = "false";
    });
    $("#store-image-settings").addEventListener("click", (event) => {
      const clearButton = event.target.closest("[data-clear-store-image]");
      if (!clearButton) return;
      const row = clearButton.closest("[data-store-image-row]");
      const preview = row.querySelector("[data-image-preview]");
      if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
      row.querySelector("[data-image-file]").value = "";
      preview.removeAttribute("src");
      preview.hidden = true;
      row.querySelector("[data-image-placeholder]").hidden = false;
      row.dataset.imageCleared = "true";
    });

    $("#categories-list").addEventListener("change", (event) => {
      const toggle = event.target.closest("[data-toggle-category]");
      if (toggle) toggleCategory(toggle.dataset.toggleCategory, toggle.checked).catch((error) => reportError(error, "تعذر تغيير ظهور القسم."));
    });
    $("#categories-list").addEventListener("dragstart", (event) => {
      const row = event.target.closest("[data-category-row]");
      if (!row) return;
      state.draggedCategory = row.dataset.categoryRow;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    $("#categories-list").addEventListener("dragend", (event) => {
      event.target.closest("[data-category-row]")?.classList.remove("dragging");
      state.draggedCategory = null;
    });
    $("#categories-list").addEventListener("dragover", (event) => {
      if (event.target.closest("[data-category-row]")) event.preventDefault();
    });
    $("#categories-list").addEventListener("drop", (event) => {
      const target = event.target.closest("[data-category-row]");
      if (!target || !state.draggedCategory) return;
      event.preventDefault();
      reorderCategory(state.draggedCategory, target.dataset.categoryRow).catch((error) => reportError(error, "تعذر إعادة ترتيب الأقسام."));
    });
  }

  async function init() {
    bindEvents();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      showStatus("أضف رابط Supabase ومفتاح anon/publishable في config.js ثم أعد تحميل الصفحة.", true);
      $("#login-form").querySelector('[type="submit"]').disabled = true;
      return;
    }
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    try {
      if (!await checkSizesMigration()) return;
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      if (data.session?.user) await authorize(data.session.user);
      state.client.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          $login.hidden = false;
          $dashboard.hidden = true;
          $("#signout-button").hidden = true;
        }
      });
    } catch (error) {
      reportError(error, "تعذر الاتصال بـ Supabase.");
    }
  }

  init();
})();
