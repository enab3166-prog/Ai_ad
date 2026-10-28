# AI Ad Agent
## المزايا
- دردشة متعددة الأدوار مع AI عبر OpenRouter.
- إرسال صورة المنتج داخل المحادثة لتحليلها.
- إنشاء سيناريو/Caption/هاشتاغات/Prompt فيديو من صورة المنتج.
- توليد image-to-video عبر Runway عند إضافة RUNWAY_API_KEY.
- مفاتيح API تبقى على الخادم ولا توضع داخل HTML.

## Render
Build Command:
npm install

Start Command:
npm start

Environment Variables:
OPENROUTER_API_KEY
OPENROUTER_MODEL (مثلاً openrouter/free أو نموذج تختاره)
RUNWAY_API_KEY
RUNWAY_MODEL=gen4.5

الخدمة يجب أن تستمع على PORT و0.0.0.0.
