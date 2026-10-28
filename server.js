
const SYSTEM = `أنت AI Ad Maker PRO، مساعد تسويق ذكي لجميع المتاجر والأنشطة التجارية.
ساعد المستخدم في تسويق أي منتج أو خدمة، وكتابة إعلانات جذابة.
حلل صور المنتجات بدقة، ولا تخترع معلومات أو أسعاراً أو مكونات غير معروفة.
اكتب باللهجة أو اللغة التي يطلبها المستخدم.
أنشئ Hook جذاباً، ومشاهد وحواراً عند الحاجة، ودعوة واضحة للشراء (CTA)، وكابشن وهاشتاغات.
عند إعداد إعلان فيديو، اقترح مدة 8 أو 15 أو 30 ثانية حسب طلب المستخدم.
عند كتابة برومبت فيديو، اطلب الحفاظ على شكل المنتج ولونه وعبوته وشعاره والنصوص الظاهرة في صورة المرجع.
لا تدّعِ إنشاء فيديو فعلياً ما لم يتم استخدام خدمة توليد فيديو بنجاح.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function imageDataUri(file) {
  if (!file || !file.size) return null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 8192;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return `data:${file.type || "image/jpeg"};base64,${btoa(binary)}`;
}

async function askAI(env, content) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "لم تتم إضافة مفتاح OpenRouter إلى إعدادات Cloudflare."
    );
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "AI Ad Maker PRO"
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || "openrouter/free",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content }
        ],
        temperature: 0.7
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result?.error?.message ||
      "تعذر الاتصال بخدمة الذكاء الاصطناعي."
    );
  }

  return result?.choices?.[0]?.message?.content ||
    "لم يرجع النموذج نتيجة.";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname === "/api/health"
    ) {
      return json({
        ok: true,
        openrouter: Boolean(env.OPENROUTER_API_KEY)
      });
    }

    if (
      request.method === "POST" &&
      (
        url.pathname === "/api/script" ||
        url.pathname === "/api/chat"
      )
    ) {
      try {
        const form = await request.formData();
        const message = String(
          form.get("message") || ""
        ).trim();

        const file = form.get("image");
        const hasImage =
          file &&
          typeof file.arrayBuffer === "function" &&
          file.size > 0;

        if (!message && !hasImage) {
          return json(
            { error: "اكتب طلبك أو أرفق صورة المنتج." },
            400
          );
        }

        const content = [];

        if (url.pathname === "/api/script") {
          content.push({
            type: "text",
            text: `أنشئ إعلاناً تسويقياً احترافياً.
فئة المنتج: ${form.get("category") || "غير محددة"}
أسلوب الإعلان: ${form.get("style") || "تلقائي"}
مدة الإعلان: ${form.get("duration") || "15"} ثانية
اللهجة: ${form.get("dialect") || "عراقي"}
طلب المستخدم: ${message || "حلّل صورة المنتج وأنشئ إعلاناً مناسباً."}

المطلوب:
1. Hook جذاب في البداية.
2. مشاهد مختصرة تناسب المدة المطلوبة.
3. الحوار إن كان مناسباً.
4. دعوة واضحة للشراء (CTA).
5. كابشن وهاشتاغات مناسبة.
6. برومبت جاهز لمولد فيديو يحافظ على شكل المنتج وصورته الأصلية.

لا تخترع السعر أو اسم العلامة التجارية أو المكونات إذا لم يذكرها المستخدم ولم تكن ظاهرة بوضوح.`
          });
        } else if (message) {
          content.push({
            type: "text",
            text: message
          });
        }

        if (hasImage) {
          if (file.size > 5 * 1024 * 1024) {
            return json(
              {
                error:
                  "حجم الصورة يجب ألا يتجاوز 5 ميغابايت."
              },
              400
            );
          }

          content.push({
            type: "image_url",
            image_url: {
              url: await imageDataUri(file)
            }
          });
        }

        const answer = await askAI(env, content);
        return json({ answer });

      } catch (error) {
        return json(
          {
            error:
              error.message ||
              "حدث خطأ أثناء معالجة الطلب."
          },
          500
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json(
        { error: "المسار غير موجود." },
        404
      );
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "لم يتم إعداد ملفات الواجهة.",
      { status: 500 }
    );
  }
};
