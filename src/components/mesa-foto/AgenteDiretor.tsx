import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Aperture, Check, ImagePlus, Loader2, Megaphone, PackageOpen, PackageSearch, Paperclip, Send, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
  chaveDosKits,
  conversarComDiretor,
  guardarEnsaio,
  identificarProduto,
  invalidarFotos,
  lerFotosParaIdentificar,
  lerPlanoDeCampanha,
  lerPlanoDeVariacoes,
  limitarQuantidade,
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
  type SugestaoDoAgente,
} from "./fotoApi";
import { lerDaSessao } from "./sessao";

/**
 * O diretor de fotografia, à mão em qualquer etapa: botão flutuante no
 * centro da base da tela (acima da barra do celular) que abre a conversa num
 * pop-up grande e centralizado. Ele conhece o cliente, o produto (kit) e o
 * ensaio abertos; as fotos marcadas no Acervo e os prints de referência de
 * estilo anexados vão junto.
 *
 * v2 (pedido do dono: "está confuso, meio burro, uma linha"): a resposta vem
 * organizada (o que entendeu, parágrafos, listas e o próximo passo), e as
 * sugestões novas viram cartões que trabalham: plano de variações com
 * quantidade e tipos e "Gerar todas (N fotos, ~US$ X)", campanha com o guia
 * de estilo, e identificar o produto pela embalagem. Atalhos prontos para os
 * pedidos mais comuns. Nada gasta sem o preço à vista antes.
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
    rotulo: "8 variações",
    mensagem: "Monte um plano de 8 variações do produto: herói em fundo de cor, fundo branco, lifestyle na mesa, na mão, flat lay com props, macro de detalhe, cenário da marca e produto flutuando.",
    icone: Sparkles,
  },
  {
    rotulo: "Campanha com modelo",
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

function CartaoDaSugestao({ sugestao }: { sugestao: SugestaoDoAgente }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { ensaioId, irPara } = useMesaFoto();
  const [aplicando, setAplicando] = useState(false);
  const [aplicada, setAplicada] = useState(false);
  // Tomada nova ou ajuste só com ensaio aberto; prompt e busca de referência valem sem ensaio.
  const precisaDeEnsaio = sugestaoPedeEnsaio(sugestao);
  const bloqueada = precisaDeEnsaio && !ensaioId;
  const aplicar = async () => {
    if (bloqueada) return;
    setAplicando(true);
    try {
      const r = await aplicarSugestao({ clientId, ensaioId }, sugestao);
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
    <li className="min-w-0 rounded-xl border border-primary/30 bg-card p-2.5" data-sugestao={sugestao.chave}>
      <p className="text-[12.5px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      <div className="mt-2 flex items-center">
        <Button type="button" size="sm" variant={aplicada ? "ghost" : "outline"} className="h-7 text-[11.5px]" disabled={bloqueada || aplicando || aplicada} onClick={() => void aplicar()}>
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
function CartaoDoPlanoDeVariacoes({ sugestao }: { sugestao: SugestaoDoAgente }) {
  const { clientId, catalogo } = useMesa();
  const { kitId, ensaioId, irPara } = useMesaFoto();
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
  const avisarErro = useAvisarErro();
  const kit = plano.kit_id || kitId;
  const imagem = padraoPara(catalogo, "imagem");
  const variacoes = plano.variacoes.filter((v) => !tipos.length || !v.tipo || tipos.indexOf(v.tipo) >= 0).slice(0, quantidade);
  const ajustes = { quantidade, tipos, variacoes: variacoes.map((v) => v.bruto) };
  const opcoesDeTipo = TIPOS_DE_VARIACAO.concat(iniciais.filter((t) => !TIPOS_DE_VARIACAO.some((x) => x.valor === t)).map((t) => ({ valor: t, rotulo: rotuloDoTipoDeVariacao(t) })));

  const criar = async () => {
    const r = await aplicarSugestao({ clientId, ensaioId, kitId: kit }, sugestao, ajustes);
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
        irPara("ensaio", { ensaio: r.ensaio.id, kit: r.ensaio.kit_id || kit });
      }
    } catch (e) {
      avisarErro(e, "Ensaio não montado");
    } finally {
      setMontando(false);
    }
  };

  return (
    <li className="min-w-0 space-y-2 rounded-xl border border-primary/40 bg-card p-3 sm:col-span-2" data-sugestao={sugestao.chave} data-plano-de-variacoes="">
      <p className="text-[13px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      {variacoes.length > 0 && (
        <ol className="ml-4 list-decimal space-y-0.5 text-[12px] leading-snug">
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
                className={`mb-1 mr-1 h-7 max-w-full truncate rounded-full border px-2 text-[11.5px] ${dentro ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
              >
                {t.rotulo}
              </button>
            );
          })}
        </div>
      </div>
      {!kit && <p className="text-[11.5px] text-warning">Escolha o produto (identifique nas fotos) antes de gerar.</p>}
      {criado ? (
        <AndamentoDoLote ensaioId={criado.id} />
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
function CartaoDaCampanha({ sugestao }: { sugestao: SugestaoDoAgente }) {
  const { clientId, catalogo } = useMesa();
  const { kitId, ensaioId, irPara } = useMesaFoto();
  const avisarErro = useAvisarErro();
  const aoCriar = useAoCriarEnsaio();
  const plano = lerPlanoDeCampanha(sugestao.bruto);
  const [quantidade, setQuantidade] = useState(plano.quantidade);
  const [criado, setCriado] = useState<Ensaio | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const kit = plano.kit_id || kitId;
  const imagem = padraoPara(catalogo, "imagem");
  const ajustes = { quantidade, fotos: plano.fotos.slice(0, quantidade).map((f) => f.bruto) };
  const criar = async () => {
    const r = await aplicarSugestao({ clientId, ensaioId, kitId: kit }, sugestao, ajustes);
    if (!r.ensaio) throw new Error("O diretor não montou a campanha desta vez. Tente de novo.");
    return r;
  };
  const abrirNaAba = async () => {
    setAbrindo(true);
    try {
      const r = await criar();
      if (r.ensaio) {
        aoCriar(r.ensaio, false);
        irPara("campanha", { ensaio: r.ensaio.id, kit: r.ensaio.kit_id || kit });
      }
    } catch (e) {
      avisarErro(e, "Campanha não montada");
    } finally {
      setAbrindo(false);
    }
  };
  return (
    <li className="min-w-0 space-y-2 rounded-xl border border-primary/40 bg-card p-3 sm:col-span-2" data-sugestao={sugestao.chave} data-campanha="">
      <p className="text-[13px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
      <GuiaDeEstiloNaTela guia={plano.guia_de_estilo} modelo={plano.modelo} compacto />
      {plano.fotos.length > 0 && (
        <ol className="ml-4 list-decimal space-y-0.5 text-[12px] leading-snug">
          {plano.fotos.slice(0, quantidade).map((f, i) => (
            <li key={`${f.nome}-${i}`} className="[overflow-wrap:anywhere]">
              <span className="font-medium">{f.nome}</span>
              {[f.cenario, f.luz, f.enquadramento].filter(Boolean).length > 0 && <span className="text-muted-foreground"> · {[f.cenario, f.luz, f.enquadramento].filter(Boolean).join(" · ")}</span>}
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground">Pessoa sintética, adulta, sem parecer com ninguém real. O produto não muda. Toda foto sai marcada como gerada.</p>
      <Pilulas rotulo="Quantidade de fotos da campanha" opcoes={QUANTIDADES} valor={quantidade} onEscolher={(n) => setQuantidade(limitarQuantidade(n))} />
      {!kit && <p className="text-[11.5px] text-warning">Escolha o produto (identifique nas fotos) antes de gerar.</p>}
      {criado ? (
        <AndamentoDoLote ensaioId={criado.id} />
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
    <li className="min-w-0 space-y-2 rounded-xl border border-primary/40 bg-card p-3 sm:col-span-2" data-sugestao={sugestao.chave} data-identificar-produto="">
      <p className="text-[13px] font-semibold [overflow-wrap:anywhere]">{sugestao.titulo}</p>
      {sugestao.descricao && <p className="text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{sugestao.descricao}</p>}
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
      {!ids.length && <p className="text-[11.5px] text-muted-foreground">Marque as fotos no passo 1 ou anexe um print aqui embaixo.</p>}
    </li>
  );
}

function Mensagem({ m, anexosDaConversa }: { m: MensagemDoDiretor; anexosDaConversa: string[] }) {
  const { irPara } = useMesaFoto();
  if (m.papel === "usuario") {
    return (
      <div className="ml-10 min-w-0">
        <div className="min-w-0 whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[13px] leading-relaxed text-primary-foreground [overflow-wrap:anywhere]">
          {m.texto}
          {m.anexos > 0 && (
            <span className="mt-1 block text-[11px] opacity-80">
              {m.anexos} {m.anexos === 1 ? "foto junto" : "fotos junto"}
              {m.estilos ? `, ${m.estilos} como referência de estilo` : ""}
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="mr-6 min-w-0">
      <div className="min-w-0 space-y-2 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
        {m.entendi && (
          <p className="rounded-lg bg-card px-2.5 py-1.5 text-[12px]" data-entendi="">
            <span className="font-semibold">Entendi: </span>
            {m.entendi}
          </p>
        )}
        <TextoOrganizado texto={m.entendi || m.proximo_passo ? semBlocos(m.texto) : m.texto} />
        {m.proximo_passo && (
          <p className="rounded-lg border border-primary/30 bg-card px-2.5 py-1.5 text-[12.5px]" data-proximo-do-diretor="">
            <span className="font-semibold text-primary">Próximo passo: </span>
            {m.proximo_passo}
          </p>
        )}
        {m.kit_ids && m.kit_ids.length > 0 && (
          <button type="button" className="text-[12px] font-medium text-primary hover:underline" onClick={() => irPara("kits", { kit: (m.kit_ids || [])[0] })}>
            Kit salvo como rascunho: abrir em Produto
          </button>
        )}
      </div>
      {m.identificacao && (
        <div className="mt-2">
          <IdentificacaoComAcoes identificacao={m.identificacao} />
        </div>
      )}
      {m.sugestoes.length > 0 && (
        <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {m.sugestoes.map((s) =>
            s.tipo === "plano_de_variacoes" ? (
              <CartaoDoPlanoDeVariacoes key={s.chave} sugestao={s} />
            ) : s.tipo === "campanha" ? (
              <CartaoDaCampanha key={s.chave} sugestao={s} />
            ) : s.tipo === "identificar_produto" ? (
              <CartaoIdentificar key={s.chave} sugestao={s} anexos={anexosDaConversa} />
            ) : (
              <CartaoDaSugestao key={s.chave} sugestao={s} />
            ),
          )}
        </ul>
      )}
      {m.custo_usd !== null && <p className="mt-1 text-[10.5px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
    </div>
  );
}

function Conversa({ mensagens, pendente, anexos }: { mensagens: MensagemDoDiretor[]; pendente: string | null; anexos: string[] }) {
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fim.current;
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "end" });
      } catch {
        /* navegador antigo */
      }
    }
  }, [mensagens.length, pendente]);
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
      {mensagens.length === 0 && !pendente && (
        <div className="mx-auto max-w-md py-6 text-center">
          <Aperture className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-2 text-[14px] font-semibold">Diretor de fotografia</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Peça o que quer fazer: identificar o produto pela caixa, tirar da caixa, 8 variações, campanha com modelo. Ele propõe e você gera com um clique, com o custo antes.
          </p>
        </div>
      )}
      {mensagens.map((m) => (
        <Mensagem key={m.id} m={m} anexosDaConversa={anexos} />
      ))}
      {pendente && (
        <p role="status" className="mr-6 inline-flex items-center rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O diretor está pensando...
        </p>
      )}
      <div ref={fim} />
    </div>
  );
}

export default function AgenteDiretor({
  aberto,
  onAberto,
  pedido,
}: {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  /** Pedido vindo de outra etapa (atalho): entra e vai direto. */
  pedido?: { mensagem: string; em: number } | null;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { kitId, ensaioId, selecionadas } = useMesaFoto();
  const fotos = useFotos(clientId);
  const aoGravarKits = useAoGravarKits();
  const [mensagens, setMensagens] = useState<MensagemDoDiretor[]>([]);
  const [texto, setTexto] = useState("");
  const [pendente, setPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [comFotos, setComFotos] = useState(true);
  const [conversaId, setConversaId] = useState<string | null>(() => lerConversa(clientId));
  const [estilos, setEstilos] = useState<string[]>([]);
  const [novaConversa, setNovaConversa] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  // A função lê até 4 anexos por mensagem: as fotos marcadas primeiro, depois os prints de estilo.
  const anexos = comFotos ? selecionadas.slice(0, MAX_ANEXOS_DO_DIRETOR) : [];
  const estilosQueCabem = estilos.slice(0, Math.max(0, MAX_ANEXOS_DO_DIRETOR - anexos.length));
  const fotosDosEstilos = (fotos.data || []).filter((f) => estilos.indexOf(f.id) >= 0);

  const mandar = async (mensagem?: string) => {
    const msg = (mensagem !== undefined ? mensagem : texto).trim();
    if (!msg || pendente) return;
    setErro(null);
    if (mensagem === undefined) setTexto("");
    setPendente(msg);
    setMensagens((l) =>
      l.concat([{ id: idLocal(), papel: "usuario", texto: msg, sugestoes: [], custo_usd: null, anexos: anexos.length + estilosQueCabem.length, estilos: estilosQueCabem.length }]),
    );
    try {
      // A campanha da Mesa escolhida (sessão) vai junto: o diretor fala dentro dela.
      const campanhaId = lerDaSessao<string>(clientId, "campanha");
      const r = await conversarComDiretor({ clientId, mensagem: msg, conversaId, kitId, ensaioId, anexos, anexosDeEstilo: estilosQueCabem, novaConversa, campanhaId });
      setNovaConversa(false);
      if (r.conversa_id) {
        setConversaId(r.conversa_id);
        gravarConversa(clientId, r.conversa_id);
      }
      if (r.kit_ids.length) aoGravarKits(r.kit_ids);
      if (r.identificacao) invalidarFotos(queryClient, clientId);
      setMensagens((l) =>
        l.concat([
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
          },
        ]),
      );
      if (estilosQueCabem.length) setEstilos((l) => l.filter((id) => estilosQueCabem.indexOf(id) < 0));
    } catch (e) {
      setErro(e);
      if (mensagem === undefined) setTexto(msg);
    } finally {
      setPendente(null);
      atualizarCusto();
    }
  };

  // Pedido de outra etapa (ex.: Criar > "8 variações"): manda assim que abre.
  const ultimoPedido = useRef<number>(0);
  useEffect(() => {
    if (!pedido || !aberto || pedido.em === ultimoPedido.current) return;
    ultimoPedido.current = pedido.em;
    void mandar(pedido.mensagem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido ? pedido.em : 0, aberto]);

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

  return (
    <>
      {!aberto && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[72px] z-40 flex justify-center px-4 md:bottom-6" data-agente-diretor="">
          <button
            type="button"
            onClick={() => onAberto(true)}
            className="pointer-events-auto inline-flex h-12 max-w-full items-center rounded-full bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground shadow-xl ring-4 ring-background transition-transform hover:scale-[1.02]"
            aria-label="Abrir o diretor de fotografia"
          >
            {pendente ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <Aperture className="mr-2 h-4 w-4 shrink-0" />}
            <span className="truncate">Diretor de fotografia</span>
            <span className="ml-2 hidden rounded-full bg-primary-foreground/15 px-2 py-0.5 text-[11px] font-medium sm:inline">conversar</span>
          </button>
        </div>
      )}
      <Dialog open={aberto} onOpenChange={onAberto}>
        <DialogContent className="flex h-[92vh] w-[calc(100vw-16px)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:h-[86vh] sm:w-[calc(100vw-48px)]">
          <DialogTitle className="sr-only">Diretor de fotografia</DialogTitle>
          <DialogDescription className="sr-only">Converse com o diretor de fotografia sobre o produto, o ensaio e as fotos do cliente.</DialogDescription>
          <div className="flex min-w-0 items-center border-b border-border px-4 py-3 pr-12">
            <Aperture className="mr-2 h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">Diretor de fotografia</p>
            {mensagens.length > 0 && (
              <button
                type="button"
                className="shrink-0 text-[11.5px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMensagens([]);
                  setConversaId(null);
                  setNovaConversa(true);
                  try {
                    window.sessionStorage.removeItem(chaveDaConversa(clientId));
                  } catch {
                    /* nada guardado */
                  }
                }}
              >
                Nova conversa
              </button>
            )}
          </div>
          <Conversa mensagens={mensagens} pendente={pendente} anexos={anexos.concat(estilosQueCabem)} />
          <div className="border-t border-border p-3">
            {!!erro && <AvisoDeErro erro={erro} className="mb-2" />}
            <div className="mb-2 flex min-w-0 flex-wrap items-center" role="group" aria-label="Atalhos do diretor">
              {ATALHOS_DO_DIRETOR.map((a) => {
                const Icone = a.icone;
                return (
                  <button
                    key={a.rotulo}
                    type="button"
                    disabled={!!pendente}
                    onClick={() => void mandar(a.mensagem)}
                    className="mb-1 mr-1.5 inline-flex h-7 max-w-full items-center rounded-full border border-border bg-background px-2.5 text-[11.5px] font-medium hover:border-primary/50 disabled:opacity-60"
                  >
                    <Icone className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{a.rotulo}</span>
                  </button>
                );
              })}
            </div>
            {fotosDosEstilos.length > 0 && (
              <div className="mb-2 flex min-w-0 flex-wrap items-center" aria-label="Prints de referência anexados">
                {fotosDosEstilos.map((f) => (
                  <span key={f.id} className="relative mb-1 mr-1.5 w-10">
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
                <span className="mb-1 text-[11px] text-muted-foreground">referência de estilo (não é o produto)</span>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mandar();
              }}
              className="relative"
            >
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void mandar();
                  }
                }}
                rows={2}
                placeholder="Ex.: 8 variações do mouse, uma com fundo verde da marca. Ou: campanha com modelo no estilo do print."
                aria-label="Mensagem ao diretor"
                className="pr-32 text-[13px]"
              />
              <div className="absolute bottom-1.5 right-1.5 flex items-center">
                <button
                  type="button"
                  className="mr-0.5 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                  aria-label="Anexar print de referência de estilo"
                  title="Anexar print de perfil ou moodboard (referência de estilo)"
                  disabled={subindo || !!pendente}
                  onClick={() => entrada.current && entrada.current.click()}
                >
                  {subindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </button>
                <Ditado valor={texto} onChange={setTexto} disabled={!!pendente} />
                <Button type="submit" size="sm" className="ml-1 h-8 w-8 p-0" disabled={!texto.trim() || !!pendente} aria-label="Mandar">
                  {pendente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <input
                ref={entrada}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                aria-label="Escolher prints de referência"
                onChange={(e) => {
                  const lista = e.target.files;
                  const arquivos: File[] = [];
                  if (lista) for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
                  e.target.value = "";
                  void anexarPrints(arquivos);
                }}
              />
            </form>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
              {selecionadas.length > 0 && (
                <label className="mr-3 inline-flex items-center">
                  <input type="checkbox" checked={comFotos} onChange={(e) => setComFotos(e.target.checked)} className="mr-1 h-3 w-3" />
                  <Paperclip className="mr-0.5 h-3 w-3" /> mandar {Math.min(selecionadas.length, MAX_ANEXOS_DO_DIRETOR) === 1 ? "a foto marcada" : `as ${Math.min(selecionadas.length, MAX_ANEXOS_DO_DIRETOR)} primeiras fotos marcadas`} no Acervo
                </label>
              )}
              <span className="mr-3 inline-flex items-center">
                <Wand2 className="mr-1 h-3 w-3" />
                {kitId || ensaioId ? "Com o produto e o ensaio abertos" : "Com o contexto do cliente"}
              </span>
              <EstimativaInline partes={partesDaConversa(catalogo)} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
