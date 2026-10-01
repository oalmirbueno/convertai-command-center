import { useMemo, useRef, useState } from "react";
import { Check, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useKitDaMesa } from "@/components/mesa/kitDaMesa";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { textoDoErro, usd } from "@/lib/mesa/api";
import type { AcaoDoAgente, RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { linhasDoPlano, LEGENDAS_DO_PLANO, LOOKS_DO_PLANO, planoPadrao, RECEITAS, type PlanoDaEdicao } from "../../../../supabase/functions/editor-video/modulos/plano-da-edicao";
import { chamarEditorVideo, emPreparacao, novoId } from "@/lib/editor/api";
import { acaoDaProposta, acaoFeita } from "@/lib/editor/cartao";
import { montarEdicaoCompleta, projetoDepoisDoCorte, type MarcaDaEdicao, type PassoDaEdicao } from "@/lib/editor/edicaoCompleta";
import { acervoParaBroll, custoDoPlano, fontesSemRosto, julgar, pedirPlano, resumoParaOPlano } from "@/lib/editor/editarComIa";
import { temFala } from "@/lib/editor/transcricao";
import type { PropostaDaSkill } from "@/lib/editor/skills";
import type { ItemParaBroll } from "@/lib/editor/skills/pecasDaEdicao";
import { letraDaMarcaParaVideo, PRESETS_DE_LEGENDA } from "@/lib/editor/estilosDeTexto";
import { useTipografiaDaMarca } from "@/lib/mesa/tipografiaDoCliente";
import { LOOKS } from "@/lib/editor/cor";
import type { ControleDePropostas } from "./PainelDeSkills";
import { corDaPaleta, modelosDoAgente } from "./AgenteEditor";

/**
 * Editar com IA (frente EDT, rodada 2): uma instrução monta a edição inteira
 * (como o EDIT IA PRO, dentro do painel e com as nossas regras).
 *
 * 1. Planejar: o modelo escolhido lê o pedido e o vídeo e devolve o plano
 *    (custo antes). Sem crédito ou sem pressa: "Plano da casa" (a receita,
 *    grátis).
 * 2. A pessoa liga ou desliga peças do plano.
 * 3. Montar: corta, reenquadra, e o Jev julga (momentos fortes, B-roll do
 *    acervo, animações, capítulos, virais); o código põe tudo no tempo medido.
 *    Sai UMA proposta com a lista do que muda: Confirmar e Desfazer.
 * Depois, cada peça está na linha do tempo para ajustar à mão.
 */

type Etapa = "pedido" | "plano" | "montando" | "proposta";

interface Montagem {
  p: PropostaDaSkill;
  acao: AcaoDoAgente;
  passos: PassoDaEdicao[];
  avisos: string[];
  id: string;
}

const ROTULO_DA_LEGENDA: Record<string, string> = PRESETS_DE_LEGENDA.reduce((o, p) => ({ ...o, [p.valor]: p.rotulo }), {} as Record<string, string>);
const ROTULO_DO_LOOK: Record<string, string> = LOOKS.reduce((o, l) => ({ ...o, [l.id]: l.rotulo }), {} as Record<string, string>);

/**
 * A marca aberta para o editor: cores do kit, logo e a LETRA da marca (as
 * fontes que valem para ela, pela regra de herança: outra marca nunca herda a
 * letra da principal).
 */
export function useMarcaDoEditor(): MarcaDaEdicao | null {
  const kit = useKitDaMesa();
  const { clientId } = useMesa();
  const tipografia = useTipografiaDaMarca(clientId, kit.marca);
  const daMarca = tipografia.data ? tipografia.data.daMarca : null;
  return useMemo(() => {
    const paleta = kit.data ? kit.data.paleta : null;
    const cor = corDaPaleta(paleta);
    const outras = (paleta || []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(String(c.hex || "")) && c.hex !== cor);
    const nome = kit.marca ? kit.marca.nome : null;
    const letra = letraDaMarcaParaVideo(daMarca);
    if (!cor && !nome && !letra && !(kit.data && kit.data.logo_path)) return null;
    return { nome, cor, cor2: outras[0] ? outras[0].hex : null, fonte: letra ? letra.familia : null, fonte_path: letra ? letra.caminho : null, logo_path: (kit.data && kit.data.logo_path) || null };
  }, [kit.data, kit.marca, daMarca]);
}

function Chave({ ligado, rotulo, onMudar }: { ligado: boolean; rotulo: string; onMudar: (v: boolean) => void }) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center py-1 text-[13px]">
      <input type="checkbox" className="mr-2 h-3.5 w-3.5 shrink-0 accent-primary" checked={ligado} onChange={(e) => onMudar(e.target.checked)} />
      <span className="min-w-0 flex-1 truncate">{rotulo}</span>
    </label>
  );
}

export default function PainelEditarComIA({
  projeto,
  controle,
  versaoId,
  irPara,
}: {
  projeto: ProjetoDeEdicao;
  controle: ControleDePropostas;
  versaoId?: string | null;
  /** Abre outro painel do editor (Timestamp para marcar a fala, Formato para o rosto). */
  irPara?: (aba: string) => void;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const marca = useMarcaDoEditor();
  const arquivosQ = useArquivosDeVideo(clientId);
  const modelos = useMemo(() => modelosDoAgente(catalogo || []).reduce((l, g) => l.concat(g.modelos), [] as NonNullable<typeof catalogo>), [catalogo]);
  const [instrucao, setInstrucao] = useEstadoDaTela<string>(`mesa-edicao:editor:ia:instrucao:${clientId}`, RECEITAS[0].instrucao, { esperaMs: 300 });
  const [modeloId, setModeloId] = useEstadoDaTela<string>(`mesa-edicao:editor:ia:modelo:${clientId}`, "");
  const [etapa, setEtapa] = useState<Etapa>("pedido");
  const [plano, setPlano] = useState<PlanoDaEdicao | null>(null);
  const [avisosDoPlano, setAvisosDoPlano] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [montagem, setMontagem] = useState<Montagem | null>(null);
  const projetoRef = useRef(projeto);
  projetoRef.current = projeto;

  const modelo = modelos.find((m) => m.id === modeloId) || modelos.find((m) => (m.padrao_para || []).indexOf("diretor_arte") >= 0) || modelos[0] || null;
  const acervo = useMemo(() => {
    const itens: ItemParaBroll[] = ((arquivosQ.data && arquivosQ.data.arquivos) || [])
      .filter((a) => a.estado !== "arquivado")
      .map((a) => ({ id: a.id, arquivo_id: a.so_no_storage ? null : a.id, nome: a.nome, tipo: a.tipo, storage_bucket: a.storage_bucket, storage_path: a.storage_path, duracao_s: a.duracao_s, largura: a.largura, altura: a.altura }));
    return acervoParaBroll(projeto, itens);
  }, [arquivosQ.data, projeto]);
  const resumo = useMemo(() => resumoParaOPlano(projeto, marca ? marca.nome : null, acervo.length), [projeto, marca, acervo.length]);
  const custo = modelo ? custoDoPlano(modelo, instrucao, resumo, false) : 0;
  const fala = temFala(projeto);

  const planejarComIa = async () => {
    if (!modelo) return;
    setOcupado("Planejando a edição");
    setErro(null);
    try {
      const r = await pedirPlano(chamarEditorVideo, { clientId, modelo, instrucao, resumo, referencia: novoId() });
      setPlano(r.plano);
      setAvisosDoPlano(r.avisos);
      setEtapa("plano");
      atualizarCusto();
    } catch (e) {
      const t = emPreparacao(e) ? "O planejamento com IA está em preparação: falta publicar a função editor-video. Use o Plano da casa." : textoDoErro(e);
      setErro(t);
      console.error("[editar com IA] plano não saiu", e);
    } finally {
      setOcupado(null);
    }
  };

  const planoDaCasa = (receita: string) => {
    setPlano(planoPadrao(receita, resumo.musicas));
    setAvisosDoPlano(fala ? [] : ["Sem fala marcada: legenda, zoom nos momentos e animações pedem a fala (Timestamp)."]);
    setEtapa("plano");
    setErro(null);
  };

  const mudar = (f: (p: PlanoDaEdicao) => PlanoDaEdicao) => setPlano((p) => (p ? f(JSON.parse(JSON.stringify(p)) as PlanoDaEdicao) : p));

  const montar = async () => {
    if (!plano) return;
    setEtapa("montando");
    setErro(null);
    const agora = new Date().toISOString();
    const base = projetoRef.current;
    try {
      setOcupado("Cortando e reenquadrando");
      const cortado = projetoDepoisDoCorte(base, plano, agora);
      setOcupado("A IA está julgando os momentos, o B-roll e as animações");
      const j = await julgar(chamarEditorVideo, clientId, cortado, plano, acervo, setOcupado).catch((e) => {
        // Função não publicada: monta pela regra da casa e avisa.
        if (emPreparacao(e)) return { dados: {}, avisos: ["Os julgamentos da IA estão em preparação (falta publicar a editor-video): usei a regra da casa."] };
        throw e;
      });
      setOcupado("Montando a edição");
      const r = montarEdicaoCompleta(base, plano, { ...j.dados, agora, marca });
      const id = `ia-${Date.now().toString(36)}`;
      const avisos = j.avisos.concat(r.proposta.avisos);
      const acao = acaoDaProposta(id, "editor", r.proposta.resumo, r.proposta.operacoes, base, avisos);
      setMontagem({ p: r.proposta, acao, passos: r.passos, avisos, id });
      setEtapa("proposta");
      if (versaoId) {
        // A conversa do editor guarda o pedido e o que saiu (o agente lê depois).
        void chamarEditorVideo({
          acao: "conversa_gravar",
          client_id: clientId,
          versao_id: versaoId,
          usuario: `Editar com IA: ${instrucao}`.slice(0, 1500),
          agente: { conteudo: `${r.proposta.resumo}${avisos.length ? ` Avisos: ${avisos.join(" ")}` : ""}`.slice(0, 4000), anexos: [{ tipo: "log_do_editor", itens: r.passos.map((x) => ({ tipo: x.feito ? "ferramenta" : "aviso", texto: `${x.rotulo}: ${x.detalhe}` })) }] },
        }).catch((e) => {
          if (!emPreparacao(e)) console.error("[editar com IA] conversa não gravada", e);
        });
      }
    } catch (e) {
      setErro(textoDoErro(e));
      setEtapa("plano");
      console.error("[editar com IA] montagem falhou", e);
    } finally {
      setOcupado(null);
    }
  };

  const aoPedido = async (pedido: "confirmar" | "descartar" | "desfazer"): Promise<RespostaDaAcao> => {
    if (!montagem) return {};
    const agora = new Date().toISOString();
    const acao = montagem.acao;
    if (pedido === "descartar") {
      setMontagem(null);
      setEtapa("plano");
      return { anexo: { ...acao, descartada_em: agora } };
    }
    if (pedido === "desfazer") {
      if (!controle.desfazer(montagem.p)) throw new Error("Mudou depois de aplicar: use Ctrl+Z para voltar passo a passo.");
      return { anexo: { ...acaoFeita(acao, agora), desfeita_em: agora }, voltaram: acao.itens.length };
    }
    if (!controle.aplicar(montagem.p, "Editar com IA")) throw new Error("O projeto mudou enquanto a proposta estava aberta. Monte de novo.");
    toast.success("Edição montada", { description: "Cada peça está na linha do tempo para ajustar. Confira a prévia ou peça uma amostra." });
    return { anexo: acaoFeita(acao, agora), feitos: acao.itens.length, falhas: 0 };
  };

  const semRosto = plano && plano.formato !== "manter" && plano.seguir_rosto ? fontesSemRosto(projeto) : [];

  return (
    <div className="space-y-3" data-painel-editar-com-ia={etapa}>
      <div className="flex min-w-0 items-center">
        <Sparkles className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">Editar com IA</p>
        <AjudaRecolhida titulo="Editar com IA">
          Você diz o que quer e a IA monta a edição inteira: tira erros e pausas, reenquadra, legenda no estilo da marca, zoom nos momentos fortes, B-roll do acervo, animações, sons, música abaixo da voz, transições, cor, cartão final, capítulos e momentos virais. Nada muda antes do Confirmar, e cada peça fica na linha do tempo para ajustar. O planejamento usa o modelo escolhido (custo antes); os julgamentos finos usam o Jev, sem custo para o cliente. O Plano da casa faz o mesmo sem modelo, de graça.
        </AjudaRecolhida>
      </div>

      {!fala && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400">
          Sem fala marcada: legenda, zoom e animações precisam dela.{" "}
          {irPara && (
            <button type="button" className="underline" onClick={() => irPara("timestamp")}>
              Marcar a fala
            </button>
          )}
        </p>
      )}

      {(etapa === "pedido" || etapa === "plano") && (
        <div className="space-y-2">
          <div className="flex flex-wrap" role="group" aria-label="Receitas prontas">
            {RECEITAS.map((r) => (
              <button key={r.id} type="button" className={juntar(botao.discreto, "mb-1 mr-1 h-7 px-2 text-[12px]", plano && plano.receita === r.id && "bg-primary/10 text-primary")} onClick={() => setInstrucao(r.instrucao)} title={r.instrucao}>
                {r.rotulo}
              </button>
            ))}
          </div>
          <label className="block">
            <span className={texto.rotulo}>O que você quer</span>
            <textarea className={juntar(campoTexto, "mt-1 min-h-[76px]")} value={instrucao} maxLength={1500} onChange={(e) => setInstrucao(e.target.value)} placeholder="Ex.: deixa dinâmico para Reels, legenda amarela de impacto, sem música" />
          </label>
          <SeletorDeModelo catalogo={catalogo || []} tipo="texto" valor={modelo ? modelo.id : ""} onChange={setModeloId} rotulo="Modelo que planeja" />
          <div className="flex flex-wrap items-center">
            <button type="button" className={juntar(botao.primario, "mb-1 mr-2 h-8")} onClick={() => void planejarComIa()} disabled={!!ocupado || !modelo || !instrucao.trim()} data-planejar-com-ia="">
              {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
              Planejar{modelo ? ` · até ${usd(custo)}` : ""}
            </button>
            <button type="button" className={juntar(botao.secundario, "mb-1 h-8")} onClick={() => planoDaCasa(RECEITAS.find((r) => r.instrucao === instrucao) ? (RECEITAS.find((r) => r.instrucao === instrucao) as { id: string }).id : "dinamico")} disabled={!!ocupado} title="A receita da casa, sem modelo: grátis" data-plano-da-casa="">
              Plano da casa
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p className="text-[12px] text-destructive" role="alert">
          {erro}
        </p>
      )}
      {ocupado && (
        <p className="flex items-center text-[12px] text-muted-foreground" aria-live="polite">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {ocupado}
        </p>
      )}

      {plano && etapa === "plano" && (
        <div className="space-y-2 border-t border-border pt-3" data-plano-da-edicao="">
          <p className={texto.corpo}>{plano.resumo}</p>
          {avisosDoPlano.map((a) => (
            <p key={a} className="text-[12px] text-amber-600 dark:text-amber-400">
              {a}
            </p>
          ))}
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className={texto.rotulo}>Legenda</span>
              <select className={juntar(campo, "mt-1 h-8")} value={plano.legenda.ligado ? plano.legenda.estilo : ""} onChange={(e) => mudar((p) => ({ ...p, legenda: { ...p.legenda, ligado: !!e.target.value, estilo: e.target.value || p.legenda.estilo } }))}>
                <option value="">Sem legenda</option>
                {LEGENDAS_DO_PLANO.map((l) => (
                  <option key={l} value={l}>
                    {ROTULO_DA_LEGENDA[l] || l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className={texto.rotulo}>Formato</span>
              <select className={juntar(campo, "mt-1 h-8")} value={plano.formato} onChange={(e) => mudar((p) => ({ ...p, formato: e.target.value as PlanoDaEdicao["formato"] }))}>
                <option value="manter">Manter ({projeto.formato})</option>
                {["9:16", "1:1", "4:5", "16:9"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className={texto.rotulo}>Cor</span>
              <select className={juntar(campo, "mt-1 h-8")} value={plano.cor.look} onChange={(e) => mudar((p) => ({ ...p, cor: { ...p.cor, look: e.target.value } }))}>
                {LOOKS_DO_PLANO.map((l) => (
                  <option key={l} value={l}>
                    {ROTULO_DO_LOOK[l] || l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className={texto.rotulo}>Zoom</span>
              <select className={juntar(campo, "mt-1 h-8")} value={plano.zoom.ligado ? plano.zoom.intensidade : ""} onChange={(e) => mudar((p) => ({ ...p, zoom: { ligado: !!e.target.value, intensidade: (e.target.value || p.zoom.intensidade) as PlanoDaEdicao["zoom"]["intensidade"] } }))}>
                <option value="">Sem zoom</option>
                <option value="suave">Suave</option>
                <option value="media">Médio</option>
                <option value="forte">Forte</option>
              </select>
            </label>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-x-2">
            <Chave ligado={plano.cortar_erros} rotulo="Tirar erros" onMudar={(v) => mudar((p) => ({ ...p, cortar_erros: v }))} />
            <Chave ligado={plano.cortar_pausas} rotulo="Tirar pausas" onMudar={(v) => mudar((p) => ({ ...p, cortar_pausas: v }))} />
            <Chave ligado={plano.motion.ligado} rotulo="Animações" onMudar={(v) => mudar((p) => ({ ...p, motion: { ...p.motion, ligado: v } }))} />
            <Chave ligado={plano.broll.ligado} rotulo="B-roll do acervo" onMudar={(v) => mudar((p) => ({ ...p, broll: { ...p.broll, ligado: v, maximo: v && !p.broll.maximo ? 4 : p.broll.maximo } }))} />
            <Chave ligado={plano.sons.ligado} rotulo="Efeitos sonoros" onMudar={(v) => mudar((p) => ({ ...p, sons: { ...p.sons, ligado: v } }))} />
            <Chave ligado={plano.transicoes.ligado} rotulo="Transições" onMudar={(v) => mudar((p) => ({ ...p, transicoes: { ...p.transicoes, ligado: v } }))} />
            <Chave ligado={plano.cartao_final.ligado} rotulo="Cartão final" onMudar={(v) => mudar((p) => ({ ...p, cartao_final: { ...p.cartao_final, ligado: v } }))} />
            <Chave ligado={plano.capitulos} rotulo="Capítulos" onMudar={(v) => mudar((p) => ({ ...p, capitulos: v }))} />
            <Chave ligado={plano.virais} rotulo="Momentos virais" onMudar={(v) => mudar((p) => ({ ...p, virais: v }))} />
          </div>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Música abaixo da voz</span>
            <select className={juntar(campo, "mt-1 h-8")} value={plano.musica.ligado ? plano.musica.fonte : ""} onChange={(e) => mudar((p) => ({ ...p, musica: { ligado: !!e.target.value, fonte: e.target.value } }))} data-musica-do-plano="">
              <option value="">Sem música</option>
              {resumo.musicas.map((k) => (
                <option key={k} value={k}>
                  {projeto.fontes[k] ? projeto.fontes[k].nome : k}
                </option>
              ))}
            </select>
            {!resumo.musicas.length && <span className={texto.auxiliar}>Nenhuma música na Mídia do projeto: ponha uma em Mídia ou Som.</span>}
          </label>
          <label className="block">
            <span className={texto.rotulo}>Gancho (3 primeiros segundos)</span>
            <input className={juntar(campo, "mt-1 h-8")} value={plano.textos.gancho} maxLength={60} onChange={(e) => mudar((p) => ({ ...p, textos: { ...p.textos, gancho: e.target.value } }))} placeholder="Vazio: sem gancho escrito" />
          </label>
          {semRosto.length > 0 && (
            <p className="text-[12px] text-muted-foreground">
              O recorte fica no centro até rastrear o rosto.{" "}
              {irPara && (
                <button type="button" className="underline" onClick={() => irPara("formato")}>
                  Rastrear o rosto
                </button>
              )}
            </p>
          )}
          <ul className={juntar(texto.auxiliar, "space-y-0.5")} aria-label="O que o plano faz">
            {linhasDoPlano(plano).map((l) => (
              <li key={l} className="flex min-w-0">
                <Check className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">{l}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center">
            <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void montar()} disabled={!!ocupado} data-montar-edicao="">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Montar a edição
            </button>
            <button type="button" className={juntar(botao.discreto, "ml-1 h-8")} onClick={() => setEtapa("pedido")} disabled={!!ocupado}>
              Mudar o pedido
            </button>
          </div>
        </div>
      )}

      {montagem && etapa === "proposta" && (
        <div className="space-y-2 border-t border-border pt-3" data-proposta-da-ia="">
          <ul className="space-y-1" aria-label="Peças da edição">
            {montagem.passos.map((x) => (
              <li key={x.id} className="flex min-w-0 text-[12px]">
                {x.feito ? <Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" /> : <X className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="font-medium">{x.rotulo}</span>
                  <span className="text-muted-foreground">: {x.detalhe}</span>
                </span>
              </li>
            ))}
          </ul>
          {montagem.p.operacoes.length ? (
            <CartaoDeAcao key={montagem.id} acao={montagem.acao} titulo="Editar com IA" onPedido={aoPedido} observacao="Nada muda até confirmar. Depois, um Desfazer volta tudo (Ctrl+Z também)." />
          ) : (
            <p className={texto.auxiliar}>Nada para mudar com este plano.</p>
          )}
          <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setEtapa("plano")}>
            Voltar ao plano
          </button>
          <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>{montagem.p.operacoes.length} mudanças</span>
        </div>
      )}
    </div>
  );
}
