# برومتات التنفيذ — Amazon EG Scraper → منتج بيانات

> كل برومت مستقل وقابل للنسخ لوحده. الأفضل تنفّذهم بالترتيب، وتخلّص وتختبر كل واحد قبل اللي بعده.
> البرومت 0 (السياق) يتلصق **مع** كل برومت من 1 لـ 9.

---

## 0) برومت السياق (الصقه أول كل حاجة)

```text
انت مهندس Backend/Data بتشتغل على مشروع موجود اسمه amazon_eg_scraper (Node.js, CommonJS).
الملفات الحالية:
- full_store_scraper.js : Playwright scraper بيزحف أقسام Amazon Egypt Tez/Now (qcbrand=sAuWWBROaG) ويستخرج من كل كارت: asin, title, currentPriceNum, oldPriceNum, discount, category, productUrl, imgSrc.
- deals_tracker.js : بيقرأ products.json + price_history.json ويحسب "خصم" بمقارنة السعر بسعر أمازون المعلن (oldPriceNum) أو بأعلى سعر شافه.
- export_data.js : بيولّد CSV + Excel XML + index.html من products.json.
- categories.json : 33 قسم بـ nodeId.
- products.json / price_history.json / deals_report.json : التخزين الحالي (JSON files).

قواعد ثابتة لازم تلتزم بيها في كل تعديل:
1. متكسرش أي سلوك شغال حالياً؛ أي تغيير في الـ schema لازم يبقى معاه migration + fallback.
2. كود CommonJS، بدون TypeScript، بدون frameworks. متضيفش dependencies غير اللي أطلبها.
3. كل المسارات عبر path.join(__dirname, ...) ومفيش hardcoded absolute paths.
4. الأسعار أرقام EGP (REAL)، ومفيش parse في لحظة العرض — التنظيف وقت الـ ingest.
5. أي عملية شبكة (scrape أو Telegram) لازم يكون معاها timeout + retry + log واضح.
6. في الآخر اعمل ملخص: الملفات اللي اتغيرت، الـ schema، وأوامر التشغيل/الاختبار.
```

---

## 1) برومت SQLite + migration

```text
المطلوب: استبدال التخزين من JSON files إلى SQLite باستخدام better-sqlite3، مع الإبقاء على JSON كـ export فقط.

نفّذ:
1. npm i better-sqlite3 (و Playwright موجود بالفعل).
2. اعمل src/db.js يفتح data/catalog.db، WAL mode، foreign_keys ON، busy_timeout 5000، وبيبني الـ schema لو مش موجودة.
3. الـ schema (سمّيها زي ما هي بالظبط):

categories(id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, name_ar TEXT, node_id TEXT UNIQUE, url TEXT, depth INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, last_scraped_at TEXT)

products(asin TEXT PRIMARY KEY, title TEXT NOT NULL, title_norm TEXT, brand TEXT, category_id TEXT, image_url TEXT, product_url TEXT, weight_value REAL, weight_unit TEXT, pack_count INTEGER DEFAULT 1, size_text TEXT, unit_price REAL, unit_price_unit TEXT, first_seen_at TEXT, last_seen_at TEXT, is_active INTEGER DEFAULT 1, FOREIGN KEY(category_id) REFERENCES categories(id))

price_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, asin TEXT NOT NULL, run_id TEXT, scraped_at TEXT NOT NULL, price REAL, list_price REAL, in_stock INTEGER DEFAULT 1, discount_badge TEXT, source TEXT, FOREIGN KEY(asin) REFERENCES products(asin))
+ INDEX idx_snap_asin_time ON price_snapshots(asin, scraped_at)
+ INDEX idx_snap_time ON price_snapshots(scraped_at)

alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, asin TEXT NOT NULL, rule TEXT NOT NULL, threshold REAL, price REAL, triggered_at TEXT NOT NULL, sent_at TEXT, channel TEXT, payload TEXT, UNIQUE(asin, rule, triggered_at))

runs(id TEXT PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, pages_total INTEGER, pages_ok INTEGER, pages_failed INTEGER, items_upserted INTEGER, error TEXT)

4. اعمل src/repo.js فيه دوال: upsertCategory, upsertProduct, insertSnapshot, getLatestSnapshot, getPriceStats(asin, days), recordRun/updateRun, logAlert, wasAlertSent(asin, rule, withinHours).
5. اعمل migrate_from_json.js : يقرأ products.json + price_history.json + categories.json ويحوّلهم للجداول. price_history.json فيه history array — كل عنصر يبقى صف في price_snapshots. يكون idempotent (تشغيله مرتين ميكررش بيانات) وبيطبع تقرير: كام صف اتضاف/اتخطى.
6. عدّل full_store_scraper.js و deals_tracker.js يستخدموا الـ repo بدل fs.writeFileSync. سيب export_data.js شغال من الداتابيز (اعمل دالة getProductsForExport()).
7. ضيف npm scripts: "db:migrate", "db:stats".

الاختبار المطلوب:
- شغّل db:migrate مرتين، والمرة التانية تضيف 0 صفوف.
- SELECT COUNT(*) من كل جدول يطابق أرقام JSON الأصلية (قارن بنفسك واكتب النتيجة).
- شغّل deals_tracker.js بعد الـ migration واتأكد إن deals_report.json بيتولد بنفس الشكل القديم.

ممنوع: تحذف ملفات JSON. ممنوع: تستخدم sqlite3 أو ORM.
```

---

## 2) برومت المتانة + التغطية + تطبيع العناوين

```text
المطلوب 3 حاجات في full_store_scraper.js:

(أ) Retry/Backoff + حفظ تدريجي لكل صفحة (مش لكل قسم):
- اعمل helper: withRetry(fn, {retries:3, baseDelay:1500, factor:2, jitter:true}) — exponential backoff مع jitter، ويسجّل كل محاولة.
- الأخطاء القابلة للإعادة: timeout, net::ERR_*, 429, 5xx, navigation aborted. الأخطاء غير القابلة (404/403) تفشل فوراً.
- بعد كل صفحة/قسم ناجح: upsert المنتجات + snapshot واحد لكل منتج في transaction واحدة، وحدّث runs.pages_ok. لو القسم فشل، متوقفش الـ run — سجّل الفشل في runs.pages_failed وكمّل.
- اعمل checkpoint: جدول runs + عمود last_page عشان لو الـ run اتقطع يكمل من آخر قسم ناجح (flag --resume).
- زوّد timeout للـ goto لـ 60s، وحدد max 3 tabs متوازية كحد أقصى (context.newPage لكل قسم، وأقفلها في finally).

(ب) التغطية لـ 110 قسم:
- وسّع categories.json من 33 لـ 110 قسم بنفس شكل {id,name,nodeId,url}. استخرج الـ nodeIds من صفحات Amazon Now الفعلية (بـ Playwright: افتح القسم الأب واجمع روابط browse/explore/category?nodeId=...).
- املأ categories بـ depth و parent_id (الأب/الابن).
- ضيف fallback: لو nodeId رجع 0 منتجات مرتين متتاليتين، علّمه is_active=0 واطبعه في تقرير.
- شغّل dry-run بـ --limit 5 أقسام قبل الـ full run.

(ج) تطبيع ومنع التكرار + brand/weight/size:
- اعمل src/normalize.js فيه:
  normalizeTitle(t): lowercase، توحيد أ/إ/آ→ا، ى→ي، ة→ه، شيل التشكيل، شيل الرموز والمسافات الزيادة، شيل كلمات ترويجية (عرض خاص، خصم، جديد، توصيل مجاني، ×2، pack).
  extractBrand(t): من أول 1-3 كلمات + dictionary براندات مصرية (Domty, Juhayna, Edita, Almarai, Nestlé, Pepsi, Coca-Cola, Unilever, P&G, ...).
  parseSize(t): regex يدعم "1 كجم", "500 جم", "1.5 لتر", "750 مل", "6 × 100 جم", "12 قطعة", "×2". رجّع {weight_value, weight_unit, pack_count, size_text} موحّد: كجم/جم/لتر/مل/قطعة.
- المنتج المكرر = نفس (title_norm + brand + weight_value + weight_unit) بغض النظر عن الـ ASIN.
- اعمل جدول product_duplicates(canonical_asin, duplicate_asin, reason) وسجّل التكرارات بدل ما تحذفها.
- في العرض/التصدير: اعرض canonical فقط (أرخص سعر حالياً بين المكررين)، والباقي is_active=0 مع سبب duplicate.
- ضيف عمود brand, weight_value, weight_unit, size_text في export_data.js (CSV + Excel).

الاختبار المطلوب:
- سكربت test/normalize.test.js (node:test) بـ 20 حالة: عناوين عربي/إنجليزي/مختلط، أحجام، باكدجات.
- تقرير قبل/بعد: عدد المنتجات، عدد التكرارات المكتشفة، عدد المنتجات اللي اتطبع لها brand وweight (نسبة %).
```

---

## 3) برومت محرك الخصم التاريخي + سعر الوحدة (أهم خطوة)

```text
المطلوب: إصلاح منطق الخصم بحيث ميعتمدش على سعر أمازون المعلن، ويضيف سعر الوحدة.

(أ) الإحصاءات التاريخية — src/pricing.js:
- getPriceStats(asin, days) ترجع من price_snapshots آخر N يوم: count, min, max, p10, p30, median(p50), p90, last_price, days_observed.
- احسب percentiles بـ SQL (ORDER BY price + offset) أو في JS — بس لازم تكون deterministic.
- اعمل نافذتين: 30 يوم و 90 يوم.

(ب) قواعد تصنيف العرض (استبدل realDiscountPct القديم):
- fair_price = p30 (90 يوم). typical_price = median (90 يوم).
- historical_discount_pct = round((typical_price - price) / typical_price * 100).
- is_real_deal = price <= fair_price AND price < typical_price * 0.95 AND days_observed >= 7 AND count >= 5.
- confidence: 'high' لو days_observed>=30 و count>=20، 'medium' لو >=7/>=5، 'low' غير كده (low متظهرش في صفحة العروض، بس تتسجل).
- all_time_low = price <= min على كل التاريخ.
- advertised_discount_pct = من oldPriceNum — يتخزن كـ context فقط، ومستخدمش في الترتيب ولا في is_real_deal.
- سجّل في جدول deals_scores(asin, run_id, fair_price, typical_price, historical_discount_pct, advertised_discount_pct, is_real_deal, confidence, all_time_low, computed_at).
- لو المنتج جديد (مفيش تاريخ): متحسبش خصم تاريخي، اعرض "لسه بنجمع بيانات" بدل رقم مضلل.

(ج) سعر الوحدة — unit price:
- من weight_value/weight_unit/pack_count احسب:
  solids (كجم/جم): unit_price = price / (weight_kg) → EGP/kg
  liquids (لتر/مل): unit_price = price / (liters) → EGP/L
  countable (قطعة): unit_price = price / pack_count → EGP/piece
- خزّن unit_price + unit_price_unit في products، واعرض في الـ exports كعمود "ج.م/كجم" أو "ج.م/لتر".
- اعمل دالة formatUnitPrice() بالعربي: "٤٥.٥ ج.م/كجم".
- لو الحجم مش معروف: unit_price = NULL واعرض "—" (ممنوع تخمين).
- ضيف flag --unit-price-audit يطبع: كام منتج اتحسب له سعر وحدة، وكام فشل وليه (regex miss).

(د) مقارنة داخلية (اختياري لكن مفيد): لكل (category_id + weight_unit) احسب median سعر الوحدة، وسجّل price_index = unit_price / category_median_unit_price. ده اللي هيبني تقرير الـ B2B بعدين.

الاختبار:
- اعمل test/pricing.test.js ببيانات مصطنعة: منتج سعره ثابت 100 لمدة 30 يوم ثم بقى 70 → لازم يطلع is_real_deal=true و historical_discount_pct=30.
- منتج سعره 70 من أول يوم (مفيش تاريخ) → is_real_deal=false و confidence='low'.
- 10 حالات سعر وحدة (1 كجم، 500 جم، 6×100 جم، 1.5 لتر، 750 مل، 12 قطعة...).

ممنوع: أي منطق خصم يعتمد على oldPriceNum كأساس. oldPriceNum يفضل metadata بس.
```

---

## 4) برومت GitHub Actions cron

```text
المطلوب: تشغيل تلقائي كل 6 ساعات على GitHub Actions مجاناً.

1. .github/workflows/scrape.yml:
   - on: schedule cron "0 */6 * * *" + workflow_dispatch (بـ input للـ --limit و --resume).
   - concurrency: group scrape, cancel-in-progress: false.
   - timeout-minutes: 90.
   - steps: checkout → setup-node 20 (cache npm) → npm ci → npx playwright install --with-deps chromium → node full_store_scraper.js → node deals_tracker.js → node export_data.js.
   - secrets: AMAZON_AFFILIATE_TAG, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (لو موجودين).
   - artifact: ارفع data/catalog.db + deals_report.json + التقارير (retention 14 يوم).

2. مشكلة الـ DB في git (مهم):
   - متعملش commit لـ data/catalog.db على main (ملف binary بيكبر ويبوّظ الـ diffs).
   - اعمل خطوة ترفع snapshot مضغوط (gzip) لـ artifact، وخطوة restore بتجيب آخر artifact ناجح قبل الـ run (actions/download-artifact مع github-token، أو cache key بالتاريخ).
   - بديل أنضف لو المستخدم عايز: ارفع على Cloudflare R2 / S3 عبر aws cli (خليه optional بـ secret).
   - اكتب في الـ README شرح واضح: إزاي الداتا بتتحفظ بين الـ runs، وإيه اللي بيحصل لو الـ artifact انتهت مدته (fallback: run كامل جديد).

3. صحة الـ run:
   - سكربت scripts/healthcheck.js يطبع: عدد المنتجات، عدد snapshots آخر 24 ساعة، نسبة الأقسام اللي رجعت 0، وأي قسم فشل 3 مرات.
   - لو pages_ok == 0 → exit 1 عشان الـ workflow يبان أحمر.
   - ضيف badge في README.

4. التوقيت: cron بتوقيت UTC. اكتب في الـ README إن 0 */6 * * * = كل 6 ساعات بتوقيت UTC (فرق القاهرة +2/+3)، وإن GitHub بيأخر أحياناً 5-15 دقيقة.

الاختبار: شغّل workflow_dispatch يدوياً بـ --limit 2 وأكد إن artifact نزل وإن الـ run أخضر.
```

---

## 5) برومت بوت تليجرام للتنبيهات

```text
المطلوب: بوت تليجرام تنبيهات، Bot API مباشرة (fetch، بدون مكتبات).

1. src/telegram.js:
   - sendMessage(chatId, html, {retries:3}) — parse_mode HTML، disable_web_page_preview، وretry على 429 مع احترام retry_after.
   - sendPhoto للصورة + caption (لو الصورة فشلت، fallback نص).
   - escapeHtml() إجباري على كل نص جاي من الداتا.
   - throttle: 20 رسالة/ثانية كحد أقصى، و1 ثانية بين رسائل نفس الشات.

2. bot.js (long polling، شغّال على VPS أو locally):
   - /start → رسالة ترحيب + الأوامر.
   - /watch <رابط أمازون أو ASIN> → يضيف في watchlist (DB) ويأكد بالاسم والسعر الحالي.
   - /unwatch <ASIN>
   - /list → قائمة المراقبة بأسعارها الحالية وسعر الوحدة.
   - /deals [عدد] → أفضل N عرض حقيقي من deals_scores (confidence high/medium فقط).
   - /stop → يوقف التنبيهات للمستخدم.
   - أي رسالة غير معروفة → مساعدة مختصرة.
   - whitelist: ALLOWED_CHAT_IDS في .env (مفيش بوت مفتوح للعامة).

3. قواعد التنبيه (src/alerts.js) — تُنفّذ بعد كل run:
   - price_drop: السعر نزل >= 10% عن آخر snapshot.
   - target_price: السعر <= target حدده المستخدم.
   - historical_low: all_time_low == true.
   - back_in_stock: in_stock انتقل من 0 لـ 1.
   - منع التكرار: جدول alerts + wasAlertSent(asin, rule, withinHours:24) — مفيش نفس التنبيه مرتين في 24 ساعة.
   - كل تنبيه فيه: العنوان، السعر القديم/الجديد، نسبة الخصم التاريخي، سعر الوحدة، لينك بأفلييت، وصورة.
   - digest يومي الساعة 9 صباحاً بتوقيت القاهرة: ملخص أفضل 10 عروض.

4. .env.example: TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, AMAZON_AFFILIATE_TAG.
5. npm scripts: "bot", "alerts".

الاختبار: mock لـ fetch في test/telegram.test.js (نجاح، 429، 500، HTML فيه < >). وشغّل البوت يدوياً وجرب /start و /deals.
```

---

## 6) برومت قناة تليجرام + حقن الأفلييت

```text
المطلوب: قناة تليجرام للنشر التلقائي 10-15 بوست/يوم، وكل لينك فيه tag الأفلييت.

(أ) الأفلييت — src/affiliate.js:
- withAffiliate(url): يضيف/يستبدل tag=<AMAZON_AFFILIATE_TAG> في أي رابط amazon.eg (يدعم /dp/ASIN و /tez/... مع query موجود).
- يشتغل وقت العرض/النشر، مش وقت التخزين — عشان لو الـ tag اتغير كل حاجة تتحدث.
- لو الـ env فاضي: يرجع الرابط زي ما هو ويطبع warning مرة واحدة.
- يضيف utm_source=telegram&utm_medium=channel&utm_campaign=<slot> للتحليلات.
- test/affiliate.test.js: رابط بدون query، رابط بـ query، رابط فيه tag قديم، رابط مش أمازون (يترجع زي ما هو).

(ب) جدول النشر: channel_queue(id, asin, slot, scheduled_at, status, posted_at, message_id, error)
- UNIQUE(asin, slot) عشان مفيش نفس المنتج مرتين في نفس اليوم.
- status: pending → posted / failed / skipped.

(ج) المولّد — src/channel_post.js:
- اختار من deals_scores (is_real_deal=1, confidence high/medium) بترتيب: تنوع أقسام (max 2 من نفس القسم)، سعر الوحدة الأفضل، ومنتجات مش اتنشرت آخر 7 أيام.
- 10-15 بوست/يوم على مواعيد القاهرة: 9,11,13,15,17,19,21,23 + إضافي في الذروة.
- صيغة البوست (عربي مصري، مختصر):
  🔥 <اسم المنتج>
  السعر: X ج.م (كان Y) — أقل من سعره المعتاد Z%
  الوحدة: 45.5 ج.م/كجم
  🛒 <لينك أفلييت>
  #<القسم> #عروض_النهاردة
- صورة المنتج (sendPhoto) + fallback نص لو الصورة ناقصة أو < 200px.
- ممنوع: كلمات مبالغة كاذبة، ممنوع "أرخص سعر في مصر" إلا لو all_time_low فعلاً.
- كل بوست يتسجل في channel_queue قبل الإرسال (pending) وبعده (posted) — عشان لو العملية وقعت مفيش تكرار.

(د) المشغّل: scripts/post_channel.js بيتنادى من cron كل ساعة، بيبعت البوستات اللي scheduled_at <= now و status=pending. rate limit 20/دقيقة.

الاختبار: dry-run flag --dry-run يطبع البوستات في الكونسول بدون إرسال. وشوف أول 5 بوستات بعينك قبل ما تفعّل.
```

---

## 7) برومت صفحة "أفضل عروض النهاردة"

```text
المطلوب: صفحة ثابتة تتولد أوتوماتيك من الداتابيز (مش من JSON يدوي).

1. src/build_deals_page.js يطلّع dist/index.html (وبلاش frameworks، HTML/CSS/JS خالص):
   - Hero: "أفضل عروض النهاردة — <التاريخ بالعربي>" + عدد العروض + آخر تحديث.
   - فلاتر: القسم، نطاق السعر، "% الخصم التاريخي"، "أقل سعر تاريخي فقط"، "فيه سعر وحدة".
   - كل كارت: صورة lazy، العنوان، السعر، السعر المعتاد (median 90 يوم) مش سعر أمازون المعلن، نسبة الخصم التاريخي، سعر الوحدة، شارة "أقل سعر تاريخي" لو all_time_low، لينك أفلييت.
   - الترتيب الافتراضي: historical_discount_pct مع شرط confidence != low.
   - استبعد: confidence=low، منتجات من غير صورة، ومنتجات ملهاش سعر.
   - responsive (موبايل أولاً)، RTL، خط عربي system، dark mode بـ prefers-color-scheme.
   - SEO: title/description عربي، og:image، JSON-LD ItemList، canonical.
   - أداء: صور loading="lazy"، مفيش JS frameworks، الصفحة < 500KB.

2. src/build_brand_pages.js (اختياري): صفحة لكل براند /brand/<slug> فيها كل منتجاته مرتبة بسعر الوحدة — دي اللي هتستخدمها في الـ B2B.

3. النشر: .github/workflows/pages.yml ينشر dist/ على GitHub Pages بعد كل run ناجح. أو Cloudflare Pages لو عايز دومين.

4. npm script: "build:site".

الاختبار: افتح dist/index.html محلياً، جرّب الفلاتر، واتأكد إن كل لينك فيه tag الأفلييت وإن مفيش منتج confidence=low ظاهر.
```

---

## 8) برومت تقرير B2B PDF لبراند

```text
المطلوب: تقرير PDF احترافي لبراند واحد (مثال: Domty أو Juhayna) يتولّد من الداتابيز بأمر واحد.

1. scripts/brand_report.js --brand "Domty" --days 30 --out reports/domty-2026-11.pdf

2. المحتوى (عربي RTL + أرقام إنجليزي):
   - الغلاف: اسم البراند، الفترة، تاريخ التوليد، "تقرير أسعار المنافسة — Amazon Now / Tez".
   - ملخص تنفيذي (5 نقاط): عدد منتجات البراند، متوسط سعر الوحدة مقابل متوسط السوق، عدد المنتجات اللي سعرها أعلى من الوسيط، عدد حالات نفاد المخزون، أكبر فرق سعري مع منافس.
   - جدول أسعار المنافسين: لكل منتج من منتجات البراند → السعر، سعر الوحدة، أقرب 3 منافسين (نفس الفئة + نفس الحجم ±20%)، فرق السعر %، مين الأرخص.
   - نفاد المخزون: منتجات البراند اللي كانت in_stock=0 في أي snapshot آخر 30 يوم + نسبة الوقت اللي كانت فيه غير متاحة + آخر مرة اتشافت متاحة.
   - عروض آخر 30 يوم: عدد المرات اللي السعر نزل تحت p30، أعمق خصم، متوسط مدة العرض، وهل العروض كانت متزامنة مع عروض المنافسين.
   - مؤشر السعر (price index): unit_price / median(unit_price) للفئة — رسم بياني بسيط (SVG أو CSS bars، بدون مكتبات رسم تقيلة).
   - المنهجية + disclaimer في الآخر: البيانات مرصودة آلياً من صفحات عامة، الأسعار لحظة الرصد، مش نصيحة تسعير.

3. التوليد: HTML → PDF بـ Playwright (صفحة HTML مؤقتة + page.pdf({format:'A4', printBackground:true})). ده أضمن حل للعربي من pdfkit. الخط: استخدم خط عربي محلي في assets/fonts (Cairo أو Noto Naskh) مع @font-face.
4. الحسابات كلها في SQL/JS في src/report_queries.js (مفيش أرقام محسوبة يدوي في القالب).
5. لو البراند مالوش داتا كفاية (<10 منتجات أو <7 أيام): اطبع تحذير في التقرير نفسه "بيانات غير كافية" بدل ما تطلع أرقام مضللة.
6. npm script: "report:brand".

الاختبار: ولّد تقرير Domty، افتحه، واتأكد إن العربي مش مقطّع، الجداول مش طالعة من الصفحة، والأرقام مطابقة لاستعلام SQL مباشر على 3 منتجات عشوائية.
```

---

## 9) برومت التشغيل التجاري (اختياري — بعد ما الأساس يشتغل)

```text
المطلوب: تحويل المشروع لمنتج بيجيب فلوس، بدون كود زيادة.

1. reports/outreach.md: قالب إيميل/واتساب قصير بالعربي (تحت 120 كلمة) لمدير تسويق/تجاري في براند أو موزع:
   - سطر أول فيه قيمة محددة (مثال: "Domty عندها 3 منتجات سعرها أعلى من الوسيط بـ 12% على Amazon Now النهاردة").
   - 3 أرقام من التقرير الفعلي.
   - عرض: تقرير كامل مجاني أسبوعياً لمدة شهر.
   - CTA واحد بس.
2. scripts/prospect_list.js: يطلّع من الداتابيز أعلى 20 براند بعدد المنتجات + وجود نفاد مخزون + تقلبات سعر — دي قائمة العملاء المحتملين مرتبة بالأولوية.
3. scripts/lead_report.js --brand X: يولّد نسخة PDF مخصوصة لعميل محتمل (نفس تقرير البرومت 8 + صفحة "الفرص" فيها 3 توصيات محددة).
4. سكربت scripts/weekly_digest.js: يجهّز 3 ملفات PDF كل أسبوع لـ 3 براندات مختلفة + جدول متابعة في CSV (اتبعث/اتقرأ/رد).
5. اكتب في README قسم "التشغيل" بس: إيه اللي بيتشغل امتى، وإيه اللي محتاج مراجعة بشرية قبل الإرسال.

ممنوع: إرسال تلقائي بالإيميل من غير موافقة بشرية. الملفات تتولد، والإنسان هو اللي يبعت.
```

---

## ترتيب التنفيذ المقترح

| # | البرومت | الوقت التقديري | بيعتمد على |
|---|---------|----------------|------------|
| 1 | SQLite + migration | 2–3 ساعات | — |
| 2 | Retry + 110 قسم + تطبيع | 4–6 ساعات | 1 |
| 3 | محرك الخصم + سعر الوحدة | 3–4 ساعات | 1، 2 |
| 4 | GitHub Actions | 1–2 ساعة | 1، 3 |
| 5 | بوت التنبيهات | 2–3 ساعات | 1، 3 |
| 6 | القناة + الأفلييت | 3–4 ساعات | 3، 5 |
| 7 | صفحة العروض | 2–3 ساعات | 3 |
| 8 | تقرير B2B PDF | 3–4 ساعات | 2، 3 |
| 9 | التشغيل التجاري | 2 ساعة | 8 |

## 5 ملاحظات تنفيذية قبل ما تبدأ

1. **`better-sqlite3` على ويندوز**: بيجي prebuilt binaries لـ Node 20/22، لكن لو فشل التثبيت محتاج Visual Studio Build Tools. على GitHub Actions (`ubuntu-latest`) بيمشي عادي.
2. **الـ DB في git**: أكبر غلطة شائعة. `catalog.db` بيكبر بسرعة مع snapshots كل 6 ساعات (ملايين الصفوف بعد شهور). استخدم artifact أو R2/S3، واعمل `VACUUM` + retention policy (مثلاً احتفظ بالـ snapshots اليومية كاملة، وبعد 90 يوم خزّن snapshot واحد/يوم).
3. **الاحترام والـ rate limits**: 110 قسم × كل 6 ساعات = حمل كبير. خليك على تبويب واحد أو اتنين، delay عشوائي 2–5 ثواني بين الأقسام، ومتعملش parallel كبير. راجع شروط استخدام أمازون قبل التوسع؛ البيانات العامة للاستخدام الشخصي/التحليلي غير نفس إعادة النشر التجاري.
4. **الأفلييت**: أمازون مصر بتطلب حساب Associates معتمد. الـ `tag=` مش هيشتغل قبل الموافقة، واللينك من غير tag مش هيربح حاجة — فاختبره قبل ما تبني القناة عليه.
5. **البيانات قبل الأتمتة**: أول 2–3 أسابيع مفيش تاريخ كفاية، فمحرك الخصم هيرجع `confidence=low` لكل حاجة. ده طبيعي — سيب الـ cron يشتغل وابني التقارير بعد ما توصل 7 أيام على الأقل. متزعلش إن صفحة العروض فاضية في أول أسبوع.
