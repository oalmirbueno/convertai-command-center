import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, Link2, Loader2, Play, Trash2, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { lerCatalogo, modelosAtivos, nomeDoModelo } from "@/lib/mesa/api";
import { MODELOS_DO_LAB, OPERADOR_PADRAO, TIPOS_DE_NO, novoId, type CampoDoNo, type CanvasDoLab, type NoDoLab, type TravaDoNoAr } from "@/lib/laboratorio/nos";
import { caminhoDeEntrada, lerOperadoresExternos, type ExecucaoDoLab } from "@/lib/laboratorio/api";

/** Campos que, vazios, seguem a Configuração ligada (ou o padrão da função). */
const SEGUEM_A_CONFIGURACAO = ["proporcao", "quantidade", "qualidade", "motor"];

type Opcao = { valor: string; rotulo: string };

/** Opções dos campos que vêm do banco: modelos de texto, motores de imagem e operadores ativos. */
function useOpcoes(tipo: CampoDoNo["tipo"]): Opcao[] {
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
import ResultadoDoNo, { EstadoDoNo, Miniaturas, emAndamento } from "./ResultadoDoNo";
import { IconeDoNo } from "./icones";
import BlocosSemFonte, { type ResolverBloco } from "./BlocosSemFonte";

/**
 * Inspetor do nó selecionado: os campos do tipo (texto, modelo, motor,
 * proporção, quantidade, formato de copy, operador do agente externo...),
 * as ligações (com a mensagem clara quando não pode ligar), tirar o nó e
 * o "Rodar" (que abre o custo antes).
 */

function Campo({ def, valor, onMudar, projetoId, opcional }: { def: CampoDoNo; valor: unknown; onMudar: (v: unknown) => void; projetoId: string; opcional: boolean }) {
  const id = `campo-${def.chave}`;
  const doBanco = useOpcoes(def.tipo);
  const rotulo = (
    <label htmlFor={id} className={juntar(texto.rotulo, "mb-1 block")}>
      {def.rotulo}
    </label>
  );
  if (def.tipo === "textoLongo")
    return (
      <div className="min-w-0">
        {rotulo}
        <textarea id={id} className={juntar(campoTexto, "min-h-[72px]")} value={typeof valor === "string" ? valor : ""} onChange={(e) => onMudar(e.target.value)} />
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
  return (
    <div className="min-w-0">
      {rotulo}
      <input id={id} className={campo} value={typeof valor === "string" ? valor : ""} onChange={(e) => onMudar(e.target.value)} />
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

export default function Inspetor({
  canvas,
  no,
  projetoId,
  execucao,
  rodando,
  onMudarDados,
  onLigar,
  onDesligar,
  onRemover,
  onRodar,
  onGerarTudoDaBase,
  onFechar,
  avisoDeLigacao,
  onEscolherStoryboard,
  escolhendo = null,
  trava = null,
  onResolverBloco,
}: {
  canvas: CanvasDoLab;
  no: NoDoLab;
  projetoId: string;
  execucao: ExecucaoDoLab | undefined;
  rodando: boolean;
  /** Filme: escolher o storyboard (filme_escolher). */
  onEscolherStoryboard?: (indice: number) => void;
  escolhendo?: number | null;
  onMudarDados: (dados: Record<string, unknown>) => void;
  /** Tenta ligar; devolve o motivo quando não pode. */
  onLigar: (de: string, para: string) => string | null;
  onDesligar: (ligacaoId: string) => void;
  onRemover: () => void;
  onRodar: () => void;
  onGerarTudoDaBase: () => void;
  onFechar?: () => void;
  avisoDeLigacao: string | null;
  /** Pôr no ar: travado por bloco de prova ou número sem fonte antes dele (travaDoNoAr). */
  trava?: TravaDoNoAr | null;
  /** Fonte confirmada ou edição de um bloco sem fonte (bloco_resolver). */
  onResolverBloco?: ResolverBloco;
}) {
  const def = TIPOS_DE_NO[no.tipo];
  const [motivo, setMotivo] = useState<string | null>(null);
  const saidas = canvas.ligacoes.filter((l) => l.de === no.id);
  const entradas = canvas.ligacoes.filter((l) => l.para === no.id);
  const nome = (id: string) => {
    const n = canvas.nos.find((x) => x.id === id);
    return n ? `${TIPOS_DE_NO[n.tipo].rotulo} ${canvas.nos.filter((x) => x.tipo === n.tipo).indexOf(n) + 1}` : "?";
  };
  const outros = canvas.nos.filter((n) => n.id !== no.id);
  const aviso = motivo || avisoDeLigacao;

  return (
    <div className="min-w-0 space-y-3" data-inspetor={no.id}>
      <div className="flex min-w-0 items-center">
        <span className="mr-2 inline-flex shrink-0" style={{ color: def.cor }}>
          <IconeDoNo tipo={no.tipo} />
        </span>
        <h3 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>{nome(no.id)}</h3>
        {execucao ? <EstadoDoNo status={execucao.status} /> : null}
        {onFechar && (
          <button type="button" className={juntar(botao.icone, "ml-1")} onClick={onFechar} aria-label="Fechar o inspetor" title="Fechar o inspetor">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {def.campos.map((c) => (
        <Campo key={c.chave} def={c} valor={no.dados[c.chave]} onMudar={(v) => onMudarDados({ [c.chave]: v })} projetoId={projetoId} opcional={no.tipo !== "config" && SEGUEM_A_CONFIGURACAO.indexOf(c.chave) >= 0} />
      ))}
      {no.tipo === "por_no_ar" ? (
        <p className={texto.auxiliar} data-regra-no-ar="" title="Aprove em Precisa de você. Verba e ativação ficam com você. Acesso a Facebook, Instagram e Google só pelo Conectar, nunca por senha.">
          Nada vai ao ar sem a sua aprovação. Anúncio sobe pausado.
        </p>
      ) : null}

      <div className="min-w-0">
        <label htmlFor="ligar-a" className={juntar(texto.rotulo, "mb-1 flex items-center")}>
          <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Ligar a
        </label>
        <select
          id="ligar-a"
          className={campo}
          value=""
          onChange={(e) => {
            const para = e.target.value;
            if (!para) return;
            const m = onLigar(no.id, para);
            setMotivo(m);
          }}
        >
          <option value="">Escolha o nó que recebe</option>
          {outros.map((n) => (
            <option key={n.id} value={n.id}>
              {nome(n.id)}
            </option>
          ))}
        </select>
        {aviso ? (
          <p role="alert" className={juntar(texto.auxiliar, "mt-1 text-warning")} data-aviso-de-ligacao="">
            {aviso}
          </p>
        ) : null}
      </div>

      {(entradas.length > 0 || saidas.length > 0) && (
        <ul className="min-w-0 space-y-1" aria-label="Ligações do nó">
          {entradas.map((l) => (
            <li key={l.id} className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
              <span className="min-w-0 flex-1 truncate">Recebe de {nome(l.de)}</span>
              <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onDesligar(l.id)} aria-label={`Desligar de ${nome(l.de)}`} title="Desligar">
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {saidas.map((l) => (
            <li key={l.id} className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
              <span className="min-w-0 flex-1 truncate">Manda para {nome(l.para)}</span>
              <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onDesligar(l.id)} aria-label={`Desligar de ${nome(l.para)}`} title="Desligar">
                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {trava && trava.travado && onResolverBloco ? <BlocosSemFonte blocos={trava.blocos} motivo={trava.motivo} onResolver={onResolverBloco} /> : null}

      <ResultadoDoNo execucao={execucao} compacto={false} tipo={no.tipo} onEscolherStoryboard={onEscolherStoryboard} escolhendo={escolhendo} />
      {execucao && execucao.status === "pronto" && onResolverBloco ? (
        <BlocosSemFonte blocos={execucao.saida.rascunho_sem_fonte.map((b) => ({ ...b, no_id: no.id }))} onResolver={onResolverBloco} />
      ) : null}

      <div className="flex min-w-0 items-center border-t border-border pt-3">
        {def.roda && (
          <button type="button" className={juntar(botao.primario, "h-8 px-3")} onClick={onRodar} disabled={rodando || emAndamento(execucao && execucao.status) || !!(trava && trava.travado)} data-rodar-no={no.id} title={trava && trava.travado ? trava.motivo : no.tipo === "por_no_ar" ? "Cria o pedido de aprovação (mostra o custo antes)" : "Mostra o custo antes de rodar"}>
            {rodando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {no.tipo === "por_no_ar" ? "Pedir aprovação" : "Rodar"}
          </button>
        )}
        {no.tipo === "gravity" && (
          <button type="button" className={juntar(botao.secundario, "h-8 px-3")} onClick={onGerarTudoDaBase} disabled={rodando}>
            Gerar tudo
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={juntar(botao.icone, "hover:text-destructive")} onClick={onRemover} aria-label="Tirar o nó do quadro" title="Tirar o nó do quadro">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
