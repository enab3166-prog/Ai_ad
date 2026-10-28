import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));
app.use(express.static("public"));

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function dataUri(file) {
  if (!file) return null;
  const mime = file.mimetype || "image/jpeg";
  return `data:${mime};base64,${file.buffer.toString("base64")}`;
}

const SYSTEM = `أنت AI Ad Agent لمتجر إلكتروني اسمه متجر بطوطة.
المتجر يبيع العطور والمكياجات ومنتجات العناية بالبشرة والشعر.
مهمتك مساعدة صاحب المتجر في:
1) تحليل صورة المنتج ووصفه بدقة دون اختراع معلومات غير ظاهرة.
2) كتابة إعلانات قصيرة باللهجة العراقية أو العربية حسب الطلب.
3) اقتراح أفكار فيديوهات إعلانية، مشاهد، حوار، Hook، CTA.
4) اقتراح كابشن وهاشتاغات.
5) تحسين الإعلان لمدد 8 أو 15 أو 30 ثانية.
6) الحفاظ على ثبات صورة المنتج وشكله ولونه وتفاصيله عند كتابة prompts للفيديو.
7) إذا سأل المستخدم عن التسويق، أعطه اقتراحاً عملياً ومباشراً.
لا تدّعي أنك أنشأت فيديو فعلياً إلا إذا تم استدعاء أداة الفيديو بنجاح.
عند إنشاء prompt للفيديو، أضف تعليمات واضحة: استخدم صورة المنتج كمرجع ثابت ولا تغيّر شكل المنتج أو العبوة أو الألوان أو النصوص الموجودة عليها.`;

async function openrouter(messages) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY غير مضبوط على الخادم.");
  }
  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ai-ad-agent.local",
      "X-Title": "AI Ad Agent"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openrouter/free",
      messages,
      temperature: 0.8
    })
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${text.slice(0,800)}`);
  const data = JSON.parse(text);
  return data?.choices?.[0]?.message?.content || "لم يرجع النموذج نصاً.";
}

app.get("/api/health", (req,res)=>res.json({
  ok:true,
  openrouter:!!process.env.OPENROUTER_API_KEY,
  runway:!!process.env.RUNWAY_API_KEY,
  model:process.env.OPENROUTER_MODEL || "openrouter/free"
}));

// دردشة Agent Pro: نص + صورة اختيارية
app.post("/api/chat", upload.single("image"), async (req,res)=>{
  try {
    const userText = (req.body.message || "").trim();
    if (!userText && !req.file) return res.status(400).json({error:"اكتب رسالة أو أرفق صورة."});

    const content = [];
    if (userText) content.push({type:"text", text:userText});
    if (req.file) content.push({type:"image_url", image_url:{url:dataUri(req.file)}});

    const answer = await openrouter([
      {role:"system", content:SYSTEM},
      {role:"user", content}
    ]);
    res.json({answer});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

// إنشاء سيناريو من صورة المنتج
app.post("/api/script", upload.single("image"), async (req,res)=>{
  try {
    if (!req.file) return res.status(400).json({error:"أرسل صورة المنتج."});
    const category=req.body.category||"منتج";
    const style=req.body.style||"تلقائي";
    const duration=req.body.duration||"15";
    const dialect=req.body.dialect||"عراقي";
    const prompt=`حلّل صورة المنتج ثم اكتب سيناريو إعلان مدته ${duration} ثانية.
الفئة: ${category}
الأسلوب: ${style}
اللهجة: ${dialect}
أريد Hook في البداية، مشاهد مختصرة، الحوار إن وجد، CTA في النهاية، ثم Caption و5-10 هاشتاغات.
لا تخترع اسم المنتج أو سعره أو مكوناته إذا لم تظهر في الصورة.
أضف Prompt جاهز لمولّد فيديو مع ثبات المنتج.`;
    const answer=await openrouter([
      {role:"system",content:SYSTEM},
      {role:"user",content:[
        {type:"text",text:prompt},
        {type:"image_url",image_url:{url:dataUri(req.file)}}
      ]}
    ]);
    res.json({answer});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

// توليد فيديو عبر Runway. الصورة ترسل كـ data URI (حد Runway للـ data URI هو 5MB).
app.post("/api/video", upload.single("image"), async (req,res)=>{
  try {
    if (!process.env.RUNWAY_API_KEY) return res.status(400).json({error:"RUNWAY_API_KEY غير مضبوط. أضفه في Environment Variables."});
    if (!req.file) return res.status(400).json({error:"أرسل صورة المنتج."});

    const promptText = req.body.prompt || "Create a polished social-media product advertisement. Preserve the exact product appearance, packaging, colors, logo and visible text from the reference image. Smooth camera movement, premium lighting, realistic motion.";
    const duration = [5,10,15].includes(Number(req.body.duration)) ? Number(req.body.duration) : 5;
    const ratio = req.body.ratio || "720:1280";

    const rr = await fetch("https://api.dev.runwayml.com/v1/image_to_video", {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${process.env.RUNWAY_API_KEY}`,
        "X-Runway-Version":"2024-11-06",
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:process.env.RUNWAY_MODEL || "gen4.5",
        promptImage:dataUri(req.file),
        promptText,
        ratio,
        duration
      })
    });
    const t=await rr.text();
    if(!rr.ok) return res.status(rr.status).json({error:`Runway ${rr.status}: ${t.slice(0,800)}`});
    const task=JSON.parse(t);
    res.json({task});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

app.get("/api/video/:id", async (req,res)=>{
  try {
    if(!process.env.RUNWAY_API_KEY) return res.status(400).json({error:"RUNWAY_API_KEY غير مضبوط."});
    const rr=await fetch(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(req.params.id)}`,{
      headers:{
        "Authorization":`Bearer ${process.env.RUNWAY_API_KEY}`,
        "X-Runway-Version":"2024-11-06"
      }
    });
    const t=await rr.text();
    res.status(rr.status).type("application/json").send(t);
  }catch(e){res.status(500).json({error:e.message});}
});

app.get("*", (req,res)=>{
  res.sendFile(path.resolve("public/index.html"));
});

const port=process.env.PORT || 10000;
app.listen(port,"0.0.0.0",()=>console.log(`AI Ad Agent running on ${port}`));
