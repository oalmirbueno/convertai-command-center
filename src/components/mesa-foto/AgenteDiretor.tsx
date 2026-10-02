import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Aperture, Check, ImagePlus, Loader2, Megaphone, MessageSquarePlus, PackageOpen, PackageSearch, Paperclip, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto, EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { custoDaResposta, padraoPara, usd } from "@/lib/mesa/api";
import { AndamentoDoLote, tomadasDoLote } from "./AndamentoDoLote";
import { MiniaturaDaFoto, Pilulas, useMesaFoto } from "./Comuns";
import { GuiaDeEstiloNaTela } from "./GuiaDeEstilo";
import CartaoDaIdentificacao, { AcoesDaIdentificacao } from "./Identificacao";
import { iniciarLote } from "./lote";
import {
  acrescentarFotos,
  aplicarSugestao,
  chaveDaBiblioteca,
  chaveDosEnsaios,
  chaveDosKits,
  conversarComDiretor,
  esquecerRegraDoDiretor,
  guardarRegraDoDiretor,
  lerHistoricoDoDiretor,
  guardarEnsaio,
  identificarProduto,
  invalidarFotos,
  lerFotosParaIdentificar,
  lerPlanoDeCampanha,
  lerPlanoDeVariacoes,
  limitarQuantidade,
  partesDaLeitura,
  MAX_ANEXOS_DO_DIRETOR,
  partesDaConversa,
  partesDaGeracao,
  partesDaIdentificacao,
  rotuloDoTipoDeVariacao,
  subirOriginais,
  sugestaoPedeEnsaio,
  TIPOS_DE_VARIACAO,
  useFotos,
  type Ensaio,
  type IdentificacaoDoProduto,
  type MensagemDoDiretor,
  type OpcaoDoDiretor,
  type SugestaoDoAgente,
} from "./fotoApi";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { lerDaSessao } from "./sessao";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, conversa, foco, juntar } from "@/components/sistema/estilos";
import { gravarEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import CaminhoPronto from "@/components/agentes/CaminhoPronto";
import { chamarAcaoDoAgente, caminhoSeguro, type AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import CartaoDaGeracao from "./CartaoDaGeracao";
import PropostaAoVivo from "./PropostaAoVivo";
import ProvaDoDiretor from "./ProvaDoDiretor";
import { atualizarTelasDepoisDoDiretor, CHAVES_DO_ABERTO, focoDaTela, useContextoDoDiretor, useFocoDoDiretor } from "./diretorApi";

/**
 * O diretor de fotografia, fixo na lateral da área de trabalho da Mesa Foto
 * (26/09, sistema de design: antes era um botão flutuante que abria um
 * pop-up). Ele conhece o cliente, o produto (kit) e o ensaio abertos; as
 * fotos marcadas no Acervo e os prints de referência de estilo anexados vão
 * junto.
 *
 * v2 (pedido do dono: "está confuso, meio burro, uma linha"): a resposta vem
 * organizada (o que entendeu, parágrafos, listas e o próximo passo), e as
 * sugestões novas viram cartões que trabalham: plano de variações com
 * quantidade e tipos e "Gerar todas (N fotos, ~US$ X)", campanha com o guia
 * de estilo, e identificar o produto pela embalagem. Atalhos prontos para os
 * pedidos mais comuns. Nada gasta sem o preço à vista antes.
 *
 * Frente MF (27/09, "diretor que faz"): ordem clara, sem custo e com Desfazer
 * chega feita ("Feito na hora", com o Desfazer); geração barata começa
 * sozinha com o custo à vista e o botão Parar; o resto espera o Confirmar.
 * Toda resposta termina com o caminho (botão "Ir para ...", que vai sozinho
 * no pedido "faz e me leva") e com a prova do que foi feito (as fotos, antes
 * e depois).
 */

const chaveDaConversa = (clientId: string) => `mesa-foto:conversa:${clientId}`;

function lerConversa(clientId: string): string | null {
  try {
    return window.sessionStorage.getItem(chaveDaConversa(clientId));
  } catch {
    return null;
  }
}

function gravarConversa(clientId: string, id: string) {
  try {
    window.sessionStorage.setItem(chaveDaConversa(clientId), id);
  } catch {
    /* sem armazenamento: a conversa vale só nesta tela */
  }
}

/** "Nova conversa" pedida e ainda sem mensagem: reabrir a tela não relê a antiga (AG2). */
const chaveDaNova = (clientId: string) => `mesa-foto:conversa-nova:${clientId}`;

function novaPedida(clientId: string): boolean {
  try {
    return window.sessionStorage.getItem(chaveDaNova(clientId)) === "1";
  } catch {
    return false;
  }
}

function marcarNova(clientId: string, sim: boolean) {
  try {
    if (sim) window.sessionStorage.setItem(chaveDaNova(clientId), "1");
    else window.sessionStorage.removeItem(chaveDaNova(clientId));
  } catch {
    /* sem armazenamento: vale só nesta tela */
  }
}

let contador = 0;
const idLocal = () => `m-${Date.now()}-${++contador}`;

/** Atalhos do diretor: o pedido vai direto (o preço por envio fica à vista embaixo). */
export const ATALHOS_DO_DIRETOR: { rotulo: string; mensagem: string; icone: typeof Aperture }[] = [
  {
    rotulo: "Identificar produto",
    mensagem: "Identifique o produto pelas fotos (embalagem ou produto): marca, modelo e variante. Pesquise o produto real na internet e monte o kit com as referências.",
    icone: PackageSearch,
  },
  {
    rotulo: "Tirar da caixa",
    mensagem: "Crie o produto fora da caixa, fiel às fotos do produto e às referências da internet do kit, nunca à arte da caixa. Se não der, trabalhe com a embalagem.",
    icone: PackageOpen,
  },
  {
    rotulo: "8 fotos do produto",
    mensagem: "Monte um plano de 8 variações do produto: herói em fundo de cor, fundo branco, lifestyle na mesa, na mão, flat lay com props, macro de detalhe, cenário da marca e produto flutuando.",
    icone: Sparkles,
  },
  {
    rotulo: "Foto com modelo",
    mensagem: "Monte uma campanha com modelo sintético usando o produto do kit, com a pegada da marca e das referências de estilo anexadas.",
    icone: Megaphone,
  },
];

/**
 * A resposta do diretor em blocos: parágrafos, listas (linhas com "-", "•"
 * ou "1.") e títulos curtos terminados em ":". Nada de uma linha só.
 */
export function TextoOrganizado({ texto }: { texto: string }) {
  const blocos = texto
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const eItem = (l: string) => /^(\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(l);
  const semMarca = (l: string) => l.replace(/^(\s*[-*•]\s+|\s*\d+[.)]\s+)/, "");
  const saida: ReactNode[] = [];
  blocos.forEach((b, i) => {
    const linhas = b.split("\n").map((l) => l.trim()).filter(Boolean);
    let lista: string[] = [];
    let numerada = false;
    const fecharLista = (k: string) => {
      if (!lista.length) return;
      const itens = lista.map((t, j) => <li key={j}>{t}</li>);
      saida.push(
        numerada ? (
          <ol key={k} className="ml-4 list-decimal space-y-0.5">
            {itens}
          </ol>
        ) : (
          <ul key={k} className="ml-4 list-disc space-y-0.5">
            {itens}
          </ul>
        ),
      );
      lista = [];
    };
    linhas.forEach((l, j) => {
      if (eItem(l)) {
        if (!lista.length) numerada = /^\s*\d/.test(l);
        lista.push(semMarca(l));
        return;
      }
      fecharLista(`l-${i}-${j}`);
      if (l.length <= 60 && /:$/.test(l)) saida.push(<p key={`t-${i}-${j}`} className="font-semibold">{l.slice(0, -1)}</p>);
      else saida.push(<p key={`p-${i}-${j}`}>{l}</p>);
    });
    fecharLista(`l-${i}-fim`);
  });
  return <div className="space-y-1.5">{saida}</div>;
}

/** Tira da resposta as linhas "Entendi:" e "Próximo passo:" (elas já aparecem em destaque). */
export const semBlocos = (texto: string) =>
  texto
    .split("\n")
    .filter((l) => !/^\s*(entendi|pr[oó]ximo passo)\s*:/i.test(l))
    .join("\n")
    .trim();

/** Kits que o diretor gravou: relê a lista e põe o primeiro na barra (quando não há kit aberto). */
function useAoGravarKits() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const { kitId, escolherKit } = useMesaFoto();
  return (ids: string[], avisar = true) => {
    if (!ids.length) return;
    void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
    if (!kitId || ids.indexOf(kitId) < 0) escolherKit(ids[0]);
    if (avisar) toast.success(ids.length === 1 ? "Produto salvo como rascunho" : `${ids.length} kits salvos como rascunho`, { description: "Já está na barra de cima e em Produto." });
  };
}

/** Ensaio criado por um cartão: vai para o cache, para o endereço e, se pedido, começa o lote. */
function useAoCriarEnsaio() {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const { escolherEnsaio, escolherKit } = useMesaFoto();
  return (ensaio: Ensaio, gerar: boolean) => {
    guardarEnsaio(queryClient, clientId, ensaio);
    if (ensaio.kit_id) escolherKit(ensaio.kit_id);
    escolherEnsaio(ensaio.id);
    if (!gerar) return;
    const imagem = padraoPara(catalogo, "imagem");
    const pendentes = tomadasDoLote(ensaio);
    iniciarLote({
      clientId,
      ensaioId: ensaio.id,
      tomadas: pendentes.map((t) => ({ id: t.id, nome: t.nome })),
      modeloImagemId: imagem ? imagem.id : null,
      qualidade: "alta",
      queryClient,
      aoAtualizarCusto: atualizarCusto,
    });
  };
}

/** A sugestão já foi aplicada (marca guardada na conversa pela função, AG2). */
function aplicadaAntes(sugestao: SugestaoDoAgente): { ensaio_id: string | null } | null {
  const a = sugestao.bruto && (sugestao.bruto as Record<string, unknown>).aplicada;
  if (!a || typeof a !== "object") return null;
  const e = (a as Record<string, unknown>).ensaio_id;
  return { ensaio_id: typeof e === "string" && e ? e : null };
}

function CartaoDaSugestao({ sugestao, mensagemId }: { sugestao: SugestaoDoAgente; mensagemId?: string | null }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { ensaioId, irPara } = useMesaFoto();
  const [aplicando, setAplicando] = useState(false);
  const [aplicada, setAplicada] = useState(!!aplicadaAntes(sugestao));
  // Tomada nova ou ajuste só com ensaio aberto; prompt e busca de referência valem sem ensaio.
  const precisaDeEnsaio = sugestaoPedeEnsaio(sugestao);
  const bloqueada = precisaDeEnsaio && !ensaioId;
  const aplicar = async () => {
    if (bloqueada) return;
    setAplicando(true);
    try {
      const r = await aplicarSugestao({ clientId, ensaioId, mensagemId }, sugestao);
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      if (r.kit_ids.length) void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
      if (custoDaResposta(r) !== null) atualizarCusto();
      setAplicada(true);
      if (r.item) {
        void queryClient.invalidateQueries({ queryKey: chaveDaBiblioteca(clientId) });
        toast.success("Prompt guardado na biblioteca do cliente", { description: r.item.titulo });
      } else if (sugestao.tipo === "busca_referencia") {
        toast.success(`${r.referencias.length} ${r.referencias.length === 1 ? "referência achada" : "referências achadas"}`, {
          description: `Busque "${r.busca || "o termo"}" na Biblioteca para ver licença e autor e importar.`,
          duration: 9000,
        });
        irPara("biblioteca");
      } else toast.success("Sugestão aplicada ao ensaio");
    } catch (e) {
      avisarErro(e, "Sugestão não aplicada");
    } finally {
      setAplicando(false);
    }
  };
  return (
    <li className="min-w-0 rounded-md border border-primary/30 p-2.5" data-sugestao={sugestao.chave}>
      <p className="text-[13.5px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      <div className="mt-2 flex items-center">
        <Button type="button" size="sm" variant={aplicada ? "ghost" : "outline"} className="h-7 text-[11px]" disabled={bloqueada || aplicando || aplicada} onClick={() => void aplicar()}>
          {aplicando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : aplicada ? <Check className="mr-1 h-3.5 w-3.5" /> : null}
          {aplicada ? "Aplicada" : "Aplicar"}
        </Button>
        {bloqueada && <span className="ml-2 text-[11px] text-muted-foreground">Abra um ensaio para aplicar.</span>}
      </div>
    </li>
  );
}

const QUANTIDADES = [4, 6, 8, 12, 16].map((n) => ({ valor: n, rotulo: String(n) }));

/** plano_de_variacoes: quantidade e tipos ajustáveis, e gerar todas com o total antes. */
function CartaoDoPlanoDeVariacoes({ sugestao, mensagemId }: { sugestao: SugestaoDoAgente; mensagemId?: string | null }) {
  const { clientId, catalogo } = useMesa();
  const { kitId, ensaioId, irPara, escolherObjetivo } = useMesaFoto();
  const aoCriar = useAoCriarEnsaio();
  const plano = lerPlanoDeVariacoes(sugestao.bruto);
  const [quantidade, setQuantidade] = useState(plano.quantidade);
  const iniciais: string[] = [];
  plano.variacoes.forEach((v) => {
    if (v.tipo && iniciais.indexOf(v.tipo) < 0) iniciais.push(v.tipo);
  });
  const [tipos, setTipos] = useState<string[]>(iniciais);
  const [criado, setCriado] = useState<Ensaio | null>(null);
  const [montando, setMontando] = useState(false);
  // AG2: reabrir a conversa não oferece "Gerar todas" de novo: mostra o andamento do ensaio já criado.
  const jaCriado = aplicadaAntes(sugestao);
  const avisarErro = useAvisarErro();
  const kit = plano.kit_id || kitId;
  const imagem = padraoPara(catalogo, "imagem");
  const variacoes = plano.variacoes.filter((v) => !tipos.length || !v.tipo || tipos.indexOf(v.tipo) >= 0).slice(0, quantidade);
  const ajustes = { quantidade, tipos, variacoes: variacoes.map((v) => v.bruto) };
  const opcoesDeTipo = TIPOS_DE_VARIACAO.concat(iniciais.filter((t) => !TIPOS_DE_VARIACAO.some((x) => x.valor === t)).map((t) => ({ valor: t, rotulo: rotuloDoTipoDeVariacao(t) })));

  const criar = async () => {
    const r = await aplicarSugestao({ clientId, ensaioId, kitId: kit, mensagemId }, sugestao, ajustes);
    if (!r.ensaio) throw new Error("O diretor não montou o ensaio desta vez. Tente de novo.");
    return r;
  };

  const soMontar = async () => {
    setMontando(true);
    try {
      const r = await criar();
      if (r.ensaio) {
        aoCriar(r.ensaio, false);
        setCriado(r.ensaio);
        // A pessoa pediu as fotos do produto: a linha de produção passa a seguir esse objetivo.
        if (escolherObjetivo) escolherObjetivo("variacoes");
        irPara("ensaio", { ensaio: r.ensaio.id, kit: r.ensaio.kit_id || kit });
      }
    } catch (e) {
      avisarErro(e, "Ensaio não montado");
    } finally {
      setMontando(false);
    }
  };

  return (
    <li className="min-w-0 space-y-2 rounded-md border border-primary/40 p-2.5" data-sugestao={sugestao.chave} data-plano-de-variacoes="">
      <p className="text-[14px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      {variacoes.length > 0 && (
        <ol className="ml-4 list-decimal space-y-0.5 text-[13px] leading-snug">
          {variacoes.map((v, i) => (
            <li key={`${v.nome}-${i}`} className="[overflow-wrap:anywhere]">
              <span className="font-medium">{v.nome}</span>
              {v.tipo && v.nome !== rotuloDoTipoDeVariacao(v.tipo) ? <span className="text-muted-foreground"> · {rotuloDoTipoDeVariacao(v.tipo)}</span> : null}
              {[v.cenario, v.luz, v.camera].filter(Boolean).length > 0 && <span className="text-muted-foreground"> · {[v.cenario, v.luz, v.camera].filter(Boolean).join(" · ")}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Quantas fotos</p>
        <Pilulas rotulo="Quantidade de variações" opcoes={QUANTIDADES} valor={quantidade} onEscolher={(n) => setQuantidade(limitarQuantidade(n))} />
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Tipos (toque para escolher)</p>
        <div className="flex min-w-0 flex-wrap" role="group" aria-label="Tipos de variação">
          {opcoesDeTipo.map((t) => {
            const dentro = tipos.indexOf(t.valor) >= 0;
            return (
              <button
                key={t.valor}
                type="button"
                aria-pressed={dentro}
                onClick={() => setTipos((l) => (dentro ? l.filter((x) => x !== t.valor) : l.concat([t.valor])))}
                className={`mb-1 mr-1 h-7 max-w-full truncate rounded-full border px-2 text-[11px] ${dentro ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
              >
                {t.rotulo}
              </button>
            );
          })}
        </div>
      </div>
      {!kit && <p className="text-[12px] text-warning">Escolha o produto (identifique nas fotos) antes de gerar.</p>}
      {criado || (jaCriado && jaCriado.ensaio_id) ? (
        <AndamentoDoLote ensaioId={criado ? criado.id : String(jaCriado && jaCriado.ensaio_id)} />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center">
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar todas ({quantidade} {quantidade === 1 ? "foto" : "fotos"})
              </>
            }
            titulo="Variações a caminho"
            descricao="Monta o ensaio com estas variações e gera uma foto por vez. O total fica à vista antes."
            className="mb-1 mr-1.5 h-8 text-[12px]"
            disabled={!kit || !imagem}
            partes={() => partesDaGeracao(imagem ? imagem.id : null, "alta", quantidade)}
            fecharAoConfirmar
            executar={async () => {
              const r = await criar();
              if (r.ensaio) {
                aoCriar(r.ensaio, true);
                setCriado(r.ensaio);
              }
              return r;
            }}
          />
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" disabled={!kit || montando} onClick={() => void soMontar()}>
            {montando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Só montar o ensaio
          </Button>
        </div>
      )}
    </li>
  );
}

/** campanha: guia de estilo, modelo sintético e as fotos; gerar ou abrir na aba Campanha. */
function CartaoDaCampanha({ sugestao, mensagemId }: { sugestao: SugestaoDoAgente; mensagemId?: string | null }) {
  const { clientId, catalogo } = useMesa();
  const { kitId, ensaioId, irPara, escolherObjetivo } = useMesaFoto();
  const avisarErro = useAvisarErro();
  const aoCriar = useAoCriarEnsaio();
  const plano = lerPlanoDeCampanha(sugestao.bruto);
  const [quantidade, setQuantidade] = useState(plano.quantidade);
  const [criado, setCriado] = useState<Ensaio | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const jaCriado = aplicadaAntes(sugestao);
  const kit = plano.kit_id || kitId;
  const imagem = padraoPara(catalogo, "imagem");
  const ajustes = { quantidade, fotos: plano.fotos.slice(0, quantidade).map((f) => f.bruto) };
  const criar = async () => {
    const r = await aplicarSugestao({ clientId, ensaioId, kitId: kit, mensagemId }, sugestao, ajustes);
    if (!r.ensaio) throw new Error("O diretor não montou a campanha desta vez. Tente de novo.");
    return r;
  };
  const abrirNaAba = async () => {
    setAbrindo(true);
    try {
      const r = await criar();
      if (r.ensaio) {
        aoCriar(r.ensaio, false);
        // A pessoa pediu a foto com modelo: a linha de produção passa a seguir esse objetivo.
        if (escolherObjetivo) escolherObjetivo("modelo");
        irPara("campanha", { ensaio: r.ensaio.id, kit: r.ensaio.kit_id || kit });
      }
    } catch (e) {
      avisarErro(e, "Campanha não montada");
    } finally {
      setAbrindo(false);
    }
  };
  return (
    <li className="min-w-0 space-y-2 rounded-md border border-primary/40 p-2.5" data-sugestao={sugestao.chave} data-campanha="">
      <div className="flex min-w-0 items-start">
        <p className="min-w-0 text-[14px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
        {/* 28/09 (dono: "explicação no ?"): a regra da modelo sintética fica no "?" ao lado do título. */}
        <AjudaRecolhida className="ml-1.5 mt-0.5" rotulo="Sobre a modelo da campanha">
          Pessoa sintética, adulta, sem parecer com ninguém real. O produto não muda. Toda foto sai marcada como gerada.
        </AjudaRecolhida>
      </div>
      {sugestao.descricao && <p className="text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      <GuiaDeEstiloNaTela guia={plano.guia_de_estilo} modelo={plano.modelo} compacto />
      {plano.fotos.length > 0 && (
        <ol className="ml-4 list-decimal space-y-0.5 text-[13px] leading-snug">
          {plano.fotos.slice(0, quantidade).map((f, i) => (
            <li key={`${f.nome}-${i}`} className="[overflow-wrap:anywhere]">
              <span className="font-medium">{f.nome}</span>
              {[f.cenario, f.luz, f.enquadramento].filter(Boolean).length > 0 && <span className="text-muted-foreground"> · {[f.cenario, f.luz, f.enquadramento].filter(Boolean).join(" · ")}</span>}
            </li>
          ))}
        </ol>
      )}
      <Pilulas rotulo="Quantidade de fotos da campanha" opcoes={QUANTIDADES} valor={quantidade} onEscolher={(n) => setQuantidade(limitarQuantidade(n))} />
      {!kit && <p className="text-[12px] text-warning">Escolha o produto (identifique nas fotos) antes de gerar.</p>}
      {criado || (jaCriado && jaCriado.ensaio_id) ? (
        <AndamentoDoLote ensaioId={criado ? criado.id : String(jaCriado && jaCriado.ensaio_id)} />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center">
          <BotaoComCusto
            rotulo={
              <>
                <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Gerar campanha ({quantidade} {quantidade === 1 ? "foto" : "fotos"})
              </>
            }
            titulo="Campanha a caminho"
            descricao="Monta a campanha e gera uma foto por vez, com o total à vista antes."
            className="mb-1 mr-1.5 h-8 text-[12px]"
            disabled={!kit || !imagem}
            partes={() => partesDaGeracao(imagem ? imagem.id : null, "alta", quantidade)}
            fecharAoConfirmar
            executar={async () => {
              const r = await criar();
              if (r.ensaio) {
                aoCriar(r.ensaio, true);
                setCriado(r.ensaio);
              }
              return r;
            }}
          />
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" disabled={!kit || abrindo} onClick={() => void abrirNaAba()}>
            {abrindo && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Abrir na aba Campanha
          </Button>
        </div>
      )}
    </li>
  );
}

/** Resultado da identificação: o kit já volta salvo como rascunho; confirmar ou abrir. */
function IdentificacaoComAcoes({ identificacao }: { identificacao: IdentificacaoDoProduto }) {
  const aoGravar = useAoGravarKits();
  return <CartaoDaIdentificacao identificacao={identificacao} compacto acoes={<AcoesDaIdentificacao identificacao={identificacao} onKits={aoGravar} />} />;
}

/** identificar_produto: lê as fotos indicadas (ou as anexadas) e pesquisa o produto real. */
function CartaoIdentificar({ sugestao, anexos }: { sugestao: SugestaoDoAgente; anexos: string[] }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const aoGravar = useAoGravarKits();
  const indicadas = lerFotosParaIdentificar(sugestao.bruto);
  const ids = indicadas.length ? indicadas : anexos;
  const [resultado, setResultado] = useState<IdentificacaoDoProduto | null>(null);
  return (
    <li className="min-w-0 space-y-2 rounded-md border border-primary/40 p-2.5" data-sugestao={sugestao.chave} data-identificar-produto="">
      <p className="text-[14px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      {resultado ? (
        <IdentificacaoComAcoes identificacao={resultado} />
      ) : (
        <BotaoComCusto
          rotulo={
            <>
              <PackageSearch className="mr-1.5 h-3.5 w-3.5" /> Identificar produto ({ids.length} {ids.length === 1 ? "foto" : "fotos"})
            </>
          }
          titulo="Produto identificado"
          descricao="Lê a embalagem ou a foto e pesquisa o produto real na internet (uso interno para fidelidade)."
          className="h-8 text-[12px]"
          disabled={!ids.length}
          partes={() => partesDaIdentificacao(catalogo, ids.length)}
          executar={() => identificarProduto(clientId, ids)}
          aoConcluir={(data: IdentificacaoDoProduto) => {
            setResultado(data);
            invalidarFotos(queryClient, clientId);
            if (data && data.kit && data.kit.id) aoGravar([data.kit.id]);
          }}
        />
      )}
      {!ids.length && <p className="text-[13px] text-muted-foreground">Marque as fotos no passo 1 ou anexe um print aqui embaixo.</p>}
    </li>
  );
}

/**
 * Feito na hora com "me leva" (a ação chegou pronta do servidor): a tela vai
 * sozinha uma vez, só com a resposta nova (reabrir a conversa não navega).
 */
function IrSozinho({ destino }: { destino: string }) {
  const noRoteador = useInRouterContext();
  return noRoteador ? <IrSozinhoNoRoteador destino={destino} /> : <IrSozinhoSemRoteador destino={destino} />;
}

function IrSozinhoNoRoteador({ destino }: { destino: string }) {
  const navigate = useNavigate();
  const foi = useRef(false);
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    navigate(destino);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function IrSozinhoSemRoteador({ destino }: { destino: string }) {
  const foi = useRef(false);
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    window.location.assign(destino);
  }, [destino]);
  return null;
}

/** Caminho da ação feita na hora que pede para ir sozinho (só com a resposta nova). */
function caminhoParaIrSozinho(m: MensagemDoDiretor): string | null {
  if (!m.nova || !m.acao || !m.acao.executada_direto) return null;
  const c = caminhoSeguro(m.acao.caminho);
  return c && c.abrir_sozinho ? c.destino : null;
}

/** Respostas prontas da pergunta do diretor: o toque manda a resposta (AG2). */
function OpcoesDoDiretor({ opcoes, onOpcao, ocupado }: { opcoes: OpcaoDoDiretor[]; onOpcao?: (mensagem: string) => void; ocupado?: boolean }) {
  if (!opcoes.length || !onOpcao) return null;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center" role="group" aria-label="Respostas prontas do diretor" data-opcoes-do-diretor="">
      {opcoes.map((o) => (
        <button
          key={o.mensagem}
          type="button"
          disabled={ocupado}
          title={o.mensagem}
          onClick={() => onOpcao(o.mensagem)}
          className={juntar("mb-1 mr-1 inline-flex h-7 max-w-full items-center rounded-md border border-primary/40 bg-background px-2 text-[11px] font-medium hover:border-primary disabled:opacity-60", foco)}
        >
          <span className="truncate">{o.rotulo}</span>
        </button>
      ))}
    </div>
  );
}

function Mensagem({ m, anexosDaConversa, onOpcao, ocupado }: { m: MensagemDoDiretor; anexosDaConversa: string[]; onOpcao?: (mensagem: string) => void; ocupado?: boolean }) {
  const { irPara } = useMesaFoto();
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const irSozinhoPara = caminhoParaIrSozinho(m);
  if (m.sistema) {
    return (
      <p className="mr-2 min-w-0 text-[12px] text-muted-foreground [overflow-wrap:anywhere]" data-linha-do-sistema="">
        {m.texto}
      </p>
    );
  }
  if (m.papel === "usuario") {
    return (
      <div className="ml-8 min-w-0">
        <div className={juntar(conversa.balao, "whitespace-pre-wrap bg-primary/10")}>
          {m.texto}
          {m.anexos > 0 && (
            <span className="mt-1 block text-[12px] text-muted-foreground">
              {m.anexos} {m.anexos === 1 ? "foto junto" : "fotos junto"}
              {m.estilos ? `, ${m.estilos} como referência de estilo` : ""}
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="mr-2 min-w-0">
      <div className={juntar(conversa.balao, "space-y-2 bg-muted/60")}>
        {m.entendi && (
          <p className="rounded-md bg-card px-2.5 py-1.5 text-[13px]" data-entendi="">
            <span className="font-semibold">Entendi: </span>
            {m.entendi}
          </p>
        )}
        <TextoOrganizado texto={m.entendi || m.proximo_passo ? semBlocos(m.texto) : m.texto} />
        {m.proximo_passo && (
          <p className="rounded-md border border-primary/30 px-2.5 py-1.5 text-[13.5px]" data-proximo-do-diretor="">
            <span className="font-semibold text-primary">Próximo passo: </span>
            {m.proximo_passo}
          </p>
        )}
        {m.kit_ids && m.kit_ids.length > 0 && (
          <button type="button" className="text-[13px] font-medium text-primary hover:underline" onClick={() => irPara("kits", { kit: (m.kit_ids || [])[0] })}>
            Kit salvo como rascunho: abrir em Produto
          </button>
        )}
      </div>
      {m.identificacao && (
        <div className="mt-2">
          <IdentificacaoComAcoes identificacao={m.identificacao} />
        </div>
      )}
      {m.aviso && (
        <p role="status" className="mt-1.5 text-[12px] text-warning [overflow-wrap:anywhere]" data-aviso-registro="">
          {m.aviso}
        </p>
      )}
      {m.sugestoes.length > 0 && (
        <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2">
          {m.sugestoes.map((s) =>
            s.tipo === "plano_de_variacoes" ? (
              <CartaoDoPlanoDeVariacoes key={s.chave} sugestao={s} mensagemId={m.mensagemId} />
            ) : s.tipo === "campanha" ? (
              <CartaoDaCampanha key={s.chave} sugestao={s} mensagemId={m.mensagemId} />
            ) : s.tipo === "identificar_produto" ? (
              <CartaoIdentificar key={s.chave} sugestao={s} anexos={anexosDaConversa} />
            ) : (
              <CartaoDaSugestao key={s.chave} sugestao={s} mensagemId={m.mensagemId} />
            ),
          )}
        </ul>
      )}
      <OpcoesDoDiretor opcoes={m.opcoes || []} onOpcao={onOpcao} ocupado={ocupado} />
      {m.acao && m.mensagemId && (
        <div className="mt-2">
          <CartaoDeAcao
            acao={m.acao}
            titulo={m.acao.executada_direto ? "O diretor já fez nas fotos" : "O diretor vai fazer nas fotos"}
            observacao="Sem custo. Nenhuma foto é apagada, e dá para desfazer."
            onPedido={(p) => chamarAcaoDoAgente("mesa-foto", String(m.mensagemId), m.acao ? m.acao.id : "", p)}
            onFeito={(p, resposta) => {
              if (p === "descartar") return;
              invalidarFotos(queryClient, clientId);
              // AG2: produto (renomear, trocar foto) e ensaio montado também releem.
              void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
              void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
              // Diretor agêntico: clone, book e Canvas também releem (o resultado aparece na etapa aberta).
              if (m.acao && m.acao.agente === "diretor") atualizarTelasDepoisDoDiretor(queryClient, clientId, (resposta && (resposta.anexo as AcaoDoAgente)) || m.acao);
              const canvasId = resposta && (resposta as { canvas_id?: unknown }).canvas_id;
              if (p === "confirmar" && typeof canvasId === "string" && canvasId) {
                gravarEstadoDaTela(CHAVES_DO_ABERTO.canvas(clientId), canvasId);
                toast.success("Fotos no Canvas", { description: "Estão num canvas novo, já ligadas a um resultado.", action: { label: "Abrir", onClick: () => irPara("canvas") } });
              }
            }}
          />
          {/* Prova do que foi feito (feito na hora ou depois do Confirmar): as fotos que ele mexeu. */}
          {m.acao.executada_em && <ProvaDoDiretor acao={m.acao} />}
          {irSozinhoPara && <IrSozinho destino={irSozinhoPara} />}
        </div>
      )}
      {m.geracao && m.mensagemId && (
        <div className="mt-2">
          <CartaoDaGeracao acao={m.geracao} mensagemId={String(m.mensagemId)} iniciarSozinha={!!m.nova} />
        </div>
      )}
      {/* O caminho da resposta: a área onde a equipe continua (vai sozinho no "faz e me leva"). */}
      {m.caminho && !(m.acao && m.acao.executada_direto && m.acao.caminho) && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center" data-caminho-da-resposta="">
          <CaminhoPronto caminho={m.caminho} abrirSozinho={!!m.nova && !m.geracao && m.caminho.abrir_sozinho === true} />
        </div>
      )}
      {/* AG2: "Aprendi" (com Esquecer) e "Segui" do que a equipe ensinou. */}
      <AprendizadoDoAgente
        anexos={m.anexosBrutos}
        onEsquecer={(id) => esquecerRegraDoDiretor(clientId, id, m.mensagemId || null)}
        onGuardar={(textoDaRegra, tipo) => guardarRegraDoDiretor(clientId, textoDaRegra, tipo, m.mensagemId || null)}
      />
      {m.custo_usd !== null && <p className="mt-1 text-[11px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
    </div>
  );
}

/**
 * A conversa do diretor fica guardada fora do componente, por cliente: a
 * lateral pode remontar (gaveta do celular que vira coluna ao girar, Canvas
 * com a lateral própria) e a conversa não some. Vale enquanto a aba do
 * navegador estiver aberta (a mesma vida do id da conversa, no sessionStorage).
 * A resposta que chega com o painel fechado cai aqui e aparece ao reabrir.
 */
interface EstadoDaConversa {
  mensagens: MensagemDoDiretor[];
  conversaId: string | null;
  novaConversa: boolean;
  pendente: string | null;
}

const conversas: Record<string, EstadoDaConversa> = {};
const ouvintes: Record<string, Array<() => void>> = {};
const chaveViva = (clientId: string) => `mesa-foto:conversa-viva:${clientId}`;

function conversaGuardada(clientId: string): EstadoDaConversa {
  let viva = false;
  try {
    viva = window.sessionStorage.getItem(chaveViva(clientId)) === "1";
  } catch {
    viva = !!conversas[clientId];
  }
  if (!conversas[clientId] || !viva) {
    const nova = novaPedida(clientId);
    conversas[clientId] = { mensagens: [], conversaId: nova ? null : lerConversa(clientId), novaConversa: nova, pendente: null };
    try {
      window.sessionStorage.setItem(chaveViva(clientId), "1");
    } catch {
      /* sem armazenamento: vale só enquanto a tela estiver aberta */
    }
  }
  return conversas[clientId];
}

function mudarConversa(clientId: string, mudar: (e: EstadoDaConversa) => Partial<EstadoDaConversa>) {
  const atual = conversaGuardada(clientId);
  conversas[clientId] = { ...atual, ...mudar(atual) };
  (ouvintes[clientId] || []).slice().forEach((o) => o());
}

function useConversaGuardada(clientId: string): EstadoDaConversa {
  const [, setVersao] = useState(0);
  useEffect(() => {
    const ouvir = () => setVersao((n) => n + 1);
    ouvintes[clientId] = (ouvintes[clientId] || []).concat([ouvir]);
    return () => {
      ouvintes[clientId] = (ouvintes[clientId] || []).filter((o) => o !== ouvir);
    };
  }, [clientId]);
  return conversaGuardada(clientId);
}

/** Último pedido de outra etapa já posto no rascunho (remontar a lateral não repõe o mesmo pedido). */
const pedidosVistos: Record<string, number> = {};

/** Histórico já pedido ao servidor nesta aba (remontar a lateral não relê). */
const historicoPedido: Record<string, boolean> = {};

function Conversa({ mensagens, pendente, anexos, onOpcao }: { mensagens: MensagemDoDiretor[]; pendente: string | null; anexos: string[]; onOpcao?: (mensagem: string) => void }) {
  return (
    <>
      {mensagens.length === 0 && !pendente && (
        <p className={juntar(conversa.apoio, "leading-relaxed")} data-diretor-vazio="">
          Peça: melhorar uma foto, fotos do produto, foto com modelo, book ou um post na Agenda.
        </p>
      )}
      {mensagens.map((m, i) => (
        <Mensagem key={m.id} m={m} anexosDaConversa={anexos} onOpcao={i === mensagens.length - 1 ? onOpcao : undefined} ocupado={!!pendente} />
      ))}
      {pendente && (
        <p role="status" className="mr-6 inline-flex items-center rounded-xl bg-muted px-3.5 py-2.5 text-[13px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O diretor está pensando...
        </p>
      )}
    </>
  );
}

/**
 * O diretor de fotografia, fixo na lateral da área de trabalho da Mesa Foto
 * (PainelDoAgente do sistema de design): cabeçalho parado, a conversa rolando
 * por dentro e o campo sempre à vista embaixo. No celular, a gaveta aberta
 * pelo botão de baixo. O rascunho fica guardado por cliente (sair e voltar
 * mantém). Pedido de outra etapa (ex.: Criar, "8 variações") vai direto ao diretor.
 */
export default function AgenteDiretor({
  pedido,
}: {
  /** Pedido vindo de outra etapa (atalho): vai direto ao diretor (no rascunho se ele ainda pensa). */
  pedido?: { mensagem: string; em: number } | null;
} = {}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { kitId, ensaioId, selecionadas, etapa } = useMesaFoto();
  const fotos = useFotos(clientId);
  // Contexto automático: o que está aberto na tela e o pacote do cliente (sem IA; a página já carrega com a lateral recolhida).
  const focoNaTela = useFocoDoDiretor(clientId, etapa || "acervo", selecionadas, kitId, ensaioId);
  const contextoDoDiretor = useContextoDoDiretor(clientId, focoNaTela);
  const aoGravarKits = useAoGravarKits();
  const conversa = useConversaGuardada(clientId);
  const { mensagens, conversaId, novaConversa, pendente } = conversa;
  const [texto, setTexto] = useEstadoDaTela<string>(`mesa-foto:diretor:rascunho:${clientId}`, "");
  const [erro, setErro] = useState<unknown>(null);
  const [comFotos, setComFotos] = useState(true);
  const [estilos, setEstilos] = useState<string[]>([]);
  const [subindo, setSubindo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  // A função lê até 4 anexos por mensagem: as fotos marcadas primeiro, depois os prints de estilo.
  const anexos = comFotos ? selecionadas.slice(0, MAX_ANEXOS_DO_DIRETOR) : [];
  const estilosQueCabem = estilos.slice(0, Math.max(0, MAX_ANEXOS_DO_DIRETOR - anexos.length));
  const fotosDosEstilos = (fotos.data || []).filter((f) => estilos.indexOf(f.id) >= 0);

  // AG2: a conversa guardada volta ao reabrir (recarregar, outra aba, outro dia), com os cartões no estado
  // em que estão. Só com a lista vazia e sem "Nova conversa" pedida; o que chegou enquanto lia não é trocado.
  useEffect(() => {
    const alvo = clientId;
    if (!alvo || historicoPedido[alvo]) return;
    const atual = conversaGuardada(alvo);
    if (atual.mensagens.length || atual.pendente || atual.novaConversa || novaPedida(alvo)) return;
    historicoPedido[alvo] = true;
    lerHistoricoDoDiretor({ clientId: alvo, conversaId: atual.conversaId, kitId, ensaioId })
      .then((r) => {
        if (!r.mensagens.length) return;
        if (r.conversa_id) gravarConversa(alvo, r.conversa_id);
        mudarConversa(alvo, (e) => (e.mensagens.length || e.pendente || e.novaConversa ? {} : { mensagens: r.mensagens, conversaId: r.conversa_id || e.conversaId }));
      })
      .catch((e) => {
        // Não trava a conversa nova: o aviso diz que a anterior não voltou (e o próximo abrir tenta de novo).
        historicoPedido[alvo] = false;
        setErro(e);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // A conversa desce até a última mensagem (só a lista rola; a página não se mexe).
  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pendente]);

  const mandar = async (mensagem?: string) => {
    const msg = (mensagem !== undefined ? mensagem : texto).trim();
    if (!msg || pendente) return;
    const alvo = clientId;
    setErro(null);
    if (mensagem === undefined) setTexto("");
    // AG2: a bolha otimista tem id próprio; se o envio falhar, ela sai (o texto volta ao campo, sem duplicar no reenvio).
    const idDaBolha = idLocal();
    mudarConversa(alvo, (e) => ({
      pendente: msg,
      mensagens: e.mensagens.concat([{ id: idDaBolha, papel: "usuario", texto: msg, sugestoes: [], custo_usd: null, anexos: anexos.length + estilosQueCabem.length, estilos: estilosQueCabem.length }]),
    }));
    try {
      // A campanha da Mesa escolhida (sessão) vai junto: o diretor fala dentro dela.
      const campanhaId = lerDaSessao<string>(alvo, "campanha");
      // O foco da tela vai junto (etapa, clone, book, produto e o que está marcado): o diretor trabalha nisso.
      const focoAgora = focoDaTela({ clientId: alvo, etapa: etapa || "acervo", selecionadas: comFotos ? selecionadas : [], kitId, ensaioId });
      const r = await conversarComDiretor({ clientId: alvo, mensagem: msg, conversaId, kitId, ensaioId, anexos, anexosDeEstilo: estilosQueCabem, novaConversa, campanhaId, foco: { ...focoAgora } });
      if (r.conversa_id) gravarConversa(alvo, r.conversa_id);
      marcarNova(alvo, false);
      if (r.kit_ids.length) aoGravarKits(r.kit_ids);
      if (r.identificacao) invalidarFotos(queryClient, alvo);
      mudarConversa(alvo, (e) => ({
        novaConversa: false,
        conversaId: r.conversa_id || e.conversaId,
        mensagens: e.mensagens.concat([
          {
            id: idLocal(),
            papel: "agente",
            texto: r.resposta || "Sem resposta.",
            sugestoes: r.sugestoes,
            custo_usd: r.custo_usd,
            anexos: 0,
            entendi: r.entendi,
            proximo_passo: r.proximo_passo,
            kit_ids: r.kit_ids,
            identificacao: r.identificacao,
            acao: r.acao,
            geracao: r.geracao,
            mensagemId: r.mensagem_id,
            caminho: r.caminho,
            opcoes: r.opcoes,
            aviso: r.aviso_registro,
            anexosBrutos: r.anexos,
            nova: true,
          },
        ]),
      }));
      // O que vai sozinho (ir para a área, começar a geração barata) só vale agora: depois, só com o clique.
      window.setTimeout(() => mudarConversa(alvo, (e) => ({ mensagens: e.mensagens.map((x) => (x.nova ? { ...x, nova: false } : x)) })), 2500);
      if (r.acao && r.acao.executada_direto) atualizarTelasDepoisDoDiretor(queryClient, alvo, r.acao);
      if (estilosQueCabem.length) setEstilos((l) => l.filter((id) => estilosQueCabem.indexOf(id) < 0));
    } catch (e) {
      setErro(e);
      mudarConversa(alvo, (st) => ({ mensagens: st.mensagens.filter((x) => x.id !== idDaBolha) }));
      setTexto((t) => t || msg);
    } finally {
      mudarConversa(alvo, () => ({ pendente: null }));
      atualizarCusto();
    }
  };

  // Pedido de outra etapa (ex.: Criar, "8 variações"): vai direto ao diretor,
  // como antes (a janela abria e mandava). Com o diretor ainda pensando, entra
  // no rascunho, com o campo em foco.
  useEffect(() => {
    if (!pedido || pedidosVistos[clientId] === pedido.em) return;
    pedidosVistos[clientId] = pedido.em;
    if (!pendente) {
      void mandar(pedido.mensagem);
      return;
    }
    setTexto(pedido.mensagem);
    window.setTimeout(() => {
      const el = campo.current;
      if (el && typeof el.focus === "function") el.focus();
    }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido ? pedido.em : 0, clientId]);

  const comecarDeNovo = () => {
    mudarConversa(clientId, () => ({ mensagens: [], conversaId: null, novaConversa: true }));
    marcarNova(clientId, true);
    try {
      window.sessionStorage.removeItem(chaveDaConversa(clientId));
    } catch {
      /* nada guardado */
    }
  };

  const anexarPrints = async (arquivos: File[]) => {
    if (!arquivos.length || subindo) return;
    setSubindo(true);
    try {
      const r = await subirOriginais(clientId, arquivos.slice(0, MAX_ANEXOS_DO_DIRETOR), () => undefined);
      acrescentarFotos(queryClient, clientId, r.registradas);
      invalidarFotos(queryClient, clientId);
      const ids = r.registradas.map((f) => f.id);
      if (ids.length) setEstilos((l) => l.concat(ids.filter((id) => l.indexOf(id) < 0)).slice(0, MAX_ANEXOS_DO_DIRETOR));
      if (r.recusadas.length) toast.error(`${r.recusadas.length} ${r.recusadas.length === 1 ? "print não entrou" : "prints não entraram"}`, { description: r.recusadas.map((x) => `${x.nome}: ${x.motivo}`).join(". ") });
    } catch (e) {
      avisarErro(e, "Print não anexado");
    } finally {
      setSubindo(false);
    }
  };

  const qtdMarcadas = Math.min(selecionadas.length, MAX_ANEXOS_DO_DIRETOR);
  // Fotos que a próxima mensagem lê por visão (uma vez por imagem): entram no preço à vista.
  const leiturasDaProxima = Math.min(MAX_ANEXOS_DO_DIRETOR, (contextoDoDiretor.data ? contextoDoDiretor.data.sem_leitura : 0) + estilosQueCabem.length);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-diretor="">
      <PainelDoAgente
        titulo="Diretor de fotografia"
        icone={<Aperture className="h-4 w-4" />}
        descricao={
          contextoDoDiretor.data && contextoDoDiretor.data.resumo
            ? <span data-contexto-do-diretor="">{contextoDoDiretor.data.foco_rotulo ? `${contextoDoDiretor.data.foco_rotulo} · ` : ""}{contextoDoDiretor.data.resumo}</span>
            : kitId || ensaioId
              ? "Com o produto e o ensaio abertos"
              : "Com o contexto do cliente"
        }
        acoes={
          <>
            {mensagens.length > 0 && (
              <button type="button" onClick={comecarDeNovo} aria-label="Nova conversa" title="Nova conversa" className={botao.icone}>
                <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <AjudaRecolhida rotulo="Como o diretor funciona">
              Ele já carrega o cliente sozinho: marca, histórico, campanha da Mesa, fotos, clones, books, produtos, posts de fotos na Agenda e o que está aberto e marcado na etapa. Lê cada foto nova uma vez e guarda. Pedido claro e sem custo ele já faz (até 5 itens, com Desfazer). Geração barata (até US$ 0,40 e 4 fotos) começa sozinha com o custo à vista e o botão Parar; acima disso, espera o seu Confirmar. Nunca apaga (arquiva). Termina com o botão para ir à área certa e mostra as fotos como prova.
            </AjudaRecolhida>
          </>
        }
        refDasMensagens={lista}
        rotuloDasMensagens="Conversa com o diretor de fotografia"
        avisos={erro ? <AvisoDeErro erro={erro} /> : null}
        compositor={
          <>
            <OQuePossoFazer
              capacidades={[
                "melhorar fotos (luz, limpar, fundo, cenário) e gerar variações, fotos do clone e do book",
                "montar post de fotos na Agenda e abrir a foto no Estúdio",
                "aprovar, arquivar, organizar, montar book e levar ao Canvas",
                "montar o ensaio (variações ou campanha) sem gerar, renomear o produto e trocar as fotos dele",
              ]}
            />
            <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Atalhos do diretor">
              {ATALHOS_DO_DIRETOR.map((a) => {
                const Icone = a.icone;
                return (
                  <button
                    key={a.rotulo}
                    type="button"
                    disabled={!!pendente}
                    onClick={() => void mandar(a.mensagem)}
                    className={juntar(
                      "mb-1 mr-1 inline-flex h-7 max-w-full items-center rounded-md border border-border bg-background px-2 text-[11px] font-medium transition-colors hover:border-primary/50 disabled:opacity-60",
                      foco,
                    )}
                  >
                    <Icone className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span className="truncate">{a.rotulo}</span>
                  </button>
                );
              })}
            </div>
            {fotosDosEstilos.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center" aria-label="Prints de referência anexados">
                {fotosDosEstilos.map((f) => (
                  <span key={f.id} className="relative mb-1 mr-1.5 w-9">
                    <MiniaturaDaFoto foto={f} selo={false} />
                    <button
                      type="button"
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
                      aria-label={`Tirar ${f.nome}`}
                      onClick={() => setEstilos((l) => l.filter((x) => x !== f.id))}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <span className="mb-1 text-[11px] text-muted-foreground">estilo, não é o produto</span>
              </div>
            )}
            {/* 02/10: o diretor preenche enquanto a pessoa escreve (produto, modelo, quantas, ângulos, cenas, luz). */}
            <PropostaAoVivo texto={texto} onConfirmado={() => setTexto("")} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mandar();
              }}
              className="min-w-0"
            >
              <Textarea
                ref={campo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void mandar();
                  }
                }}
                rows={3}
                placeholder="Ex.: 8 fotos do mouse, uma com fundo verde da marca."
                aria-label="Mensagem ao diretor"
                className="resize-none"
              />
              <div className="mt-2 flex min-w-0 items-center justify-between">
                <div className="mr-2 min-w-0 flex-1">
                  <EstimativaInline partes={partesDaConversa(catalogo).concat(leiturasDaProxima ? partesDaLeitura(catalogo, leiturasDaProxima) : [])} />
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    className={juntar(botao.icone, "mr-0.5 disabled:opacity-60")}
                    aria-label="Anexar print de referência de estilo"
                    title="Anexar print de perfil ou moodboard (referência de estilo)"
                    disabled={subindo || !!pendente}
                    onClick={() => entrada.current && entrada.current.click()}
                  >
                    {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  </button>
                  <Ditado valor={texto} onChange={setTexto} disabled={!!pendente} className="mr-1" />
                  <Button type="submit" size="sm" className="h-8 px-3 text-[13px]" disabled={!texto.trim() || !!pendente} aria-label="Mandar">
                    {pendente ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                    Mandar
                  </Button>
                </div>
              </div>
              <input
                ref={entrada}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                aria-label="Escolher prints de referência"
                onChange={(e) => {
                  const listaDeArquivos = e.target.files;
                  const arquivos: File[] = [];
                  if (listaDeArquivos) for (let i = 0; i < listaDeArquivos.length; i++) arquivos.push(listaDeArquivos[i]);
                  e.target.value = "";
                  void anexarPrints(arquivos);
                }}
              />
            </form>
            {selecionadas.length > 0 && (
              <label className="flex min-w-0 items-center text-[11px] text-muted-foreground">
                <input type="checkbox" checked={comFotos} onChange={(e) => setComFotos(e.target.checked)} className="mr-1.5 h-3 w-3 shrink-0" />
                <Paperclip className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">Mandar {qtdMarcadas === 1 ? "a foto marcada" : `as ${qtdMarcadas} primeiras fotos marcadas`}</span>
              </label>
            )}
          </>
        }
      >
        <Conversa mensagens={mensagens} pendente={pendente} anexos={anexos.concat(estilosQueCabem)} onOpcao={(msg) => void mandar(msg)} />
      </PainelDoAgente>
    </div>
  );
}
