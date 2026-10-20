import { useRef, useState } from "react";
import { BookOpen, Building2, ExternalLink, FileText, Globe, Loader2, Palette, Search, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { caminhoDeEntrada, fontesDoCliente, lerDocumento, type FontesDoCliente } from "@/lib/laboratorio/api";
import { PROPORCOES, QUALIDADES, novoId, type NoDoLab } from "@/lib/laboratorio/nos";
import { arquivosDe } from "../CamposDoNo";
import { useAcoesDoQuadro } from "./contexto";
import GerarComIA, { useFontesDoCliente } from "./GerarComIA";
import { Chips } from "./SeletoresVisuais";
import SeletorDeMarca from "@/components/mesa/SeletorDeMarca";
import { useMarcasDoCliente } from "@/lib/mesa/marcas";

/**
 * O corpo próprio de cada tipo que tem algo melhor que texto cru: escolher o
 * cliente e usar o dossiê, puxar a marca (cores, fontes, tom e logo), puxar
 * dossiê/marca e ler documento no Contexto, links com prévia e "buscar
 * referências", papel do Agente com "gerar instrução", e o resumo do que a
 * Configuração e a Base comum mandam para os nós ligados. Os campos que o
 * corpo próprio já cuida saem dos campos genéricos (CAMPOS_TRATADOS).
 */

const PAPEIS: Array<{ id: string; rotulo: string; instrucao: string }> = [
  { id: "estrategista", rotulo: "Estrategista", instrucao: "Você é o estrategista do projeto: defina posicionamento, público, promessa e os próximos passos, com base no que chegou ligado." },
  { id: "copywriter", rotulo: "Copywriter", instrucao: "Você é o copywriter: escreva textos claros, com gancho forte e chamada para ação, no tom da marca." },
  { id: "pesquisador", rotulo: "Pesquisador", instrucao: "Você é o pesquisador: organize o que se sabe do mercado, do público e dos concorrentes, e aponte o que falta confirmar." },
  { id: "diretor_arte", rotulo: "Diretor de arte", instrucao: "Você é o diretor de arte: descreva a direção visual (cores, luz, composição, tipografia) para as peças ligadas." },
  { id: "revisor", rotulo: "Revisor", instrucao: "Você é o revisor: corrija, simplifique e marque o que precisa de fonte, sem mudar fatos nem preços." },
];

const comLinha = (antes: unknown, novo: string) => [typeof antes === "string" ? antes.trim() : "", novo.trim()].filter(Boolean).join("\n\n");

export function textoDaMarca(f: FontesDoCliente): string {
  const m = f.marca;
  return [
    m.cores.length ? `Cores: ${m.cores.join(", ")}` : "",
    m.fontes.length ? `Fontes: ${m.fontes.join(", ")}` : "",
    m.tom ? `Tom: ${m.tom}` : "",
    m.nunca.length ? `Nunca: ${m.nunca.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function textoDoDossie(f: FontesDoCliente): string {
  return [f.dossie.resumo, ...f.dossie.pontos.map((p) => `- ${p}`)].filter(Boolean).join("\n");
}

/** Puxa as fontes do cliente na hora (botões "Puxar"), com a mensagem clara se falhar. */
function usePuxar() {
  const [puxando, setPuxando] = useState<string | null>(null);
  const puxar = async (qual: string, clientId: string | null, usar: (f: FontesDoCliente) => boolean) => {
    setPuxando(qual);
    try {
      const f = await fontesDoCliente(clientId);
      if (!usar(f)) toast.info("Nada para puxar", { description: clientId ? "O cliente ainda não tem isso no painel." : "Escolha o cliente do projeto (no Canvas Studio) ou ligue um nó Cliente." });
    } catch (e) {
      toast.error("Não deu para puxar do cliente", { description: textoDoErro(e) });
    } finally {
      setPuxando(null);
    }
  };
  return { puxando, puxar };
}

const acao = juntar(botao.barra, "h-7 px-2");

// ------------------------------------------------------------ Cliente

function CorpoDoCliente({ no }: { no: NoDoLab }) {
  const a = useAcoesDoQuadro();
  const escolhido = (typeof no.dados.client_id === "string" && no.dados.client_id) || a.clienteId || "";
  const fontes = useFontesDoCliente(escolhido || null, !!escolhido);
  const opcoes = a.clientes.some((c) => c.id === escolhido) || !escolhido ? a.clientes : [{ id: escolhido, nome: "Cliente do projeto" }].concat(a.clientes);
  const f = fontes.data;
  return (
    <div className="mb-2 min-w-0 space-y-2" data-corpo-cliente="">
      <div className="min-w-0">
        <label htmlFor={`cliente-${no.id}`} className={juntar(texto.rotulo, "mb-1 block")}>
          Cliente
        </label>
        <select id={`cliente-${no.id}`} className={campo} value={escolhido} onChange={(e) => a.mudarDados(no.id, { client_id: e.target.value || undefined })}>
          <option value="">Escolha o cliente</option>
          {opcoes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      {!escolhido ? null : fontes.isLoading ? (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
          Lendo o dossiê…
        </p>
      ) : fontes.isError ? (
        <p role="alert" className={juntar(texto.auxiliar, "text-destructive")}>
          Não deu para ler o dossiê: {textoDoErro(fontes.error)}
        </p>
      ) : f && (f.dossie.resumo || f.dossie.pontos.length) ? (
        <div className="min-w-0 rounded-md bg-muted/60 p-2" data-dossie-do-cliente="">
          <p className={juntar(texto.auxiliar, "flex items-center font-medium text-foreground")}>
            <UserRound className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Dossiê{f.cliente && f.cliente.nome ? ` de ${f.cliente.nome}` : ""}
          </p>
          {f.dossie.resumo ? <p className={juntar(texto.auxiliar, "mt-1 line-clamp-4 text-foreground")}>{f.dossie.resumo}</p> : null}
          {f.dossie.pontos.length ? (
            <ul className="mt-1 list-disc pl-4">
              {f.dossie.pontos.slice(0, 3).map((p, i) => (
                <li key={i} className={juntar(texto.auxiliar, "line-clamp-1")}>
                  {p}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className={juntar(acao, "mt-1 text-primary")} onClick={() => a.mudarDados(no.id, { foco: textoDoDossie(f) })} data-usar-dossie="">
            Usar no nó
          </button>
        </div>
      ) : (
        <p className={texto.auxiliar}>Sem dossiê deste cliente ainda.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ Marca

function CorpoDaMarca({ no }: { no: NoDoLab }) {
  const a = useAcoesDoQuadro();
  const { puxando, puxar } = usePuxar();
  const d = no.dados;
  const logo = Array.isArray(d.logo) && d.logo[0] && typeof d.logo[0] === "object" ? (d.logo[0] as { url?: string }).url || "" : "";
  const clientId = a.clienteId || null;
  // Cliente com duas marcas (ex.: Acerbi e CME): o motor pede qual vale (escolha_a_marca). Grava dados.marca_id.
  const marcas = useMarcasDoCliente(clientId || "");
  const lista = marcas.data || [];
  const marcaId = typeof d.marca_id === "string" && d.marca_id ? d.marca_id : null;
  return (
    <div className="mb-2 min-w-0 space-y-2" data-corpo-marca="">
      {lista.length > 1 ? (
        <div className="min-w-0" data-escolha-da-marca="">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Marca do cliente</span>
          <SeletorDeMarca marcas={lista} valor={marcaId} onEscolher={(id) => a.mudarDados(no.id, { marca_id: id })} />
          {!marcaId ? <p className={juntar(texto.auxiliar, "mt-1 text-warning")}>Escolha qual marca vale aqui.</p> : null}
        </div>
      ) : null}
      <div className="flex min-w-0 items-center">
        {logo ? <img src={logo} alt="Logo" className="mr-2 h-9 w-9 shrink-0 rounded-md bg-muted object-contain" data-logo-da-marca="" /> : null}
        <button
          type="button"
          className={juntar(acao, "text-primary")}
          disabled={!!puxando}
          onClick={() =>
            void puxar("marca", clientId, (f) => {
              const m = f.marca;
              if (!m.cores.length && !m.fontes.length && !m.tom && !m.logo_url) return false;
              const novos: Record<string, unknown> = {};
              if (m.cores.length) novos.paleta = m.cores.join(", ");
              if (m.fontes.length) novos.fontes = m.fontes.join(", ");
              if (m.tom) novos.tom = m.tom;
              if (m.nunca.length) novos.regras = m.nunca.join("\n");
              if (m.logo_url) novos.logo = [{ path: "", url: m.logo_url, nome: "logo" }];
              a.mudarDados(no.id, novos);
              return true;
            })
          }
          data-puxar-marca=""
        >
          {puxando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Palette className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
          Puxar do cliente
        </button>
      </div>
      <div className="min-w-0">
        <label htmlFor={`paleta-${no.id}`} className={juntar(texto.rotulo, "mb-1 block")}>
          Cores
        </label>
        <Chips id={`paleta-${no.id}`} valor={typeof d.paleta === "string" ? d.paleta : ""} onMudar={(v) => a.mudarDados(no.id, { paleta: v })} placeholder="#0f766e, #f5f5f4" cor />
      </div>
      <div className="min-w-0">
        <label htmlFor={`fontes-${no.id}`} className={juntar(texto.rotulo, "mb-1 block")}>
          Fontes
        </label>
        <Chips id={`fontes-${no.id}`} valor={typeof d.fontes === "string" ? d.fontes : ""} onMudar={(v) => a.mudarDados(no.id, { fontes: v })} placeholder="Ex.: Inter, Playfair" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Contexto

function CorpoDoContexto({ no }: { no: NoDoLab }) {
  const a = useAcoesDoQuadro();
  const { puxando, puxar } = usePuxar();
  const [lendo, setLendo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const clientId = a.clienteId || null;
  const ler = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setLendo(true);
    try {
      const f = files[0];
      const id = novoId("d");
      const caminho = caminhoDeEntrada(a.projetoId, id, f.name);
      const { error } = await supabase.storage.from("workspace").upload(caminho, f, { contentType: f.type || undefined, upsert: false });
      if (error) throw error;
      const arquivos = arquivosDe(no.dados.arquivos).concat({ id, nome: f.name, url: "", tipo: f.type || "", path: caminho });
      a.mudarDados(no.id, { arquivos });
      await a.antesDeChamar();
      const r = await lerDocumento({ projetoId: a.projetoId, arquivo: { id, path: caminho } });
      if (r.texto) a.mudarDados(no.id, { texto: comLinha(no.dados.texto, `[${f.name}]\n${r.texto}`) });
      else toast.info("Documento anexado", { description: "Não deu para tirar o texto dele; o nome vai junto no contexto." });
    } catch (e) {
      toast.error("Não deu para ler o documento", { description: textoDoErro(e) });
    } finally {
      setLendo(false);
      if (entrada.current) entrada.current.value = "";
    }
  };
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center" data-corpo-contexto="">
      <button
        type="button"
        className={juntar(acao, "mb-1 mr-1")}
        disabled={!!puxando}
        onClick={() =>
          void puxar("dossie", clientId, (f) => {
            const t = textoDoDossie(f);
            if (!t) return false;
            a.mudarDados(no.id, { texto: comLinha(no.dados.texto, t) });
            return true;
          })
        }
        data-puxar-dossie=""
      >
        {puxando === "dossie" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Building2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        Puxar dossiê
      </button>
      <button
        type="button"
        className={juntar(acao, "mb-1 mr-1")}
        disabled={!!puxando}
        onClick={() =>
          void puxar("marca", clientId, (f) => {
            const t = textoDaMarca(f);
            if (!t) return false;
            a.mudarDados(no.id, { texto: comLinha(no.dados.texto, t) });
            return true;
          })
        }
        data-puxar-da-marca=""
      >
        {puxando === "marca" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Palette className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        Puxar da marca
      </button>
      <button type="button" className={juntar(acao, "mb-1 mr-1")} disabled={lendo} onClick={() => entrada.current && entrada.current.click()} data-ler-documento="">
        {lendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <BookOpen className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        Ler documento
      </button>
      <input ref={entrada} type="file" className="hidden" accept=".txt,.md,.csv,.json,.html,.pdf,.doc,.docx,text/*,application/pdf" onChange={(e) => void ler(e.target.files)} data-entrada-ler-documento="" />
    </div>
  );
}

// ------------------------------------------------------------ Referências

const linksDe = (v: unknown) => (typeof v === "string" ? v : "").split(/\n+/).map((x) => x.trim()).filter(Boolean);

function PreviaDoLink({ url, onTirar }: { url: string; onTirar: () => void }) {
  let dominio = url;
  let caminho = "";
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    dominio = u.hostname.replace(/^www\./, "");
    caminho = (u.pathname + u.search).replace(/\/$/, "");
  } catch {
    /* fica o texto inteiro */
  }
  return (
    <li className="flex min-w-0 items-center rounded-md bg-muted/60 px-2 py-1.5" data-previa-do-link="">
      <span className="mr-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.corpo, "block truncate font-medium")}>{dominio}</span>
        {caminho ? <span className={juntar(texto.auxiliar, "block truncate")}>{caminho}</span> : null}
      </span>
      <a className={juntar(botao.icone, "h-7 w-7")} href={/^https?:\/\//i.test(url) ? url : `https://${url}`} target="_blank" rel="noreferrer noopener" aria-label={`Abrir ${dominio}`} title={`Abrir ${dominio}`}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
      <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={onTirar} aria-label={`Tirar ${dominio}`} title={`Tirar ${dominio}`}>
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

function CorpoDasReferencias({ no }: { no: NoDoLab }) {
  const a = useAcoesDoQuadro();
  const links = linksDe(no.dados.links);
  const [novo, setNovo] = useState("");
  const por = () => {
    const t = novo.trim();
    if (!t) return;
    const lista = links.concat(t.split(/\s+/).filter((x) => links.indexOf(x) < 0));
    a.mudarDados(no.id, { links: lista.slice(0, 8).join("\n") });
    setNovo("");
  };
  return (
    <div className="mb-2 min-w-0 space-y-2" data-corpo-referencias="">
      {links.length ? (
        <ul className="min-w-0 space-y-1" aria-label="Links">
          {links.map((l, i) => (
            <PreviaDoLink key={`${l}-${i}`} url={l} onTirar={() => a.mudarDados(no.id, { links: links.filter((_, j) => j !== i).join("\n") })} />
          ))}
        </ul>
      ) : null}
      <div className="flex min-w-0 items-center">
        <label htmlFor={`link-${no.id}`} className="sr-only">
          Colar link
        </label>
        <input
          id={`link-${no.id}`}
          className={juntar(campo, "h-8 min-w-0 flex-1")}
          placeholder="Cole um link e Enter (até 8)"
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              por();
            }
          }}
        />
      </div>
      <GerarComIA no={no} campos={["links", "o_que_aproveitar"]} rotulo="Buscar referências" pedidoPadrao="Buscar referências públicas (sites, anúncios e Reels) para este projeto" icone={<Search className="mr-1 h-3.5 w-3.5" aria-hidden="true" />} />
    </div>
  );
}

// ------------------------------------------------------------ Agente

function CorpoDoAgente({ no }: { no: NoDoLab }) {
  const a = useAcoesDoQuadro();
  const papel = typeof no.dados.papel === "string" ? no.dados.papel : "";
  return (
    <div className="mb-2 min-w-0 space-y-1.5" data-corpo-agente="">
      <span id={`papel-${no.id}`} className={juntar(texto.rotulo, "block")}>
        Papel do agente
      </span>
      <div role="radiogroup" aria-labelledby={`papel-${no.id}`} className="flex min-w-0 flex-wrap">
        {PAPEIS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={papel === p.id}
            className={juntar("mb-1 mr-1 rounded-full px-2 py-0.5 text-[12px] transition-colors", papel === p.id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground hover:text-foreground")}
            onClick={() => a.mudarDados(no.id, { papel: p.id, instrucao: typeof no.dados.instrucao === "string" && no.dados.instrucao.trim() && papel === p.id ? no.dados.instrucao : p.instrucao })}
            title={p.instrucao}
          >
            {p.rotulo}
          </button>
        ))}
      </div>
      <GerarComIA no={no} campos={["instrucao"]} rotulo="Gerar instrução com IA" icone={<Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />} />
    </div>
  );
}

// ------------------------------------------------------------ Configuração e Base comum

/** O que a Configuração ou a Base comum manda para os nós ligados, em uma linha legível. */
export function resumoDoQueVai(no: NoDoLab): string {
  const d = no.dados;
  if (no.tipo === "config") {
    const p = PROPORCOES.find((x) => x.valor === d.proporcao);
    const q = QUALIDADES.find((x) => x.valor === d.qualidade);
    const n = Number(d.quantidade) || 1;
    return [p ? p.rotulo : String(d.proporcao || "1:1"), `${n} ${n === 1 ? "imagem" : "imagens"}`, q ? `qualidade ${q.rotulo.toLowerCase()}` : ""].filter(Boolean).join(" · ");
  }
  const base = typeof d.prompt_base === "string" ? d.prompt_base.trim() : "";
  const refs = Array.isArray(d.referencias) ? d.referencias.length : 0;
  return [base ? `"${base.length > 60 ? `${base.slice(0, 58)}…` : base}"` : "Sem prompt base", refs ? `${refs} referência(s)` : ""].filter(Boolean).join(" · ");
}

function ResumoDosLigados({ no, destinos }: { no: NoDoLab; destinos: string[] }) {
  return (
    <div className="mt-2 min-w-0 rounded-md bg-muted/60 px-2 py-1.5" data-resumo-dos-ligados="">
      <p className={juntar(texto.auxiliar, "text-foreground")}>{resumoDoQueVai(no)}</p>
      <p className={juntar(texto.auxiliar, "truncate")} title={destinos.join(", ")}>
        {destinos.length ? `Vai para: ${destinos.join(", ")}` : "Ligue nos Resultados, Carrossel ou Logo"}
      </p>
    </div>
  );
}

// ------------------------------------------------------------ Documento e Vídeo: ler o documento anexado

function CorpoDoDocumento({ no }: { no: NoDoLab }) {
  const a = useAcoesDoQuadro();
  const [lido, setLido] = useState<{ nome: string; resumo: string } | null>(null);
  const [lendo, setLendo] = useState(false);
  const docs = arquivosDe(no.dados.arquivos);
  if (!docs.length) return null;
  const ler = async () => {
    setLendo(true);
    try {
      await a.antesDeChamar();
      const d = docs[0];
      const r = await lerDocumento({ projetoId: a.projetoId, arquivo: { id: d.id, ...(d.path ? { path: d.path } : {}), ...(d.url ? { url: d.url } : {}) }, resumir: true });
      setLido({ nome: d.nome, resumo: r.resumo || r.texto.slice(0, 400) || "Sem texto legível neste documento." });
    } catch (e) {
      toast.error("Não deu para ler o documento", { description: textoDoErro(e) });
    } finally {
      setLendo(false);
    }
  };
  return (
    <div className="mb-2 min-w-0" data-corpo-documento="">
      <button type="button" className={acao} onClick={() => void ler()} disabled={lendo}>
        {lendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileText className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        Ler documento
      </button>
      {lido ? (
        <p className={juntar(texto.auxiliar, "mt-1 line-clamp-4")} data-resumo-lido="">
          <span className="font-medium text-foreground">{lido.nome}:</span> {lido.resumo}
        </p>
      ) : null}
    </div>
  );
}

/** O corpo próprio do tipo, antes dos campos genéricos (nada para os tipos sem corpo próprio). */
export default function CorpoEspecial({ no }: { no: NoDoLab }) {
  switch (no.tipo) {
    case "cliente":
      return <CorpoDoCliente no={no} />;
    case "marca":
      return <CorpoDaMarca no={no} />;
    case "contexto":
      return <CorpoDoContexto no={no} />;
    case "referencias":
      return <CorpoDasReferencias no={no} />;
    case "agente":
      return <CorpoDoAgente no={no} />;
    case "arquivo":
      return <CorpoDoDocumento no={no} />;
    default:
      return null;
  }
}

/** Resumo do que vai para os ligados (depois dos campos): Configuração e Base comum. */
export function RodapeDoCorpo({ no, destinos }: { no: NoDoLab; destinos: string[] }) {
  if (no.tipo !== "config" && no.tipo !== "gravity") return null;
  return <ResumoDosLigados no={no} destinos={destinos} />;
}
