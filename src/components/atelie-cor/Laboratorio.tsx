import { useMemo, useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { Card, Chip, PillTabs } from "@/components/ds";
import { campo, juntar, texto } from "@/components/sistema";
import { apca, contraste, melhorTexto, nivelWcag, ROTULO_DALTONISMO, type Daltonismo } from "../../../supabase/functions/_shared/cores/oklch";
import type { Proposta } from "../../../supabase/functions/_shared/cores/paleta";
import { CartaoDeVisita, coresDaProposta, ESTRUTURAS_DO_SITE, PostQuadrado, PreviaDeEmail, SiteHero, Story, type CoresDaAmostra, type EstruturaDoSite, type TextosDaAmostra } from "./Amostras";

type Peca = "site" | "post" | "story" | "email" | "cartao";
type Aparelho = "computador" | "tablet" | "celular";
const LARGURA: Record<Aparelho, string> = { computador: "max-w-[820px]", tablet: "max-w-[560px]", celular: "max-w-[340px]" };
const fmt = (n: number) => n.toFixed(2).replace(".", ",");

type Papel = "dominante" | "apoio" | "destaque";

function Contraste({ rotulo, frente, fundo, minimo }: { rotulo: string; frente: string; fundo: string; minimo: number }) {
  const r = contraste(frente, fundo);
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
      <span>{rotulo}</span>
      <span className="flex items-center gap-2">
        <span className="rounded px-1.5 font-semibold" style={{ background: fundo, color: frente }}>Aa</span>
        <span className="tabular-nums">{fmt(r)}:1</span>
        <Chip tone={r >= minimo ? "success" : "danger"}>{minimo >= 4.5 ? nivelWcag(r) : r >= 3 ? "≥ 3:1" : "< 3:1"}</Chip>
      </span>
    </div>
  );
}

export default function Laboratorio({ propostas, inicial, textosIniciais, nomes }: { propostas: Proposta[]; inicial: string | null; textosIniciais: TextosDaAmostra; nomes: Record<string, string> }) {
  const [id, setId] = useState<string>(inicial ?? propostas[0]?.id ?? "");
  const [peca, setPeca] = useState<Peca>("site");
  const [estrutura, setEstrutura] = useState<EstruturaDoSite>("centro");
  const [aparelho, setAparelho] = useState<Aparelho>("computador");
  const [lado, setLado] = useState(false);
  const [dalt, setDalt] = useState<Daltonismo | "">("");
  const [escuro, setEscuro] = useState(false);
  const [t, setT] = useState<TextosDaAmostra>(textosIniciais);
  const [papeis, setPapeis] = useState<Record<string, Record<Papel, string>>>({});
  const p = propostas.find((x) => x.id === id) ?? propostas[0];

  /** Cores da prévia com os papéis trocados pela equipe (qualquer cor da proposta em qualquer papel). */
  const coresDe = (q: Proposta): CoresDaAmostra => {
    const base = coresDaProposta(q, dalt || null);
    const troca = papeis[q.id];
    if (!troca) return base;
    const neutros = [q.neutros.tinta, q.neutros.papel];
    const txt = (h: string) => melhorTexto(h, [...neutros, "#000000", "#FFFFFF"]).hex;
    return { ...base, dominante: troca.dominante, textoDominante: txt(troca.dominante), apoio: troca.apoio, textoApoio: txt(troca.apoio), destaque: troca.destaque, textoDestaque: txt(troca.destaque) };
  };

  const disponiveis = useMemo(() => (p ? [...p.cores.map((c) => ({ hex: c.hex, nome: c.nome })), { hex: p.neutros.tinta, nome: "Tinta" }, { hex: p.neutros.papel, nome: "Papel" }] : []), [p]);
  if (!p) return null;
  const c = coresDe(p);
  const atual: Record<Papel, string> = { dominante: c.dominante, apoio: c.apoio, destaque: c.destaque };
  const definir = (papel: Papel, hex: string) => setPapeis((x) => ({ ...x, [p.id]: { ...atual, [papel]: hex } }));

  const render = (q: Proposta, estreito = false) => {
    const k = coresDe(q);
    if (peca === "site") return <SiteHero c={k} t={t} estrutura={estrutura} estreito={estreito || aparelho === "celular"} />;
    if (peca === "post") return <div className="grid grid-cols-2 gap-3"><PostQuadrado c={k} t={t} /><PostQuadrado c={k} t={t} formato="4:5" /></div>;
    if (peca === "story") return <div className="mx-auto max-w-[220px]"><Story c={k} t={t} /></div>;
    if (peca === "cartao") return <CartaoDeVisita c={k} t={t} />;
    return <PreviaDeEmail p={q} t={t} escuro={escuro} />;
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Proposta" className={juntar(campo, "w-auto")} value={p.id} onChange={(e) => setId(e.target.value)}>
            {propostas.map((q) => <option key={q.id} value={q.id}>{nomes[q.id] || q.titulo}</option>)}
          </select>
          <PillTabs variant="soft" size="sm" label="Peça" value={peca} onChange={(v) => setPeca(v as Peca)} tabs={[{ value: "site", label: "Site" }, { value: "post", label: "Post" }, { value: "story", label: "Story" }, { value: "email", label: "E-mail" }, { value: "cartao", label: "Cartão" }]} />
          {peca === "site" && <PillTabs variant="soft" size="sm" label="Aparelho" value={aparelho} onChange={(v) => setAparelho(v as Aparelho)} tabs={[{ value: "computador", label: <Monitor className="h-4 w-4" aria-label="Computador" /> }, { value: "tablet", label: <Tablet className="h-4 w-4" aria-label="Tablet" /> }, { value: "celular", label: <Smartphone className="h-4 w-4" aria-label="Celular" /> }]} />}
          {peca === "email" && <PillTabs variant="soft" size="sm" label="Tema" value={escuro ? "e" : "c"} onChange={(v) => setEscuro(v === "e")} tabs={[{ value: "c", label: "Claro" }, { value: "e", label: "Escuro" }]} />}
          <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={lado} onChange={(e) => setLado(e.target.checked)} />Comparar as três</label>
        </div>
        {peca === "site" && (
          <PillTabs variant="soft" size="sm" label="Estrutura do site" value={estrutura} onChange={(v) => setEstrutura(v as EstruturaDoSite)} tabs={ESTRUTURAS_DO_SITE} />
        )}
        {lado ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {propostas.slice(0, 3).map((q) => (
              <div key={q.id} className="space-y-1.5">
                <div className={texto.rotulo}>{nomes[q.id] || q.titulo}</div>
                {render(q, true)}
              </div>
            ))}
          </div>
        ) : (
          <div className={juntar("mx-auto w-full transition-all", peca === "site" ? LARGURA[aparelho] : "max-w-[640px]")}>{render(p)}</div>
        )}
      </div>

      <div className="space-y-4">
        <Card title="Papéis 60-30-10" help="Troque qual cor faz cada papel. A prévia e o contraste mudam na hora; a proposta salva não muda.">
          <div className="space-y-3">
            {(["dominante", "apoio", "destaque"] as Papel[]).map((papel) => (
              <div key={papel} className="space-y-1">
                <div className={texto.rotulo}>{papel === "dominante" ? "Dominante · 60%" : papel === "apoio" ? "Apoio · 30%" : "Destaque · 10%"}</div>
                <div className="flex flex-wrap gap-1.5">
                  {disponiveis.map((d) => (
                    <button key={d.hex + papel} type="button" title={`${d.nome} ${d.hex}`} aria-pressed={atual[papel] === d.hex} onClick={() => definir(papel, d.hex)} className={juntar("h-8 w-8 rounded-md border border-border", atual[papel] === d.hex && "ring-2 ring-foreground ring-offset-2 ring-offset-background")} style={{ background: d.hex }} />
                  ))}
                </div>
              </div>
            ))}
            {papeis[p.id] && <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setPapeis((x) => { const y = { ...x }; delete y[p.id]; return y; })}>Voltar aos papéis da proposta</button>}
          </div>
        </Card>
        <Card title="Contraste ao vivo">
          <div className="divide-y divide-border/60">
            <Contraste rotulo="Texto no fundo" frente={c.textoDominante} fundo={c.dominante} minimo={4.5} />
            <Contraste rotulo="Texto no apoio" frente={c.textoApoio} fundo={c.apoio} minimo={4.5} />
            <Contraste rotulo="Texto no botão" frente={c.textoDestaque} fundo={c.destaque} minimo={4.5} />
            <Contraste rotulo="Botão sobre o fundo" frente={c.destaque} fundo={c.dominante} minimo={3} />
            <div className="pt-1.5 text-[11px] text-muted-foreground">APCA do texto no fundo: Lc {Math.round(Math.abs(apca(c.textoDominante, c.dominante)))}</div>
          </div>
        </Card>
        <Card title="Textos da prévia">
          <div className="space-y-2">
            <input className={campo} aria-label="Marca" value={t.marca} onChange={(e) => setT({ ...t, marca: e.target.value })} />
            <input className={campo} aria-label="Título" value={t.titulo} onChange={(e) => setT({ ...t, titulo: e.target.value })} />
            <p className={texto.auxiliar}>A palavra entre *asteriscos* sai na cor de destaque.</p>
            <input className={campo} aria-label="Linha de apoio" value={t.sub} onChange={(e) => setT({ ...t, sub: e.target.value })} />
            <input className={campo} aria-label="Botão" value={t.botao} onChange={(e) => setT({ ...t, botao: e.target.value })} />
          </div>
        </Card>
        <Card title="Ver como daltônico">
          <select aria-label="Tipo de daltonismo" className={campo} value={dalt} onChange={(e) => setDalt(e.target.value as Daltonismo | "")}>
            <option value="">Visão comum</option>
            {(Object.keys(ROTULO_DALTONISMO) as Daltonismo[]).map((k) => <option key={k} value={k}>{ROTULO_DALTONISMO[k]}</option>)}
          </select>
        </Card>
      </div>
    </div>
  );
}
