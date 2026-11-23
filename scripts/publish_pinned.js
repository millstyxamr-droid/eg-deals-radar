#!/usr/bin/env node
require('../src/config');
const telegram = require('../src/telegram');
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHANNEL_ID;

const pinnedText = `📢 <b>دليلك الشامل لتوفير مصاريف البيت والسوبرماركت على أمازون مصر</b> 🛒🇪🇬

أهلاً بكم في <b>رادار عروض أمازون مصر</b>!
هنا بنفحص أسعار آلاف المنتجات كل 6 ساعات، ونكشف الخصومات الحقيقية ونستبعد أي خصم وهمي، عشان تشتري بأرخص سعر حقيقي.

══════════════════════
📌 <b>روابط الأقسام والتخفيضات المباشرة:</b>
🛒 <a href="https://www.amazon.eg/b?node=21863836031&amp;tag=egdealsradar-21">قسم السوبرماركت والبقالة (Amazon Now)</a>
🧼 <a href="https://www.amazon.eg/b?node=21863842031&amp;tag=egdealsradar-21">المنظفات ومستلزمات العناية بالمنزل</a>
👶 <a href="https://www.amazon.eg/b?node=21863841031&amp;tag=egdealsradar-21">حفاضات ومستلزمات الأطفال</a>
☕ <a href="https://www.amazon.eg/b?node=21863846031&amp;tag=egdealsradar-21">الشاي والقهوة والمشروبات</a>
🍳 <a href="https://www.amazon.eg/b?node=21863849031&amp;tag=egdealsradar-21">أجهزة المطبخ والمنزل</a>

══════════════════════
💡 <b>قواعد التسوق الذكي معنا:</b>
1. كل العروض المنشورة هنا مفحوصة ومطابقة لسعر الوحدة (سعر الكيلو / اللتر).
2. تأكد دائماً أن البائع هو <b>أمازون مصر</b> لضمان التوصيل السريع والأصلي.
3. لو لقيت السعر اتغير أو المنتج خلص = العرض انتهى.

🔔 فعل التنبيهات عشان تلحق أي صفقة قوية قبل نفاد الكمية!`;

async function main() {
  try {
    const res = await telegram.sendMessage(chatId, pinnedText, { token, parse_mode: 'HTML' });
    const msgId = res.result ? res.result.message_id : res.message_id;
    console.log('[+] Directory post sent successfully, message_id:', msgId);
    await telegram.callTelegramApi(token, 'pinChatMessage', {
      chat_id: chatId,
      message_id: msgId,
      disable_notification: false
    });
    console.log('[✔] Message successfully PINNED at the top of the channel!');
  } catch (err) {
    console.error('[-] Error:', err.message);
  }
}

main();
