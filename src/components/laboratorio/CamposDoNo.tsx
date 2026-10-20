import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen, ImagePlus, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { lerCatalogo, modelosAtivos, nomeDoModelo } from "@/lib/mesa/api";
import { MODELOS_DO_LAB, OPERADOR_PADRAO, TIPOS_DE_NO, novoId, type ArquivoDoNo, type CampoDoNo, type NoDoLab, type TipoDeNo } from "@/lib/laboratorio/nos";
import { caminhoDeEntrada, lerOperadoresExternos } from "@/lib/laboratorio/api";
import { enderecosAssinados } from "@/lib/laboratorio/arquivos";
import { Miniaturas } from "./ResultadoDoNo";
import EscolherDocumentos from "./no/EscolherDocumentos";
import { Chips, SeletorDeProporcao, Segmentos, Stepper } from "./no/SeletoresVisuais";

/**
 * Os campos de um nó, pelo esquema `campos` de TIPOS_DE_NO: o mesmo
 * renderizador no Inspetor e no próprio nó do quadro (inline). Texto,
 * texto longo, número, escolha, modelo, motor, operador, imagens de entrada
 * e documentos (Workspace ou envio na hora).
 */

/** Campos que, vazios, seguem a Configuração ligada (ou o padrão da função). */
export const SEGUEM_A_CONFIGURACAO = ["proporcao", "quantidade", "qualidade", "motor"];

/** Tipos de campo que ficam só no nó expandido (e no inspetor). */
const SO_NO_EXPANDIDO = ["modelo", "motor", "operador"];

/** Os campos que o nó mostra recolhido: os dois primeiros que não são modelo, motor nem operador. */
export function camposPrincipais(tipo: TipoDeNo): CampoDoNo[] {
  const tratados = CAMPOS_TRATADOS[tipo] || [];
  const campos = TIPOS_DE_NO[tipo].campos.filter((c) => tratados.indexOf(c.chave) < 0);
  // Configuração mostra os três seletores visuais; o Agente mostra o modelo junto do papel.
  if (tipo === "config") return campos.filter((c) => c.chave !== "motor");
  if (tipo === "agente") return campos;
  const principais = campos.filter((c) => SO_NO_EXPANDIDO.indexOf(c.tipo) < 0).slice(0, 2);
  return principais.length ? principais : campos.slice(0, 1);
}

/** Campos que o corpo próprio do nó já mostra (no/CorpoEspecial e no/MidiaDoNo): os genéricos pulam. */
export const CAMPOS_TRATADOS: Partial<Record<TipoDeNo, string[]>> = {
  midia: ["imagens"],
  marca: ["paleta", "fontes", "logo"],
  referencias: ["links"],
};

/** Escolha curta vira segmentos no nó; com mais de 4 opções fica a lista. */
const MAX_SEGMENTOS = 4;

/** Até 20 MB por documento enviado (o resto vai pelo Workspace). */
const MAX_BYTES_DO_DOCUMENTO = 20 * 1024 * 1024;

type Opcao = { valor: string; rotulo: string };

/** Opções dos campos que vêm do banco: modelos de texto, motores de imagem e operadores ativos. */
export function useOpcoes(tipo: CampoDoNo["tipo"]): Opcao[] {
  const precisaCatalogo = tipo === "modelo" || tipo === "motor";
  const catalogo = useQuery({ queryKey: ["mesa", "catalogo"], queryFn: lerCatalogo, staleTime: 30 * 60_000, enabled: precisaCatalogo });
  const operadores = useQuery({ queryKey: ["laboratorio", "operadores"], queryFn: lerOperadoresExternos, staleTime: 10 * 60_000, enabled: tipo === "operador" });
  if (tipo === "modelo") {
    const lista = modelosAtivos(catalogo.data || [], "texto").map((m) => ({ valor: m.id, rotulo: nomeDoModelo(m) }));
    return lista.length ? lista : MODELOS_DO_LAB.map((m) => ({ valor: m.valor, rotulo: m.rotulo }));
  }
  if (tipo === "motor") return modelosAtivos(catalogo.data || [], "imagem").map((m) => ({ valor: m.id, rotulo: nomeDoModelo(m) }));
  if (tipo === "operador") {
    const lista = operadores.data || [];
    return lista.some((o) => o.valor === OPERADOR_PADRAO) ? lista : [{ valor: OPERADOR_PADRAO, rotulo: "Hermes" }].concat(lista);
  }
  return [];
}

interface PropsDoCampo {
  def: CampoDoNo;
  valor: unknown;
  onMudar: (v: unknown) => void;
  projetoId: string;
  clienteId?: string | null;
  opcional: boolean;
  /** id do controle (único na página: o nó e o inspetor mostram o mesmo campo). */
  id: string;
  /** Texto longo alto (nó expandido). */
  grande?: boolean;
  /** No nó: seletores visuais (segmentos, stepper, formas, chips); no inspetor, os campos clássicos. */
  visual?: boolean;
}

export function Campo({ def, valor, onMudar, projetoId, clienteId, opcional, id, grande, visual = false }: PropsDoCampo) {
  const doBanco = useOpcoes(def.tipo);
  const rotuloId = `${id}-rotulo`;
  const rotulo = (
    <label id={rotuloId} htmlFor={id} className={juntar(texto.rotulo, "mb-1 block")}>
      {def.rotulo}
    </label>
  );
  if (visual) {
    // Proporção como formas; escolha curta em segmentos; número em stepper; lista "um por linha" em chips.
    if (def.chave === "proporcao" && def.tipo === "escolha")
      return (
        <div className="min-w-0">
          {rotulo}
          <SeletorDeProporcao id={id} rotuloId={rotuloId} opcoes={def.opcoes || []} valor={String(valor ?? "")} onMudar={onMudar} vazio={opcional ? "Da configuração" : undefined} />
        </div>
      );
    if (def.tipo === "escolha" && (def.opcoes || []).length <= MAX_SEGMENTOS && !def.vazio && !opcional)
      return (
        <div className="min-w-0">
          {rotulo}
          <Segmentos id={id} rotuloId={rotuloId} opcoes={def.opcoes || []} valor={String(valor ?? "")} onMudar={onMudar} />
        </div>
      );
    if (def.tipo === "numero")
      return (
        <div className="min-w-0">
          {rotulo}
          <Stepper id={id} valor={valor === undefined || valor === null || valor === "" ? (opcional ? null : def.min || 1) : Number(valor) || def.min || 1} min={def.min || 1} max={def.max || 99} onMudar={onMudar} vazio={opcional ? "Da configuração" : undefined} />
        </div>
      );
    if (def.tipo === "textoLongo" && def.dica && /um por linha/i.test(def.dica))
      return (
        <div className="min-w-0">
          {rotulo}
          <Chips id={id} valor={typeof valor === "string" ? valor : ""} onMudar={onMudar} sep={"\n"} placeholder="Digite e Enter" />
        </div>
      );
  }
  if (def.tipo === "textoLongo")
    return (
      <div className="min-w-0">
        {rotulo}
        <textarea id={id} className={juntar(campoTexto, grande ? "min-h-[160px]" : "min-h-[72px]")} placeholder={def.dica} value={typeof valor === "string" ? valor : ""} onChange={(e) => onMudar(e.target.value)} />
      </div>
    );
  if (def.tipo === "numero")
    return (
      <div className="min-w-0">
        {rotulo}
        <input
          id={id}
          type="number"
          className={campo}
          min={def.min}
          max={def.max}
          placeholder={opcional ? "Da configuração" : undefined}
          value={valor === undefined || valor === null || valor === "" ? (opcional ? "" : def.min || 1) : Number(valor) || def.min || 1}
          onChange={(e) => onMudar(opcional && e.target.value === "" ? undefined : Math.max(def.min || 1, Math.min(def.max || 99, Number(e.target.value) || def.min || 1)))}
        />
      </div>
    );
  if (def.tipo === "escolha" || def.tipo === "modelo" || def.tipo === "motor" || def.tipo === "operador") {
    const base: Opcao[] = def.tipo === "escolha" ? (def.opcoes || []).map((o) => ({ valor: o.valor, rotulo: o.rotulo })) : doBanco;
    const atual = String(valor ?? "");
    // Valor salvo que não está mais na lista (modelo desligado, operador inativo): continua visível.
    const opcoes: Opcao[] = (def.vazio ? [{ valor: "", rotulo: def.vazio }] : opcional || def.tipo === "motor" ? [{ valor: "", rotulo: def.tipo === "motor" ? "Padrão do Laboratório" : "Da configuração" }] : [])
      .concat(base)
      .concat(atual && !base.some((o) => o.valor === atual) ? [{ valor: atual, rotulo: atual }] : []);
    return (
      <div className="min-w-0">
        {rotulo}
        <select id={id} className={campo} value={atual} onChange={(e) => onMudar(e.target.value || undefined)}>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>{o.rotulo}</option>
          ))}
        </select>
      </div>
    );
  }
  if (def.tipo === "imagens") return <CampoDeImagens rotulo={def.rotulo} valor={valor} onMudar={onMudar} projetoId={projetoId} />;
  if (def.tipo === "arquivos") return <CampoDeArquivos rotulo={def.rotulo} valor={valor} onMudar={onMudar} projetoId={projetoId} clienteId={clienteId} />;
  return (
    <div className="min-w-0">
      {rotulo}
      <input id={id} className={campo} placeholder={def.dica} value={typeof valor === "string" ? valor : ""} onChange={(e) => onMudar(e.target.value)} />
    </div>
  );
}

/** Mídia de entrada: envia para o workspace (pasta de entradas do projeto) e guarda o caminho. */
function CampoDeImagens({ rotulo, valor, onMudar, projetoId }: { rotulo: string; valor: unknown; onMudar: (v: unknown) => void; projetoId: string }) {
  const lista = (Array.isArray(valor) ? valor : []) as Array<{ path: string; url?: string; nome?: string; bucket?: string }>;
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setEnviando(true);
    const novos: Array<{ path: string; nome: string; bucket: string }> = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        const caminho = caminhoDeEntrada(projetoId, novoId("m"), f.name);
        const { error } = await supabase.storage.from("workspace").upload(caminho, f, { contentType: f.type || undefined, upsert: false });
        if (error) throw error;
        novos.push({ path: caminho, nome: f.name, bucket: "workspace" });
      }
      onMudar(lista.concat(novos));
    } catch (e) {
      toast.error("Não deu para enviar a imagem", { description: (e as Error)?.message || "Tente de novo." });
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center">
        <span className={juntar(texto.rotulo, "flex-1")}>{rotulo} ({lista.length})</span>
        <button type="button" className={botao.icone} onClick={() => arquivo.current && arquivo.current.click()} aria-label="Enviar imagem" title="Enviar imagem" disabled={enviando}>
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
        </button>
        <input ref={arquivo} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void enviar(e.target.files)} />
      </div>
      <Miniaturas imagens={lista.map((x) => ({ path: x.path, url: x.url || "" }))} max={8} />
      {lista.length > 0 && (
        <button type="button" className={juntar(botao.discreto, "mt-1 h-7 px-2 text-[12px]")} onClick={() => onMudar([])}>
          Tirar as imagens
        </button>
      )}
    </div>
  );
}

/** Lê `dados.arquivos` (documentos do nó) como veio do canvas. */
export function arquivosDe(valor: unknown): ArquivoDoNo[] {
  return (Array.isArray(valor) ? valor : [])
    .filter((x) => !!x && typeof x === "object")
    .map((x: any) => ({ id: String(x.id || ""), nome: String(x.nome || x.name || "Documento"), url: typeof x.url === "string" ? x.url : "", tipo: typeof x.tipo === "string" ? x.tipo : "", ...(typeof x.path === "string" && x.path ? { path: x.path } : {}) }));
}

const ehVideo = (a: ArquivoDoNo) => a.tipo.indexOf("video/") === 0 || /\.(mp4|mov|webm|m4v)$/i.test(a.nome);

/** Vídeo anexado (nó Vídeo): toca no próprio nó. */
function VideoAnexado({ arquivo }: { arquivo: ArquivoDoNo }) {
  const [url, setUrl] = useState(arquivo.url);
  useEffect(() => {
    if (arquivo.url || !arquivo.path) return;
    let vivo = true;
    enderecosAssinados([arquivo.path])
      .then((r) => {
        if (vivo && r[arquivo.path as string]) setUrl(r[arquivo.path as string]);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [arquivo.url, arquivo.path]);
  if (!url) return null;
  return (
    <video src={`${url}#t=0.1`} controls playsInline preload="metadata" className="nodrag mb-1 block max-h-[240px] w-full rounded-md bg-black" data-video-anexado="">
      <track kind="captions" />
    </video>
  );
}

/**
 * Documentos do nó (Contexto, Agente): escolher no Workspace (o explorador das
 * mesas) ou enviar um arquivo novo para a pasta de entradas do projeto. A
 * função lê o texto dos que dá para ler e cita os outros pelo nome.
 */
export function CampoDeArquivos({ rotulo, valor, onMudar, projetoId, clienteId }: { rotulo: string; valor: unknown; onMudar: (v: unknown) => void; projetoId: string; clienteId?: string | null }) {
  const lista = arquivosDe(valor);
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [escolher, setEscolher] = useState(false);

  const enviar = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setEnviando(true);
    const novos: ArquivoDoNo[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        if (f.size > MAX_BYTES_DO_DOCUMENTO) {
          toast.warning(`${f.name} passa de 20 MB`, { description: "Envie pelo Workspace e escolha de lá." });
          continue;
        }
        const id = novoId("d");
        const caminho = caminhoDeEntrada(projetoId, id, f.name);
        const { error } = await supabase.storage.from("workspace").upload(caminho, f, { contentType: f.type || undefined, upsert: false });
        if (error) throw error;
        novos.push({ id, nome: f.name, url: "", tipo: f.type || "", path: caminho });
      }
      if (novos.length) onMudar(lista.concat(novos));
    } catch (e) {
      toast.error("Não deu para enviar o documento", { description: (e as Error)?.message || "Tente de novo." });
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const abrir = async (a: ArquivoDoNo) => {
    try {
      const url = a.path ? (await enderecosAssinados([a.path]))[a.path] : a.url;
      if (url) window.open(url, "_blank", "noopener");
      else toast.error("Documento não encontrado");
    } catch {
      toast.error("Não deu para abrir o documento");
    }
  };

  return (
    <div className="min-w-0" data-campo-arquivos="">
      <div className="mb-1 flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>
          {rotulo} ({lista.length})
        </span>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => setEscolher(true)} aria-label="Escolher do Workspace" title="Escolher do Workspace">
          <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => entrada.current && entrada.current.click()} aria-label="Enviar documento" title="Enviar documento" disabled={enviando}>
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        <input ref={entrada} type="file" multiple className="hidden" accept=".txt,.md,.csv,.json,.html,.xml,.pdf,.doc,.docx,text/*,application/pdf" onChange={(e) => void enviar(e.target.files)} />
      </div>
      {lista.length > 0 ? (
        <ul className="min-w-0 space-y-0.5" aria-label={rotulo}>
          {lista.map((a, i) => (
            <li key={`${a.id}-${i}`} className="min-w-0" data-documento-do-no="">
              {ehVideo(a) ? <VideoAnexado arquivo={a} /> : null}
              <div className="flex min-w-0 items-center">
              <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <button type="button" className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate text-left text-foreground hover:underline")} onClick={() => void abrir(a)} title={`Abrir ${a.nome}`}>
                {a.nome}
              </button>
              <button type="button" className={juntar(botao.icone, "h-6 w-6")} onClick={() => onMudar(lista.filter((_, j) => j !== i))} aria-label={`Tirar ${a.nome}`} title={`Tirar ${a.nome}`}>
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {escolher ? (
        <EscolherDocumentos
          aberta
          clienteId={clienteId}
          jaEscolhidos={lista.map((a) => a.id)}
          onFechar={() => setEscolher(false)}
          onEscolher={(novos) => {
            setEscolher(false);
            if (novos.length) onMudar(lista.concat(novos));
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Os campos do nó. `lugar` separa os ids (o nó e o inspetor mostram o mesmo
 * campo ao mesmo tempo); `todos` = falso mostra só os principais (nó recolhido).
 */
export default function CamposDoNo({
  no,
  projetoId,
  clienteId,
  onMudarDados,
  lugar,
  todos = true,
  grande = false,
  className,
  pular,
}: {
  no: NoDoLab;
  projetoId: string;
  clienteId?: string | null;
  onMudarDados: (dados: Record<string, unknown>) => void;
  lugar: "inspetor" | "no";
  todos?: boolean;
  grande?: boolean;
  className?: string;
  /** Campos que outro bloco do nó já mostra. */
  pular?: string[];
}) {
  const fora = pular || [];
  const campos = (todos ? TIPOS_DE_NO[no.tipo].campos : camposPrincipais(no.tipo)).filter((c) => fora.indexOf(c.chave) < 0);
  if (!campos.length) return null;
  return (
    <div className={juntar("min-w-0", lugar === "no" ? "space-y-2" : "space-y-3", className)} data-campos-do-no={lugar}>
      {campos.map((c) => (
        <Campo
          key={c.chave}
          def={c}
          id={`${lugar}-${no.id}-${c.chave}`}
          valor={no.dados[c.chave]}
          onMudar={(v) => onMudarDados({ [c.chave]: v })}
          projetoId={projetoId}
          clienteId={clienteId}
          opcional={no.tipo !== "config" && SEGUEM_A_CONFIGURACAO.indexOf(c.chave) >= 0}
          grande={grande}
          visual={lugar === "no"}
        />
      ))}
    </div>
  );
}
