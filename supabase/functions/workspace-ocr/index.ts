// deno-lint-ignore-file no-explicit-any
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY ausente");
    const { image, mode } = await req.json();
    if (!image || typeof image !== "string") throw new Error("image (data URL base64) obrigatório");

    const isTranscribe = mode === "transcribe";
    const sys = isTranscribe
      ? "Descreva o conteúdo visual em português (cena, elementos, texto, mood, cores). Seja preciso e objetivo, use bullets curtos."
      : "Extraia TODO o texto legível da imagem preservando quebras de linha e estrutura. Devolva apenas o texto extraído, sem comentários. Se não houver texto, responda: (sem texto detectável)";

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: [
            { type: "text", text: isTranscribe ? "Descreva:" : "Extraia o texto:" },
            { type: "image_url", image_url: { url: image } },
          ]},
        ],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `Gateway ${r.status}: ${t.slice(0, 200)}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "erro" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
