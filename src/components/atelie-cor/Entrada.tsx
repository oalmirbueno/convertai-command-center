import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, FileText, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Card, Chip, PillTabs } from "@/components/ds";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { hexValido } from "../../../supabase/functions/_shared/cores/oklch";
import { FAMILIAS, type Briefing, type Preco } from "../../../supabase/functions/_shared/cores/paleta";
import { NICHOS, type Nicho } from "../../../supabase/functions/_shared/cores/nichos";
import { lerBriefingComIa, type ModoDeEntrada } from "./api";

const PERSONALIDADES = ["Elegante", "Minimalista", "Moderna", "Divertida", "Tecnológica", "Sofisticada", "Natural", "Ousada", "Acolhedora", "Tradicional", "Humana", "Confiável"];
const ESTILOS = ["Minimalista", "Editorial", "Orgânico", "Tecnológico", "Clássico", "Vibrante", "Artesanal", "Industrial"];
const OBJETIVOS = ["Vendas", "Conversão", "Autoridade", "Reconhecimento", "Confiança", "Diferenciação", "Posicionamento premium"];
const PRECOS: Array<{ value: Preco; label: string; ajuda: string }> = [
  { value: "acessivel", label: "Acessível", ajuda: "Preço é argumento; volume e proximidade." },
  { value: "intermediario", label: "Intermediário", ajuda: "Custo-benefício com qualidade percebida." },
  { value: "premium", label: "Premium", ajuda: "Valor alto, público que paga por diferença." },
  { value: "luxo", label: "Luxo", ajuda: "Exclusividade e experiência acima do produto." },
];
const APLICACOES = ["Identidade visual", "Site", "Landing page", "Redes sociais", "Anúncios", "E-mail", "Embalagem"];
const CORES = FAMILIAS.map((f) => f.nome);

function Fichas({ opcoes, valor, onMudar, max }: { opcoes: string[]; valor: string[]; onMudar: (v: string[]) => void; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const ativo = valor.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={ativo}
            className={juntar("rounded-full border px-3 py-1 text-[12px] transition-colors", ativo ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}
            onClick={() => onMudar(ativo ? valor.filter((x) => x !== o) : max && valor.length >= max ? valor : [...valor, o])}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function SeletorDeCor({ valor, onMudar }: { valor: string | null | undefined; onMudar: (v: string | null) => void }) {
  const hex = hexValido(valor);
  return (
    <div className="flex items-center gap-2">
      <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border" style={{ background: hex ?? "transparent" }}>
        <input type="color" aria-label="Escolher a cor" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={(hex ?? "#7A8B6F").toLowerCase()} onChange={(e) => onMudar(e.target.value.toUpperCase())} />
      </label>
      <input className={juntar(campo, "w-32 font-mono")} placeholder="#RRGGBB" value={valor ?? ""} onChange={(e) => onMudar(e.target.value || null)} />
      {hex && <button type="button" className={botao.discreto} onClick={() => onMudar(null)}>Tirar</button>}
    </div>
  );
}

/** As perguntas, uma por tela. A ordem é a do briefing de uma marca. */
type Passo = { id: string; titulo: string; ajuda?: string; opcional?: boolean; campo: (b: Briefing, set: (p: Partial<Briefing>) => void) => JSX.Element; pronto?: (b: Briefing) => boolean };

const PASSOS: Passo[] = [
  { id: "marca", titulo: "Qual é o nome da marca?", campo: (b, set) => <input autoFocus className={campo} placeholder="Ex.: Raiz Pilates" value={b.marca} onChange={(e) => set({ marca: e.target.value })} />, pronto: (b) => b.marca.trim().length > 1 },
  { id: "nicho", titulo: "Qual é o nicho?", ajuda: "Escolha um ou escreva qualquer outro.", campo: (b, set) => (
    <div className="space-y-2">
      <input className={campo} placeholder="Ex.: estúdio de pilates" value={b.nicho ?? ""} onChange={(e) => set({ nicho: e.target.value })} />
      <Fichas opcoes={NICHOS.map((n) => n.nome)} valor={b.nicho ? [b.nicho] : []} onMudar={(v) => set({ nicho: v[v.length - 1] ?? "" })} />
    </div>
  ), pronto: (b) => !!b.nicho?.trim() },
  { id: "subnicho", titulo: "E o formato ou subnicho?", opcional: true, campo: (b, set) => {
    const n = NICHOS.find((x) => x.nome === b.nicho);
    return (
      <div className="space-y-2">
        {n && <Fichas opcoes={n.subnichos} valor={b.subnicho ? [b.subnicho] : []} onMudar={(v) => set({ subnicho: v[v.length - 1] ?? "" })} />}
        <input className={campo} placeholder="Ou descreva com suas palavras" value={b.subnicho ?? ""} onChange={(e) => set({ subnicho: e.target.value })} />
      </div>
    );
  } },
  { id: "oferta", titulo: "O que a marca vende ou oferece?", ajuda: "Uma ou duas frases.", campo: (b, set) => <textarea className={campoTexto} value={b.oferta ?? ""} onChange={(e) => set({ oferta: e.target.value })} />, pronto: (b) => (b.oferta ?? "").trim().length > 3 },
  { id: "publico", titulo: "Quem é o público?", opcional: true, ajuda: "Quanto mais específico, melhor o porquê das cores.", campo: (b, set) => <textarea className={campoTexto} value={b.publico ?? ""} onChange={(e) => set({ publico: e.target.value })} /> },
  { id: "preco", titulo: "Qual é o posicionamento de preço?", opcional: true, ajuda: "Pesa na intensidade e na profundidade das cores.", campo: (b, set) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {PRECOS.map((p) => (
        <button key={p.value} type="button" aria-pressed={b.preco === p.value} onClick={() => set({ preco: b.preco === p.value ? null : p.value })} className={juntar("rounded-md border p-3 text-left", b.preco === p.value ? "border-foreground bg-muted" : "border-border hover:bg-muted/60")}>
          <div className="text-[13px] font-semibold">{p.label}</div>
          <div className={texto.auxiliar}>{p.ajuda}</div>
        </button>
      ))}
    </div>
  ) },
  { id: "objetivo", titulo: "Qual é o objetivo principal agora?", ajuda: "Orienta o uso da cor de destaque.", campo: (b, set) => <Fichas opcoes={OBJETIVOS} valor={b.objetivo ? [b.objetivo] : []} onMudar={(v) => set({ objetivo: v[v.length - 1] ?? "" })} /> },
  { id: "personalidade", titulo: "O que a marca precisa transmitir?", ajuda: "Até 4.", campo: (b, set) => <Fichas opcoes={PERSONALIDADES} valor={b.personalidade ?? []} onMudar={(v) => set({ personalidade: v })} max={4} /> },
  { id: "estilos", titulo: "Quais estilos visuais agradam?", opcional: true, ajuda: "Linguagem, não cor.", campo: (b, set) => <Fichas opcoes={ESTILOS} valor={b.estilos ?? []} onMudar={(v) => set({ estilos: v })} /> },
  { id: "cor", titulo: "A marca já tem uma cor oficial?", opcional: true, ajuda: "Se tiver, ela entra exata nas três propostas e o resto é montado em volta.", campo: (b, set) => <SeletorDeCor valor={b.corPrincipal} onMudar={(v) => set({ corPrincipal: v })} /> },
  { id: "preferidas", titulo: "Alguma cor que o cliente quer ver?", opcional: true, campo: (b, set) => <Fichas opcoes={CORES} valor={b.preferidas ?? []} onMudar={(v) => set({ preferidas: v })} /> },
  { id: "evitar", titulo: "Alguma cor proibida?", opcional: true, ajuda: "Não aparece em nenhuma proposta, nem em tons da mesma família.", campo: (b, set) => <Fichas opcoes={CORES} valor={b.evitar ?? []} onMudar={(v) => set({ evitar: v })} /> },
  { id: "quantas", titulo: "Quantas cores de marca?", ajuda: "Neutros de texto e fundo vêm à parte.", campo: (b, set) => (
    <PillTabs variant="soft" label="Quantas cores" value={String(b.quantas ?? 3)} onChange={(v) => set({ quantas: Number(v) })} tabs={[{ value: "1", label: "Uma" }, { value: "2", label: "Duas" }, { value: "3", label: "Três (60-30-10)" }, { value: "4", label: "Quatro" }]} />
  ) },
  { id: "aplicacoes", titulo: "Onde a paleta vai aparecer?", opcional: true, campo: (b, set) => <Fichas opcoes={APLICACOES} valor={b.aplicacoes ?? []} onMudar={(v) => set({ aplicacoes: v })} /> },
];

export const BRIEFING_VAZIO: Briefing = { marca: "", nicho: "", quantas: 3, personalidade: [], estilos: [], preferidas: [], evitar: [], aplicacoes: [] };

/** Revisão: cada linha volta à pergunta dela. */
export function ResumoDoBriefing({ b, onEditar }: { b: Briefing; onEditar?: (passo: number) => void }) {
  const linhas: Array<[string, string, string]> = [
    ["marca", "Marca", b.marca],
    ["nicho", "Nicho", [b.nicho, b.subnicho].filter(Boolean).join(" · ")],
    ["oferta", "Oferta", b.oferta ?? ""],
    ["publico", "Público", b.publico ?? ""],
    ["preco", "Preço", PRECOS.find((p) => p.value === b.preco)?.label ?? ""],
    ["objetivo", "Objetivo", b.objetivo ?? ""],
    ["personalidade", "Personalidade", (b.personalidade ?? []).join(", ")],
    ["estilos", "Estilos", (b.estilos ?? []).join(", ")],
    ["cor", "Cor da marca", b.corPrincipal ?? ""],
    ["preferidas", "Quer ver", (b.preferidas ?? []).join(", ")],
    ["evitar", "Evitar", (b.evitar ?? []).join(", ")],
    ["quantas", "Cores de marca", String(b.quantas ?? 3)],
    ["aplicacoes", "Onde", (b.aplicacoes ?? []).join(", ")],
  ];
  return (
    <dl className="divide-y divide-border/60">
      {linhas.map(([id, rotulo, valor]) => (
        <div key={id} className="flex items-start gap-3 py-2">
          <dt className={juntar(texto.rotulo, "w-28 shrink-0 pt-0.5")}>{rotulo}</dt>
          <dd className="min-w-0 flex-1 text-[13px]">
            {id === "cor" && hexValido(valor) && <span className="mr-1.5 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: valor }} />}
            {valor || <span className="text-muted-foreground">—</span>}
          </dd>
          {onEditar && <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground" onClick={() => onEditar(PASSOS.findIndex((p) => p.id === id))}>Editar</button>}
        </div>
      ))}
    </dl>
  );
}

export function Questionario({ inicial, onPronto, rotuloDoFim = "Gerar as três propostas" }: { inicial: Briefing; onPronto: (b: Briefing) => void; rotuloDoFim?: string }) {
  const [b, setB] = useState<Briefing>(inicial);
  const [i, setI] = useState(0);
  const set = (p: Partial<Briefing>) => setB((x) => ({ ...x, ...p }));
  const revisao = i >= PASSOS.length;
  const passo = PASSOS[Math.min(i, PASSOS.length - 1)];
  const pode = revisao || passo.opcional || !passo.pronto || passo.pronto(b);
  return (
    <Card title={revisao ? "Confira antes de gerar" : passo.titulo} subtitle={revisao ? "Toque em Editar para voltar a uma pergunta." : passo.ajuda} action={<Chip>{revisao ? "Revisão" : `${i + 1} de ${PASSOS.length}${passo.opcional ? " · opcional" : ""}`}</Chip>}>
      <div className="space-y-5">
        <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(Math.min(i, PASSOS.length) / PASSOS.length) * 100}%` }} /></div>
        {revisao ? <ResumoDoBriefing b={b} onEditar={setI} /> : passo.campo(b, set)}
        <div className="flex items-center justify-between">
          <button type="button" className={botao.discreto} disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))}><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar</button>
          {revisao ? (
            <button type="button" className={botao.primario} disabled={!b.marca.trim()} onClick={() => onPronto(b)}><Sparkles className="mr-1.5 h-4 w-4" />{rotuloDoFim}</button>
          ) : (
            <button type="button" className={botao.primario} disabled={!pode} onClick={() => setI((x) => x + 1)}>{passo.opcional && !pode ? "Pular" : "Continuar"}<ArrowRight className="ml-1.5 h-4 w-4" /></button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function EntradaPorBriefing({ clientId, onLido }: { clientId: string | null; onLido: (b: Briefing, faltou: string[]) => void }) {
  const [textoDoBriefing, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const lerArquivo = async (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) { toast.error("Arquivo grande demais (até 2 MB de texto)."); return; }
    if (!/\.(txt|md|csv)$/i.test(f.name) && f.type.indexOf("text") !== 0) {
      toast.error("Por aqui vai texto (.txt ou .md). De PDF ou DOCX, copie o texto e cole.");
      return;
    }
    setTexto((await f.text()).slice(0, 20000));
  };
  const ler = async () => {
    if (!clientId) { toast.error("Escolha o cliente: a leitura com IA sai da carteira dele."); return; }
    setLendo(true);
    try {
      const r = await lerBriefingComIa(clientId, textoDoBriefing);
      onLido(r.briefing, r.faltou || []);
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setLendo(false);
    }
  };
  return (
    <Card title="Cole o briefing do cliente" subtitle="A IA lê, você confere e corrige antes de gerar." icon={<FileText className="h-4 w-4" />}>
      <div className="space-y-3">
        <textarea className={juntar(campoTexto, "min-h-[180px]")} placeholder="Cole aqui o texto do briefing, a conversa com o cliente ou as anotações da reunião." value={textoDoBriefing} onChange={(e) => setTexto(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className={juntar(botao.secundario, "cursor-pointer")}>
            Abrir arquivo de texto
            <input type="file" accept=".txt,.md,.csv,text/plain" className="sr-only" onChange={(e) => void lerArquivo(e.target.files?.[0])} />
          </label>
          <button type="button" className={botao.primario} disabled={lendo || textoDoBriefing.trim().length < 20} onClick={() => void ler()}>
            {lendo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}Ler com IA
          </button>
        </div>
      </div>
    </Card>
  );
}

function Amostra({ cores }: { cores: string[] }) {
  return <div className="flex h-6 overflow-hidden rounded-md">{cores.map((c) => <span key={c} className="flex-1" style={{ background: c }} title={c} />)}</div>;
}

export function EntradaPorNicho({ onEscolher }: { onEscolher: (n: Nicho, sub: string | null) => void }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const lista = useMemo(() => NICHOS.filter((n) => !busca || n.nome.toLowerCase().includes(busca.toLowerCase())), [busca]);
  return (
    <div className="space-y-4">
      <input className={juntar(campo, "max-w-sm")} placeholder="Procurar nicho" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {lista.map((n) => (
          <Card key={n.id} title={n.nome} subtitle={aberto === n.id ? undefined : n.contexto}>
            <div className="space-y-3">
              <div className="space-y-1">
                <div className={texto.rotulo}>O que todo mundo usa</div>
                <Amostra cores={n.comum} />
              </div>
              <div className="space-y-1">
                <div className={texto.rotulo}>Onde dá para se diferenciar</div>
                <Amostra cores={n.diferenciar} />
              </div>
              {aberto === n.id ? (
                <div className="space-y-3 text-[12px]">
                  <p>{n.contexto}</p>
                  <p className="text-muted-foreground">{n.leituraComum} {n.leituraDiferenciar}</p>
                  <div className={texto.rotulo}>Qual é o formato?</div>
                  <div className="flex flex-wrap gap-1.5">
                    {n.subnichos.map((s) => <button key={s} type="button" className={botao.secundario} onClick={() => onEscolher(n, s)}>{s}</button>)}
                    <button type="button" className={botao.discreto} onClick={() => onEscolher(n, null)}>Pular</button>
                  </div>
                </div>
              ) : (
                <button type="button" className={botao.secundario} onClick={() => setAberto(n.id)}>Começar por este nicho</button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <p className={texto.auxiliar}>Observação de prática de design no Brasil, não pesquisa de mercado. Duas marcas do mesmo nicho recebem paletas diferentes.</p>
    </div>
  );
}

export const MODOS: Array<{ value: ModoDeEntrada; label: string }> = [
  { value: "cliente", label: "Cliente do painel" },
  { value: "briefing", label: "Tenho um briefing" },
  { value: "zero", label: "Do zero" },
  { value: "nicho", label: "Por nicho" },
];
