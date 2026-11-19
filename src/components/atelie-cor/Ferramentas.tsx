import { useMemo, useState } from "react";
import { Copy, ImageUp } from "lucide-react";
import { toast } from "sonner";
import { Card, Chip, PillTabs } from "@/components/ds";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { extrairPaleta } from "@/lib/identidadeVisual";
import {
  ajustarAteContraste, apca, contraste, cromaMaximo, escala, HARMONIAS, harmonia, hexParaOklch, hexValido, nivelApca, nivelWcag,
  nomeDaCor, oklchParaHex, ROTULO_DALTONISMO, simularDaltonismo, textoOklch, type Daltonismo, type Harmonia,
} from "../../../supabase/functions/_shared/cores/oklch";

const fmt = (n: number) => n.toFixed(2).replace(".", ",");
const copiar = (t: string, aviso = "Copiado") => navigator.clipboard?.writeText(t).then(() => toast.success(aviso), () => toast.error("Não deu para copiar."));

function CampoDeCor({ rotulo, valor, onMudar }: { rotulo: string; valor: string; onMudar: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className={texto.rotulo}>{rotulo}</span>
      <span className="flex items-center gap-2">
        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border" style={{ background: hexValido(valor) ?? "#fff" }}>
          <input type="color" aria-label={rotulo} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={(hexValido(valor) ?? "#ffffff").toLowerCase()} onChange={(e) => onMudar(e.target.value.toUpperCase())} />
        </span>
        <input className={juntar(campo, "w-32 font-mono")} value={valor} onChange={(e) => onMudar(e.target.value)} />
      </span>
    </label>
  );
}

function Selo({ ok, children }: { ok: boolean; children: string }) {
  return <Chip tone={ok ? "success" : "danger"} dot>{children}</Chip>;
}

export function VerificadorDeContraste({ inicialTexto = "#81D8D0", inicialFundo = "#FFFFFF" }: { inicialTexto?: string; inicialFundo?: string }) {
  const [t, setT] = useState(inicialTexto);
  const [f, setF] = useState(inicialFundo);
  const ht = hexValido(t);
  const hf = hexValido(f);
  if (!ht || !hf) {
    return <Card title="Contraste"><div className="flex flex-wrap gap-4"><CampoDeCor rotulo="Texto" valor={t} onMudar={setT} /><CampoDeCor rotulo="Fundo" valor={f} onMudar={setF} /></div></Card>;
  }
  const r = contraste(ht, hf);
  const lc = apca(ht, hf);
  const ajustes = [
    { nome: "Ajustar o texto (AA)", t: ajustarAteContraste(ht, hf, 4.5), f: hf },
    { nome: "Ajustar o fundo (AA)", t: ht, f: ajustarAteContraste(hf, ht, 4.5) },
    { nome: "Ajustar o texto (AAA)", t: ajustarAteContraste(ht, hf, 7), f: hf },
    { nome: "Ajustar o fundo (AAA)", t: ht, f: ajustarAteContraste(hf, ht, 7) },
  ].filter((a) => a.t && a.f && (a.t !== ht || a.f !== hf));
  return (
    <Card title="Contraste" help="WCAG 2.2 (a norma que vale hoje: 4,5:1 texto, 3:1 texto grande e botão) e APCA (o candidato do WCAG 3, mais fiel no escuro). As correções mexem só na luminosidade, mantendo o matiz.">
      <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <CampoDeCor rotulo="Texto" valor={t} onMudar={setT} />
            <CampoDeCor rotulo="Fundo" valor={f} onMudar={setF} />
          </div>
          <button type="button" className={botao.discreto} onClick={() => { setT(f); setF(t); }}>Inverter</button>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg p-4" style={{ background: hf, color: ht }}>
            <div className="text-[24px] font-bold leading-tight">Texto grande de exemplo</div>
            <p className="mt-1 text-[14px]">Texto corrido de exemplo para ver a leitura de verdade, linha por linha.</p>
            <span className="mt-3 inline-block rounded-full border-2 px-3 py-1 text-[12px] font-semibold" style={{ borderColor: ht }}>Botão de contorno</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className={texto.numero}>{fmt(r)}:1</span>
            <span className={texto.auxiliar}>APCA Lc {Math.round(lc)} · {nivelApca(lc)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Selo ok={r >= 4.5}>AA texto</Selo>
            <Selo ok={r >= 3}>AA texto grande</Selo>
            <Selo ok={r >= 7}>AAA texto</Selo>
            <Selo ok={r >= 3}>Botão e ícone (1.4.11)</Selo>
          </div>
          {ajustes.length > 0 && (
            <ul className="divide-y divide-border/60">
              {ajustes.map((a) => (
                <li key={a.nome} className="flex items-center gap-3 py-2 text-[12px]">
                  <span className="rounded px-2 py-1 font-semibold" style={{ background: a.f!, color: a.t! }}>Aa</span>
                  <span className="flex-1">{a.nome}: {a.t} sobre {a.f} · {fmt(contraste(a.t!, a.f!))}:1</span>
                  <button type="button" className={botao.secundario} onClick={() => { setT(a.t!); setF(a.f!); }}>Aplicar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

export function Tons({ inicial = "#7A8B6F" }: { inicial?: string }) {
  const [base, setBase] = useState(inicial);
  const h = hexValido(base);
  const lista = h ? escala(h) : [];
  return (
    <Card title="Tons" help="Escala 50 a 950 em OKLCH: o matiz fica igual e o croma cai nas pontas, por isso os claros não ficam lavados nem os escuros sujos. A cor original fica no degrau mais próximo, sem mudar." action={h ? <button type="button" className={botao.secundario} onClick={() => copiar(lista.map((d) => `  --cor-${d.degrau}: ${d.hex};`).join("\n"), "CSS copiado")}><Copy className="mr-1.5 h-4 w-4" />Copiar CSS</button> : undefined}>
      <div className="space-y-4">
        <CampoDeCor rotulo="Cor base" valor={base} onMudar={setBase} />
        {h && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
            {lista.map((d) => {
              const t = contraste(d.hex, "#000000") > contraste(d.hex, "#FFFFFF") ? "#000000" : "#FFFFFF";
              return (
                <button key={d.degrau} type="button" onClick={() => copiar(d.hex, `${d.hex} copiado`)} className={juntar("flex aspect-[3/4] flex-col justify-end rounded-md p-1.5 text-left text-[10px]", d.original && "ring-2 ring-foreground ring-offset-2 ring-offset-background")} style={{ background: d.hex, color: t }}>
                  <b>{d.degrau}</b>
                  <span className="font-mono">{d.hex}</span>
                </button>
              );
            })}
          </div>
        )}
        {h && <p className={texto.auxiliar}>Base: {textoOklch(h)} · {nomeDaCor(h)}</p>}
      </div>
    </Card>
  );
}

function Circulo({ cores }: { cores: string[] }) {
  const tam = 180;
  const r = 70;
  const fatias = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <svg viewBox={`0 0 ${tam} ${tam}`} className="h-44 w-44 shrink-0" role="img" aria-label="Círculo de matizes com as cores da harmonia">
      {fatias.map((h) => {
        const a = ((h - 90) * Math.PI) / 180;
        return <circle key={h} cx={tam / 2 + r * Math.cos(a)} cy={tam / 2 + r * Math.sin(a)} r={10} fill={oklchParaHex({ l: 0.72, c: cromaMaximo(0.72, h) * 0.85, h })} />;
      })}
      {cores.map((c, i) => {
        const o = hexParaOklch(c);
        const a = ((o.h - 90) * Math.PI) / 180;
        const x = tam / 2 + (r - 30) * Math.cos(a);
        const y = tam / 2 + (r - 30) * Math.sin(a);
        return (
          <g key={i}>
            <line x1={tam / 2} y1={tam / 2} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.4} />
            <circle cx={x} cy={y} r={11} fill={c} stroke="currentColor" strokeWidth={2} />
          </g>
        );
      })}
    </svg>
  );
}

export function Harmonias({ inicial = "#002893", onUsar }: { inicial?: string; onUsar?: (cores: string[]) => void }) {
  const [base, setBase] = useState(inicial);
  const [tipo, setTipo] = useState<Harmonia>("complementar");
  const h = hexValido(base);
  const cores = h ? harmonia(h, tipo) : [];
  const def = HARMONIAS.find((x) => x.id === tipo)!;
  return (
    <Card title="Harmonias" help="Girando o matiz no OKLCH (mantém a luminosidade percebida). Complementar é o contraste máximo; a dividida é a mais segura para marketing.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <CampoDeCor rotulo="Cor base" valor={base} onMudar={setBase} />
          <PillTabs variant="soft" size="sm" label="Harmonia" value={tipo} onChange={(v) => setTipo(v as Harmonia)} tabs={HARMONIAS.map((x) => ({ value: x.id, label: x.nome }))} />
        </div>
        {h && (
          <div className="flex flex-wrap items-center gap-6">
            <Circulo cores={cores} />
            <div className="min-w-[200px] flex-1 space-y-2">
              <p className={texto.corpo}>{def.quando}</p>
              <div className="flex gap-2">
                {cores.map((c, i) => (
                  <button key={i} type="button" onClick={() => copiar(c, `${c} copiado`)} className="flex-1 rounded-md p-2 text-left text-[11px]" style={{ background: c, color: contraste(c, "#000") > contraste(c, "#fff") ? "#000" : "#fff" }}>
                    <b>{nomeDaCor(c)}</b><br /><span className="font-mono">{c}</span>
                  </button>
                ))}
              </div>
              {onUsar && <button type="button" className={botao.secundario} onClick={() => onUsar(cores)}>Montar propostas com estas cores</button>}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function SimuladorDeDaltonismo({ cores }: { cores: string[] }) {
  const tipos = Object.keys(ROTULO_DALTONISMO) as Daltonismo[];
  return (
    <Card title="Daltonismo" help="Simulação de Machado, Oliveira e Fernandes (2009), severidade total. Cerca de 8% dos homens têm alguma deficiência de cor: o botão precisa continuar visível pela diferença de claro e escuro, nunca só pelo matiz.">
      <div className="space-y-2">
        {[{ rotulo: "Visão comum", f: (c: string) => c }, ...tipos.map((t) => ({ rotulo: ROTULO_DALTONISMO[t], f: (c: string) => simularDaltonismo(c, t) }))].map((linha) => (
          <div key={linha.rotulo} className="flex items-center gap-3">
            <span className={juntar(texto.auxiliar, "w-48 shrink-0")}>{linha.rotulo}</span>
            <div className="flex h-8 flex-1 overflow-hidden rounded-md">{cores.map((c, i) => <span key={i} className="flex-1" style={{ background: linha.f(c) }} />)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ExtrairDeImagem({ onUsar }: { onUsar: (cores: string[]) => void }) {
  const [cores, setCores] = useState<string[]>([]);
  const [previa, setPrevia] = useState<string | null>(null);
  const ler = (f: File | null | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setPrevia(url);
    const img = new Image();
    img.onload = () => {
      const lado = 160;
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * k));
      cv.height = Math.max(1, Math.round(img.height * k));
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
      setCores(extrairPaleta(px, 6).map((c: { hex: string }) => c.hex.toUpperCase()));
    };
    img.src = url;
  };
  return (
    <Card title="Extrair de uma imagem" subtitle="Logo, foto do produto ou print do site do cliente." icon={<ImageUp className="h-4 w-4" />}>
      <div className="flex flex-wrap items-start gap-4">
        <label className={juntar(botao.secundario, "cursor-pointer")}>
          Escolher imagem
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => ler(e.target.files?.[0])} />
        </label>
        {previa && <img src={previa} alt="Imagem enviada" className="h-24 w-24 rounded-md border border-border object-contain" />}
        {cores.length > 0 && (
          <div className="min-w-[220px] flex-1 space-y-2">
            <div className="flex h-12 overflow-hidden rounded-md">{cores.map((c) => <button key={c} type="button" title={c} className="flex-1" style={{ background: c }} onClick={() => copiar(c, `${c} copiado`)} />)}</div>
            <div className="flex flex-wrap gap-2">
              {cores.map((c) => <button key={c} type="button" className={botao.discreto} onClick={() => onUsar([c])}><span className="mr-1.5 h-3 w-3 rounded-sm" style={{ background: c }} />Usar {c} como cor da marca</button>)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Destaques vivos gerados no OKLCH: o mais saturado que cabe em cada matiz, em dois claros. */
export function CoresVivas({ onUsar }: { onUsar?: (hex: string) => void }) {
  const cores = useMemo(() => {
    const lista: string[] = [];
    for (let h = 0; h < 360; h += 24) {
      for (const l of [0.62, 0.84]) {
        if (h >= 70 && h < 120 && l < 0.78) continue; // amarelo no meio do claro vira mostarda
        const hex = oklchParaHex({ l, c: cromaMaximo(l, h) * 0.98, h });
        if (hexParaOklch(hex).c > 0.13) lista.push(hex);
      }
    }
    return lista;
  }, []);
  return (
    <Card title="Destaques vivos" help="O croma máximo que cabe na tela em cada matiz, em dois claros. É daqui que o motor tira o destaque do botão. Combine com fundo escuro ou neutro.">
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
        {cores.map((c) => (
          <button key={c} type="button" title={`${nomeDaCor(c)} ${c}`} onClick={() => (onUsar ? onUsar(c) : copiar(c, `${c} copiado`))} className="aspect-square rounded-md p-1 text-left text-[9px] font-mono" style={{ background: c, color: contraste(c, "#000") > contraste(c, "#fff") ? "#000" : "#fff" }}>
            {c}
          </button>
        ))}
      </div>
    </Card>
  );
}

export function nivelTexto(r: number) {
  return nivelWcag(r);
}
