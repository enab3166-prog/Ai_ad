
const SYSTEM = `
أنت مساعد تسويق ذكي متخصص في إنشاء إعلانات احترافية للإنستغرام.
تحدث باللغة التي يطلبها المستخدم، واستخدم اللهجة العراقية عند طلبها.
أنشئ Hook جذاباً، ونص الإعلان، وكابشن، وهاشتاغات مناسبة،
وأفكاراً للمشاهد عند الحاجة.
لا تخترع أسعاراً أو مواصفات غير مذكورة.
إذا أرسل المستخدم صورة منتج، فحللها واستخدم تفاصيلها الظاهرة فقط.
اجعل النتائج عملية وجاهزة للاستخدام.
`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function readRequest(request) {
  const type = request.headers.get("content-type") || "";

  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const data = {};

    for (const [key, value] of form.entries()) {
      data[key] = value;
    }

    return data;
  }

  if (type.includes("application/json")) {
    return await request.json();
  }

  return {};
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const size = 0x8000;

  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(i, i + size))
    );
  }

  return btoa(chunks.join(""));
}

async function imageToPart(value) {
  if (!value || typeof value === "string") {
    return null;
  }

  const type = value.type || "";

  if (!type.startsWith("image/")) {
    throw new Error("الملف المرفق ليس صورة.");
  }

  if (value.size > 5 * 1024 * 1024) {
    throw new Error("حجم الصورة يجب ألا يتجاوز 5 ميغابايت.");
  }

  const buffer = await value.arrayBuffer();

  return {
    type: "image",
    mime_type: type,
    data: arrayBufferToBase64(buffer)
  };
}

async function askAI(env, content) {
  if (!env.GEMINI_API_KEY) {
    throw new Error(
      "مفتاح GEMINI_API_KEY غير موجود في Cloudflare."
    );
  }

  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const input = [];

  for (const item of content) {
    if (item.type === "text") {
      input.push({
        type: "text",
        text: item.text
      });
    } else if (item.type === "image_url") {
      const url = item.image_url?.url || "";

      const match = url.match(
        /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s
      );

      if (!match) {
        throw new Error("صيغة الصورة غير مدعومة.");
      }

      input.push({
        type: "image",
        mime_type: match[1],
        data: match[2]
      });
    }
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model,
        system_instruction: SYSTEM,
        input,
        store: false,
        generation_config: {
          temperature: 0.7
        }
      })
    }
  );

  // التعديل: قراءة تفاصيل رد Gemini وإظهارها عند حدوث خطأ.
  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    result = { raw_response: responseText.slice(0, 2000) };
  }

  if (!response.ok) {
    const details = result?.error || result;

    throw new Error(
      `Gemini API (${response.status}): ${
        JSON.stringify(details)
      }`
    );
  }

  let answer = "";

  if (Array.isArray(result.outputs)) {
    answer = result.outputs
      .filter(item => item.type === "text" || item.text)
      .map(item => item.text || "")
      .join("\n");
  }

  if (!answer && Array.isArray(result.steps)) {
    answer = result.steps
      .filter(step => step.type === "model_output")
      .flatMap(step => step.content || [])
      .map(part => part.text || "")
      .join("\n");
  }

  answer = answer.trim();

  if (!answer) {
    throw new Error(
      "لم يُرجع Gemini نصاً. تفاصيل الاستجابة: " +
      JSON.stringify(result).slice(0, 1500)
    );
  }

  return answer;
}

async function openRouter(env, path, options = {}) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "مفتاح OPENROUTER_API_KEY غير موجود."
    );
  }

  const response = await fetch(
    `https://openrouter.ai/api/v1${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  if (!response.ok) {
    const message = await response.text();

    throw new Error(
      `OpenRouter API (${response.status}): ${message.slice(0, 1200)}`
    );
  }

  return response;
}

function validJobId(id) {
  return /^[a-zA-Z0-9_-]{1,200}$/.test(id);
}

async function makeContent(data, mode) {
  let prompt;

  if (mode === "script") {
    prompt = [
      "أنشئ سيناريو إعلان تسويقي للمنتج التالي.",
      `اسم المنتج: ${data.productName || data.product || "غير محدد"}`,
      `الفئة: ${data.category || "غير محددة"}`,
      `السعر: ${data.price || "لم يُذكر"}`,
      `الجمهور المستهدف: ${data.audience || "غير محدد"}`,
      `مدة الإعلان: ${data.duration || "15"} ثانية`,
      `اللهجة: ${data.dialect || "العراقية"}`,
      `الأسلوب: ${data.style || "جذاب واحترافي"}`,
      `تفاصيل إضافية: ${data.details || ""}`,
      "أخرج Hook، والمشاهد، والحوار، والكابشن والهاشتاغات."
    ].join("\n");
  } else {
    prompt = String(
      data.message || data.prompt || data.text || ""
    ).trim();
  }

  if (!prompt) {
    throw new Error("اكتب طلبك أولاً.");
  }

  const content = [
    { type: "text", text: prompt }
  ];

  const image = data.image || data.productImage || data.file;

  if (image && typeof image !== "string") {
    const part = await imageToPart(image);

    if (part) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${part.mime_type};base64,${part.data}`
        }
      });
    }
  } else if (
    typeof image === "string" &&
    image.startsWith("data:image/")
  ) {
    content.push({
      type: "image_url",
      image_url: { url: image }
    });
  }

  return content;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          }
        });
      }

      if (method === "GET" && path === "/api/health") {
        return json({
          ok: true,
          gemini: Boolean(env.GEMINI_API_KEY),
          openrouter: Boolean(env.OPENROUTER_API_KEY),
          videoApi: Boolean(env.OPENROUTER_API_KEY)
        });
      }

      if (method === "GET" && path === "/api/video/models") {
        const response = await openRouter(
          env,
          "/videos/models",
          { method: "GET" }
        );

        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("Content-Type") ||
              "application/json"
          }
        });
      }

      if (
        method === "POST" &&
        (path === "/api/script" || path === "/api/chat")
      ) {
        const data = await readRequest(request);
        const mode = path === "/api/script" ? "script" : "chat";
        const content = await makeContent(data, mode);
        const answer = await askAI(env, content);

        return json({
          ok: true,
          answer,
          text: answer
        });
      }

      if (method === "POST" && path === "/api/video") {
        if (!env.OPENROUTER_API_KEY) {
          return json({
            error: "إنشاء الفيديو يحتاج إلى إعداد OpenRouter."
          }, 503);
        }

        const data = await readRequest(request);
        const prompt = String(
          data.prompt || data.message || data.script || ""
        ).trim();

        if (!prompt) {
          return json({
            error: "أدخل وصف الفيديو أولاً."
          }, 400);
        }

        const model = String(
          data.model || env.OPENROUTER_VIDEO_MODEL || ""
        ).trim();

        if (!model) {
          return json({
            error: "حدد نموذج فيديو مدعوماً من OpenRouter."
          }, 400);
        }

        const body = {
          model,
          prompt,
          duration: Math.min(
            60,
            Math.max(1, Number(data.duration) || 8)
          ),
          aspect_ratio: data.aspect_ratio || "9:16",
          resolution: data.resolution || "720p"
        };

        if (data.audio !== undefined) {
          body.audio = String(data.audio) === "true";
        }

        const response = await openRouter(
          env,
          "/videos",
          {
            method: "POST",
            body: JSON.stringify(body)
          }
        );

        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("Content-Type") ||
              "application/json"
          }
        });
      }

      const contentMatch = path.match(
        /^\/api\/video\/([a-zA-Z0-9_-]+)\/content$/
      );

      if (method === "GET" && contentMatch) {
        const id = contentMatch[1];
        const index = url.searchParams.get("index") || "0";

        if (!validJobId(id) || !/^\d+$/.test(index)) {
          return json({
            error: "معرّف الفيديو غير صالح."
          }, 400);
        }

        const response = await openRouter(
          env,
          `/videos/${encodeURIComponent(id)}/content?index=${index}`,
          { method: "GET" }
        );

        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("Content-Type") ||
              "video/mp4",
            "Cache-Control": "no-store"
          }
        });
      }

      const statusMatch = path.match(
        /^\/api\/video\/([a-zA-Z0-9_-]+)$/
      );

      if (method === "GET" && statusMatch) {
        const id = statusMatch[1];

        if (!validJobId(id)) {
          return json({
            error: "معرّف الفيديو غير صالح."
          }, 400);
        }

        const response = await openRouter(
          env,
          `/videos/${encodeURIComponent(id)}`,
          { method: "GET" }
        );

        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("Content-Type") ||
              "application/json"
          }
        });
      }

      if (path.startsWith("/api/")) {
        return json({
          error: "المسار المطلوب غير موجود."
        }, 404);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response(
        "AI Ad Maker PRO API is running.",
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8"
          }
        }
      );
    } catch (error) {
      return json({
        ok: false,
        error: error?.message || "حدث خطأ غير متوقع."
      }, 500);
    }
  }
};
