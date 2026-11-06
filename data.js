window.SHOP_CATEGORIES = [
  { id: "beef", name: "كندوز وبتلو", image: "categories/cat-beef.jpg", icon: "🥩" },
  { id: "lamb", name: "ضاني", image: "categories/cat-lamb.jpg", icon: "🍖" },
  { id: "minced", name: "مفروم وكفتة", image: "categories/cat-minced.jpg", icon: "🍔" },
  { id: "processed", name: "سجق ومصنعات", image: "categories/cat-processed.jpg", icon: "🌭" },
  { id: "offal", name: "كبدة وكوارع", image: "categories/cat-offal.jpg", icon: "🍲" },
  { id: "offers", name: "عروض وشنط", image: "categories/cat-beef.jpg", icon: "🎁" }
];

window.SHOP_PRODUCTS = [
  { id: "beef-cubes", name: "مكعبات كندوز", category: "beef", saleType: "weight", price: 350, unit: "kg", featured: true, description: "مكعبات جاهزة للطبيخ", image: "products/beef-cubes.jpg" },
  { id: "beef-steak", name: "ستيك كندوز", category: "beef", saleType: "weight", price: 420, unit: "kg", featured: true, description: "شرائح متساوية، على طلبك", image: "products/beef-steak.jpg" },
  { id: "beef-shank", name: "موزة كندوز", category: "beef", saleType: "weight", price: 330, unit: "kg", featured: false, description: "مناسبة للفتة والطواجن", image: "products/beef-shank.jpg" },
  { id: "veal", name: "بتلو صافي", category: "beef", saleType: "weight", price: 390, unit: "kg", featured: false, description: "طري وخفيف", image: "products/veal.jpg" },
  { id: "lamb-chops", name: "ريش ضاني", category: "lamb", saleType: "weight", price: 520, unit: "kg", featured: true, description: "تقطيع وتجهيز حسب رغبتك", image: "products/lamb-chops.jpg" },
  { id: "lamb-leg", name: "فخدة ضاني", category: "lamb", saleType: "weight", price: 480, unit: "kg", featured: false, description: "كاملة أو مقطعة", image: "products/lamb-leg.jpg" },
  { id: "lamb-cubes", name: "مكعبات ضاني", category: "lamb", saleType: "weight", price: 460, unit: "kg", featured: false, description: "للطواجن والمشاوي", image: "products/lamb-cubes.jpg" },
  { id: "lamb-mince", name: "مفروم ضاني", category: "lamb", saleType: "weight", price: 440, unit: "kg", featured: false, description: "فرم حسب الطلب", image: "products/lamb-mince.jpg" },
  { id: "minced-beef", name: "لحم مفروم", category: "minced", saleType: "weight", price: 320, unit: "kg", featured: true, description: "درجة الفرم على طلبك", image: "products/minced-beef.jpg" },
  { id: "kofta", name: "كفتة متبلة", category: "minced", saleType: "weight", price: 280, unit: "kg", featured: true, description: "خلطة بيتية جاهزة للشوي", image: "products/kofta.jpg" },
  { id: "burger", name: "برجر لحمة", category: "minced", saleType: "weight", price: 300, unit: "kg", featured: false, description: "قطع جاهزة للتسوية", image: "products/burger.jpg" },
  { id: "hawawshi", name: "خلطة حواوشي", category: "minced", saleType: "weight", price: 290, unit: "kg", featured: false, description: "متبلة وجاهزة للحشو", image: "products/hawawshi.jpg" },
  { id: "hawawshi-size-demo", name: "حواوشي", category: "minced", saleType: "size", price: 60, unit: "piece", sizes: [{ id: "hawawshi-small", name: "صغير", price: 35, available: true }, { id: "hawawshi-medium", name: "وسط", price: 48, available: true }, { id: "hawawshi-large", name: "كبير", price: 60, available: true }], featured: true, description: "صنف تجريبي — أسعار وأحجام للعرض", image: "products/hawawshi.jpg" },
  { id: "sausage", name: "سجق بلدي", category: "processed", saleType: "weight", price: 300, unit: "kg", featured: true, description: "تتبيلة شرقي", image: "products/sausage.jpg" },
  { id: "liver-sausage", name: "سجق بالكبدة", category: "processed", saleType: "weight", price: 310, unit: "kg", featured: false, description: "متجهز للطبيخ", image: "products/liver-sausage.jpg" },
  { id: "burger-pack", name: "برجر بيتي (القطعة)", category: "processed", saleType: "piece", price: 35, unit: "piece", featured: false, description: "قطعة جاهزة للشوي", image: "products/burger-pack.jpg" },
  { id: "liver", name: "كبدة بلدي", category: "offal", saleType: "weight", price: 290, unit: "kg", featured: true, description: "شرائح أو مكعبات", image: "products/liver.jpg" },
  { id: "kidney", name: "كلاوي", category: "offal", saleType: "weight", price: 220, unit: "kg", featured: false, description: "تنظيف وتجهيز حسب الطلب", image: "products/kidney.jpg" },
  { id: "tripe", name: "كرشة منظفة", category: "offal", saleType: "weight", price: 180, unit: "kg", featured: false, description: "تنظيف وتجهيز", image: "products/tripe.jpg" },
  { id: "box-family", name: "شنطة العيلة (عينة)", category: "offers", saleType: "piece", price: 950, unit: "pack", featured: true, description: "تشكيلة متنوعة — سعر تجريبي", image: "products/box-family.jpg" },
  { id: "grill-box", name: "شنطة المشاوي (عينة)", category: "offers", saleType: "piece", price: 1100, unit: "pack", featured: false, description: "تشكيلة مشاوي — سعر تجريبي", image: "products/grill-box.jpg" },
  { id: "weekly-box", name: "شنطة الأسبوع (عينة)", category: "offers", saleType: "piece", price: 1200, unit: "pack", featured: false, description: "تشكيلة للبيت — سعر تجريبي", image: "products/weekly-box.jpg" }
];
