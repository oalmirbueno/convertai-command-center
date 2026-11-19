import { useMemo } from "react";
import { simularDaltonismo, type Daltonismo } from "../../../supabase/functions/_shared/cores/oklch";
import type { Proposta } from "../../../supabase/functions/_shared/cores/paleta";
import { htmlDeEmail } from "../../../supabase/functions/_shared/cores/saidas";

/** As cores que a prévia usa, já com o texto certo sobre cada uma. */
export type CoresDaAmostra = {
  dominante: string; textoDominante: string;
  apoio: string; textoApoio: string;
  destaque: string; textoDestaque: string;
  tinta: string; papel: string;
};

export type TextosDaAmostra = { marca: string; titulo: string; sub: string; botao: string };

export function coresDaProposta(p: Proposta, dalt: Daltonismo | null = null): CoresDaAmostra {
  const pega = (papel: string) => p.cores.find((c) => c.papel === papel);
  const dom = pega("dominante")!;
  const ap = pega("apoio") ?? dom;
  const des = pega("destaque") ?? ap;
  const f = (h: string) => (dalt ? simularDaltonismo(h, dalt) : h);
  return {
    dominante: f(dom.hex), textoDominante: f(dom.texto),
    apoio: f(ap.hex), textoApoio: f(ap.texto),
    destaque: f(des.hex), textoDestaque: f(des.texto),
    tinta: f(p.neutros.tinta), papel: f(p.neutros.papel),
  };
}

/** Destaca a palavra entre *asteriscos* (ou a última) com a cor de destaque. */
function Titulo({ texto, cor }: { texto: string; cor: string }) {
  const m = /\*([^*]+)\*/.exec(texto);
  if (m) {
    const [antes, depois] = [texto.slice(0, m.index), texto.slice(m.index + m[0].length)];
    return <>{antes}<span style={{ color: cor }}>{m[1]}</span>{depois}</>;
  }
  const partes = texto.trim().split(" ");
  const ultima = partes.pop() ?? "";
  return <>{partes.join(" ")} <span style={{ color: cor }}>{ultima}</span></>;
}

export type EstruturaDoSite = "centro" | "dividida" | "cartoes" | "editorial";
export const ESTRUTURAS_DO_SITE: Array<{ value: EstruturaDoSite; label: string }> = [
  { value: "centro", label: "Centralizada" },
  { value: "dividida", label: "Dividida" },
  { value: "cartoes", label: "Com cartões" },
  { value: "editorial", label: "Editorial" },
];

export function SiteHero({ c, t, estrutura = "centro", estreito = false }: { c: CoresDaAmostra; t: TextosDaAmostra; estrutura?: EstruturaDoSite; estreito?: boolean }) {
  const botao = (
    <span className="inline-flex items-center rounded-full px-4 py-2 text-[12px] font-semibold" style={{ background: c.destaque, color: c.textoDestaque }}>{t.botao} →</span>
  );
  const nav = (
    <div className="flex items-center justify-between gap-3 px-5 py-3 text-[11px]" style={{ color: c.textoDominante }}>
      <span className="flex items-center gap-1.5 font-semibold"><span className="h-3 w-3 rounded-sm" style={{ background: c.destaque }} />{t.marca}</span>
      {!estreito && <span className="flex gap-4 opacity-80"><span>Sobre</span><span>Serviços</span><span>Contato</span></span>}
      <span className="rounded-full border px-2.5 py-1" style={{ borderColor: c.textoDominante, opacity: 0.85 }}>Fale conosco</span>
    </div>
  );
  if (estrutura === "dividida" && !estreito) {
    return (
      <div className="overflow-hidden rounded-xl" style={{ background: c.dominante }}>
        {nav}
        <div className="grid grid-cols-2 gap-6 px-6 pb-8 pt-4">
          <div className="space-y-3 self-center">
            <h3 className="text-[22px] font-bold leading-tight" style={{ color: c.textoDominante }}><Titulo texto={t.titulo} cor={c.destaque} /></h3>
            <p className="text-[12px] opacity-80" style={{ color: c.textoDominante }}>{t.sub}</p>
            {botao}
          </div>
          <div className="aspect-[4/3] rounded-lg" style={{ background: c.apoio }}>
            <div className="m-4 h-2/3 rounded-md" style={{ background: c.papel, opacity: 0.25 }} />
          </div>
        </div>
      </div>
    );
  }
  if (estrutura === "cartoes") {
    return (
      <div className="overflow-hidden rounded-xl" style={{ background: c.dominante }}>
        {nav}
        <div className="space-y-3 px-6 pb-4 pt-2 text-center">
          <h3 className="text-[20px] font-bold leading-tight" style={{ color: c.textoDominante }}><Titulo texto={t.titulo} cor={c.destaque} /></h3>
          {botao}
        </div>
        <div className={`grid gap-3 px-5 pb-6 ${estreito ? "grid-cols-1" : "grid-cols-3"}`}>
          {["Atendimento", "Resultado", "Confiança"].map((x) => (
            <div key={x} className="rounded-lg p-3 text-[11px]" style={{ background: c.apoio, color: c.textoApoio }}>
              <div className="mb-1 h-1.5 w-6 rounded-full" style={{ background: c.destaque }} />
              <b>{x}</b>
              <div className="opacity-80">Texto curto do serviço.</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (estrutura === "editorial") {
    return (
      <div className="overflow-hidden rounded-xl" style={{ background: c.dominante }}>
        {nav}
        <div className="px-6 pb-6 pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: c.textoDominante, opacity: 0.7 }}>{t.marca}</div>
          <h3 className="mt-2 font-serif text-[28px] leading-[1.05]" style={{ color: c.textoDominante }}><Titulo texto={t.titulo} cor={c.destaque} /></h3>
          <div className="mt-4 flex items-end justify-between gap-4 border-t pt-3" style={{ borderColor: c.textoDominante }}>
            <p className="max-w-[60%] text-[12px] opacity-80" style={{ color: c.textoDominante }}>{t.sub}</p>
            {botao}
          </div>
          <div className="mt-4 h-16 rounded-md" style={{ background: c.apoio }} />
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl" style={{ background: c.dominante }}>
      {nav}
      <div className="space-y-3 px-6 pb-8 pt-6 text-center">
        <span className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ background: c.apoio, color: c.textoApoio }}>{t.marca}</span>
        <h3 className="mx-auto max-w-[90%] text-[24px] font-bold leading-tight" style={{ color: c.textoDominante }}><Titulo texto={t.titulo} cor={c.destaque} /></h3>
        <p className="mx-auto max-w-[80%] text-[12px] opacity-80" style={{ color: c.textoDominante }}>{t.sub}</p>
        <div className="flex justify-center gap-3">{botao}<span className="self-center text-[12px] underline" style={{ color: c.textoDominante }}>Ver mais</span></div>
      </div>
      <div className="mx-5 h-14 rounded-t-lg" style={{ background: c.apoio }} />
    </div>
  );
}

export function PostQuadrado({ c, t, formato = "1:1" }: { c: CoresDaAmostra; t: TextosDaAmostra; formato?: "1:1" | "4:5" }) {
  return (
    <div className={`relative flex flex-col justify-between overflow-hidden rounded-xl p-5 ${formato === "1:1" ? "aspect-square" : "aspect-[4/5]"}`} style={{ background: c.dominante }}>
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full" style={{ background: c.apoio }} />
      <span className="relative text-[11px] font-semibold" style={{ color: c.textoDominante }}>{t.marca}</span>
      <div className="relative space-y-3">
        <h4 className="text-[20px] font-bold leading-tight" style={{ color: c.textoDominante }}><Titulo texto={t.titulo} cor={c.destaque} /></h4>
        <span className="inline-block rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: c.destaque, color: c.textoDestaque }}>{t.botao}</span>
      </div>
    </div>
  );
}

export function Story({ c, t }: { c: CoresDaAmostra; t: TextosDaAmostra }) {
  return (
    <div className="relative flex aspect-[9/16] flex-col overflow-hidden rounded-xl" style={{ background: c.apoio }}>
      <div className="h-1/2" style={{ background: c.dominante }}>
        <div className="p-4 text-[11px] font-semibold" style={{ color: c.textoDominante }}>{t.marca}</div>
      </div>
      <div className="flex flex-1 flex-col justify-between p-4">
        <h4 className="text-[17px] font-bold leading-tight" style={{ color: c.textoApoio }}>{t.titulo.replace(/\*/g, "")}</h4>
        <span className="self-center rounded-full px-4 py-1.5 text-[11px] font-semibold" style={{ background: c.destaque, color: c.textoDestaque }}>{t.botao}</span>
      </div>
    </div>
  );
}

export function CartaoDeVisita({ c, t }: { c: CoresDaAmostra; t: TextosDaAmostra }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex aspect-[9/5] items-center justify-center rounded-lg text-[14px] font-bold" style={{ background: c.dominante, color: c.textoDominante }}>
        <span className="mr-1.5 inline-block h-3 w-3 rounded-sm" style={{ background: c.destaque }} />{t.marca}
      </div>
      <div className="flex aspect-[9/5] flex-col justify-end rounded-lg p-3 text-[10px]" style={{ background: c.papel, color: c.tinta }}>
        <b className="text-[11px]">Nome Sobrenome</b>
        <span>(48) 0000-0000</span>
        <span style={{ color: c.destaque === c.papel ? c.tinta : undefined }}>contato@marca.com.br</span>
        <div className="mt-1.5 h-1 w-8 rounded-full" style={{ background: c.destaque }} />
      </div>
    </div>
  );
}

/** O e-mail de verdade (o mesmo HTML que sai no download), num iframe sem script. */
export function PreviaDeEmail({ p, t, escuro }: { p: Proposta; t: TextosDaAmostra; escuro: boolean }) {
  const html = useMemo(() => {
    const base = htmlDeEmail(p, { marca: t.marca, titulo: t.titulo.replace(/\*/g, ""), texto: t.sub, botao: t.botao, link: "https://exemplo.com.br", assinatura: `Equipe ${t.marca}` });
    // Força a versão escura na prévia: a media query vira regra fixa.
    return escuro ? base.replace("@media (prefers-color-scheme: dark) {", "@media all {") : base.replace(":root { color-scheme: light dark;", ":root { color-scheme: light;");
  }, [p, t, escuro]);
  return <iframe title={escuro ? "E-mail no modo escuro" : "E-mail no modo claro"} sandbox="" srcDoc={html} className="h-[360px] w-full rounded-xl border border-border bg-card" />;
}
