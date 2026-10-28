
const SYSTEM = `أنت AI Ad Maker PRO، مساعد تسويق ذكي لجميع المتاجر والأنشطة التجارية.
ساعد المستخدم في تسويق أي منتج أو خدمة، وكتابة إعلانات جذابة.
حلل صور المنتجات بدقة، ولا تخترع معلومات أو أسعاراً أو مكونات غير معروفة.
اكتب باللهجة أو اللغة التي يطلبها المستخدم.
أنشئ Hook جذاباً، ومشاهد وحواراً عند الحاجة، ودعوة واضحة للشراء (CTA)، وكابشن وهاشتاغات.
عند إعداد إعلان فيديو، اقترح مدة 8 أو 15 أو 30 ثانية حسب طلب المستخدم.
عند كتابة برومبت فيديو، اطلب الحفاظ على شكل المنتج ولونه وعبوته وشعاره والنصوص الظاهرة في صورة المرجع.
لا تدّعِ إنشاء فيديو فعلياً ما لم يتم استخدام خدمة توليد فيديو بنجاح.`;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
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

async function openRouter(env, path, options = {}) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "لم تتم إضافة مفتاح OpenRouter إلى إعدادات Cloudflare."
    );
  }

  return fetch(`https://openrouter.ai/api/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "X-Title": "AI Ad Maker PRO",
      ...options.headers
    }
  });
}

async function askAI(env, content) {
  const response = await openRouter(env, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || "openrouter/free",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content }
      ],
      temperature: 0.7
    })
  });

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

function validJobId(id) {
  return /^[a-zA-Z0-9_-]{1,200}$/.test(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // فحص اتصال الخادم
    if (request.method === "GET" && path === "/api/health") {
      return json({
        ok: true,
        openrouter: Boolean(env.OPENROUTER_API_KEY),
        videoApi: Boolean(env.OPENROUTER_API_KEY)
      });
    }

    // قائمة نماذج الفيديو المتاحة وإمكاناتها
    if (request.method === "GET" && path === "/api/video/models") {
      try {
        const response = await openRouter(env, "/videos/models");
        const result = await response.json();

        if (!response.ok) {
          return json({
            error: result?.error?.message ||
              "تعذر جلب نماذج الفيديو."
          }, response.status);
        }

        return json(result);
      } catch (error) {
        return json({
          error: error.message || "حدث خطأ أثناء جلب النماذج."
        }, 500);
      }
    }

    // إنشاء إعلان نصي
    if (
      request.method === "POST" &&
      (path === "/api/script" || path === "/api/chat")
    ) {
      try {
        const form = await request.formData();
        const message = String(form.get("message") || "").trim();
        const file = form.get("image");

        const hasImage =
          file &&
          typeof file.arrayBuffer === "function" &&
          file.size > 0;

        if (!message && !hasImage) {
          return json({
            error: "اكتب طلبك أو أرفق صورة المنتج."
          }, 400);
        }

        const content = [];

        if (path === "/api/script") {
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
        } else {
          content.push({ type: "text", text: message });
        }

        if (hasImage) {
          if (file.size > 5 * 1024 * 1024) {
            return json({
              error: "حجم الصورة يجب ألا يتجاوز 5 ميغابايت."
            }, 400);
          }

          content.push({
            type: "image_url",
            image_url: { url: await imageDataUri(file) }
          });
        }

        const answer = await askAI(env, content);
        return json({ answer });
      } catch (error) {
        return json({
          error: error.message || "حدث خطأ أثناء معالجة الطلب."
        }, 500);
      }
    }

    // إنشاء مهمة توليد فيديو حقيقية
    if (request.method === "POST" && path === "/api/video") {
      try {
        const form = await request.formData();
        const prompt = String(form.get("prompt") || "").trim();

        if (!prompt) {
          return json({
            error: "اكتب وصف الفيديو أولاً."
          }, 400);
        }

        const model = String(
          form.get("model") ||
          env.OPENROUTER_VIDEO_MODEL ||
          ""
        ).trim();

        if (!model) {
          return json({
            error: "اختر نموذج فيديو من قائمة النماذج أولاً."
          }, 400);
        }

        const duration = Number(form.get("duration") || 8);
        const aspectRatio = String(
          form.get("aspect_ratio") || "9:16"
        );
        const resolution = String(
          form.get("resolution") || "720p"
        );
        const generateAudio =
          String(form.get("generate_audio") || "false") === "true";

        if (!Number.isInteger(duration) || duration < 1 || duration > 60) {
          return json({
            error: "مدة الفيديو يجب أن تكون بين ثانية واحدة و60 ثانية."
          }, 400);
        }

        const payload = {
          model,
          prompt,
          duration,
          aspect_ratio: aspectRatio,
          resolution,
          generate_audio: generateAudio
        };

        // صورة المنتج اختيارية: تستخدم كمرجع بصري
        const file = form.get("image");
        const hasImage =
          file &&
          typeof file.arrayBuffer === "function" &&
          file.size > 0;

        if (hasImage) {
          if (file.size > 5 * 1024 * 1024) {
            return json({
              error: "حجم صورة المرجع يجب ألا يتجاوز 5 ميغابايت."
            }, 400);
          }

          if (
            file.type &&
            !["image/jpeg", "image/png", "image/webp"].includes(file.type)
          ) {
            return json({
              error: "استخدم صورة بصيغة JPG أو PNG أو WEBP."
            }, 400);
          }

          payload.input_references = [{
            type: "image_url",
            image_url: {
              url: await imageDataUri(file)
            }
          }];
        }

        const response = await openRouter(env, "/videos", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
          return json({
            error: result?.error?.message ||
              "تعذر بدء توليد الفيديو.",
            details: result
          }, response.status);
        }

        // يعيد معرّف المهمة؛ الفيديو لا يكون جاهزاً فوراً
        return json({
          ok: true,
          id: result.id,
          status: result.status,
          polling_url: result.polling_url,
          model: model
        }, 202);
      } catch (error) {
        return json({
          error: error.message || "حدث خطأ أثناء بدء توليد الفيديو."
        }, 500);
      }
    }

    // استعلام عن حالة المهمة
    const statusMatch = path.match(/^\/api\/video\/([^/]+)$/);

    if (request.method === "GET" && statusMatch) {
      const id = statusMatch[1];

      if (!validJobId(id)) {
        return json({ error: "معرّف مهمة غير صالح." }, 400);
      }

      try {
        const response = await openRouter(
          env,
          `/videos/${encodeURIComponent(id)}`
        );
        const result = await response.json();

        if (!response.ok) {
          return json({
            error: result?.error?.message ||
              "تعذر الاستعلام عن حالة الفيديو."
          }, response.status);
        }

        return json({
          id: result.id,
          status: result.status,
          error: result.error || null,
          usage: result.usage || null,
          videoUrl: result.status === "completed"
            ? `/api/video/${encodeURIComponent(id)}/content`
            : null
        });
      } catch (error) {
        return json({
          error: error.message || "تعذر الاستعلام عن الفيديو."
        }, 500);
      }
    }

    // تمرير ملف الفيديو عبر الخادم حتى لا نكشف مفتاح API للواجهة
    const contentMatch = path.match(
      /^\/api\/video\/([^/]+)\/content$/
    );

    if (request.method === "GET" && contentMatch) {
      const id = contentMatch[1];

      if (!validJobId(id)) {
        return json({ error: "معرّف مهمة غير صالح." }, 400);
      }

      const index = url.searchParams.get("index") || "0";

      if (!/^\d+$/.test(index)) {
        return json({ error: "رقم ملف فيديو غير صالح." }, 400);
      }

      try {
        const response = await openRouter(
          env,
          `/videos/${encodeURIComponent(id)}/content?index=${index}`
        );

        if (!response.ok) {
          const details = await response.text();
          return json({
            error: "لم نتمكن من جلب ملف الفيديو.",
            details: details.slice(0, 1000)
          }, response.status);
        }

        const headers = new Headers();
        headers.set(
          "Content-Type",
          response.headers.get("Content-Type") || "video/mp4"
        );
        headers.set("Cache-Control", "no-store");
        headers.set(
          "Content-Disposition",
          'inline; filename="ai-ad-video.mp4"'
        );

        return new Response(response.body, {
          status: 200,
          headers
        });
      } catch (error) {
        return json({
          error: error.message || "حدث خطأ أثناء تحميل الفيديو."
        }, 500);
      }
    }

    if (path.startsWith("/api/")) {
      return json({ error: "المسار غير موجود." }, 404);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("لم يتم إعداد ملفات الواجهة.", {
      status: 500
    });
  }
};
