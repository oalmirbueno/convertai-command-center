import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, ChevronDown, ImagePlus, Link2, Loader2, RotateCcw, Sparkles, Undo2, Upload, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { foco, juntar, texto } from "@/components/sistema/estilos";
import { modelosAtivos, nomeDoModelo, padraoPara, QUALIDADES, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { enfileirarLaminas } from "@/lib/mesa/filaDeGeracao";
import { Ampliar } from "./Ampliar";
import { AvisoDeErro, BotaoComCusto, EstimativaInline } from "./Custo";
import { Cronometro } from "./Cronometro";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "./MesaContexto";
import { Campo, SeletorDeModelo, SeletorDeQualidade } from "./Seletores";
import SeletorDoAcervo from "./SeletorDoAcervo";
import { aplicarRespostaDaCampanha, marcarPedidoDaCampanha, usePedidoDaCampanha } from "./campanhasApi";
import type { Campanha } from "./mesaV4Api";
import {
  arquivarSelo,
  chavesDoSelo,
  escolherSelo,
  gerarOpcoes,
  laminasARefazer,
  lerEstadoDoSelo,
  melhorarSelo,
  mudarReferencias,
  partesDaGeracao,
  partesDasReferencias,
  partesDoMelhorar,
  partesDoRefazer,
  subirImagemDoSelo,
  TIPOS_DO_SELO_ENVIADO,
  usarSeloPronto,
  type EstadoDoSelo,
  type ImpactoNaTela,
  type OpcaoGerada,
  type SeloPronto,
  type VersaoDoSelo,
} from "./seloApi";
import {
  DEFINICAO_DO_ESTILO,
  ESTILO_AUTOMATICO,
  ESTILOS_DE_SELO,
  MAX_REFERENCIAS_DO_SELO,
  OPCOES_PADRAO_DE_SELO,
  PAPEIS_DA_REFERENCIA,
  ROTULO_DA_ORIGEM,
  ROTULO_DO_PAPEL_DA_REFERENCIA,
  rotuloDoEstilo,
  type EscolhaDeEstilo,
  type PapelDaReferencia,
} from "../../../supabase/functions/_shared/selo-da-campanha";
import { tipoDaCampanha } from "../../../supabase/functions/_shared/tipos-de-campanha";

/**
 * Selo da campanha (frente SEL, 30/09; pedido do dono em 29/09: "quero
 * escolher um selo pronto, pedir para melhorar, enviar uma referência, tudo;
 * está gerando muitos selos genéricos").
 *
 * Dois caminhos na mesma tela (frente UXS, 30/09: mais simples sem perder
 * nada): Gerar (3 ou 4 opções com a direção da campanha e da marca, estilo
 * nomeado e modelo escolhido na hora, custo antes; o botão vem primeiro e os
 * ajustes ficam recolhidos atrás de uma linha-resumo, lembrados por cliente)
 * e Escolher pronto (a logo da marca, enviar um arquivo PNG, SVG, JPG ou
 * WebP, os selos de outras campanhas e o acervo, com busca). Melhorar este
 * selo mostra a versão nova ao lado da antiga. Um formulário por vez
 * (Melhorar ou Trocar). Toda versão fica guardada: usar de novo é voltar. O
 * Estúdio anexa o selo escolhido ao gerador, que o desenha na arte, grande e
 * fiel (dono, 02/10: nada colado por cima), e a troca mostra
 * quantas artes usam o antigo, com o Refazer (custo à vista e segundo clique
 * para confirmar).
 */

type Caminho = "gerar" | "pronto";

const CAMINHOS: { valor: Caminho; rotulo: string }[] = [
  { valor: "gerar", rotulo: "Gerar" },
  // "Escolher pronto" é o nome que o servidor usa nos avisos (agente-calendario/selo-da-campanha.ts).
  { valor: "pronto", rotulo: "Escolher pronto" },
];

type Painel = "melhorar" | "trocar" | null;

/** Os ajustes do Gerar lembrados por cliente (o ajuste preferido da equipe). */
export interface AjustesDoGerar {
  estilo: EscolhaDeEstilo;
  quantidade: number;
  /** "" = o padrão de imagem do catálogo. */
  modelo: string;
  qualidade: Qualidade;
}

const AJUSTES_PADRAO: AjustesDoGerar = { estilo: ESTILO_AUTOMATICO, quantidade: OPCOES_PADRAO_DE_SELO, modelo: "", qualidade: "media" };

/** O que veio do navegador, campo a campo: valor velho ou estranho cai no padrão daquele campo. */
export function limparAjustesDoGerar(v: unknown): AjustesDoGerar {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const estilo =
    o.estilo === ESTILO_AUTOMATICO || (ESTILOS_DE_SELO as readonly string[]).indexOf(String(o.estilo)) >= 0 ? (o.estilo as EscolhaDeEstilo) : AJUSTES_PADRAO.estilo;
  const q = o.quantidade;
  const quantidade = typeof q === "number" && Math.floor(q) === q && q >= 1 && q <= 4 ? q : AJUSTES_PADRAO.quantidade;
  const qualidade = o.qualidade === "baixa" || o.qualidade === "media" || o.qualidade === "alta" ? o.qualidade : AJUSTES_PADRAO.qualidade;
  const modelo = typeof o.modelo === "string" ? o.modelo : "";
  return { estilo, quantidade, modelo, qualidade };
}

/** Plural simples: 1 lâmina, 2 lâminas. */
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

const rotuloDaQualidade = (q: Qualidade) => {
  const achada = QUALIDADES.find((x) => x.valor === q);
  return achada ? achada.rotulo : q;
};

/** Quadrinho do caminho pronto (logo, enviar): o mesmo cartão de mídia da miniatura dos selos. */
const QUADRINHO = juntar(
  "flex h-16 w-28 flex-col items-center justify-center rounded-md border border-border bg-background px-2 text-center text-[12px] leading-4 text-foreground transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-50",
  foco,
);

function Miniatura({ caminho, alt, tamanho = "h-16 w-16", marcada = false }: { caminho: string; alt: string; tamanho?: string; marcada?: boolean }) {
  return (
    <span className={juntar("block shrink-0 overflow-hidden rounded-md border bg-background", tamanho, marcada ? "border-primary" : "border-border")}>
      <ImagemDaMesa caminho={caminho} alt={alt} className="h-full w-full !object-contain p-1" />
    </span>
  );
}

function Linha({ children, tom = "neutro" }: { children: ReactNode; tom?: "neutro" | "aviso" | "ok" }) {
  const cor = tom === "aviso" ? "text-amber-600 dark:text-amber-400" : tom === "ok" ? "text-success" : "text-muted-foreground";
  return <p className={juntar("text-[12px] leading-4", cor)}>{children}</p>;
}

/** O que a troca do selo significa para as artes da campanha, com o Refazer (custo à vista e segundo clique para confirmar). */
function ArtesDaCampanha({ impacto, onRefeito }: { impacto: ImpactoNaTela; onRefeito: () => void }) {
  const { catalogo } = useMesa();
  const n = laminasARefazer(impacto);
  const enviadas = impacto.refazer.filter((r) => r.enviada).length;
  if (impacto.erro) return <Linha tom="aviso">{impacto.erro}</Linha>;
  const aprovadas = impacto.aprovadas.laminas;
  if (!aprovadas && !n) return null;
  const refazer = async () => {
    let naFila = 0;
    const falhas: string[] = [];
    for (const r of impacto.refazer) {
      try {
        const resp = await enfileirarLaminas(r.trabalho_id, r.ordens, false);
        if (!resp) throw new Error("A fila do Estúdio não respondeu. Gere de novo pelo Estúdio.");
        naFila += r.ordens.length;
      } catch (e) {
        falhas.push(textoDoErro(e));
      }
    }
    if (!naFila && falhas.length) throw new Error(falhas[0]);
    return { na_fila: naFila, falhas, aviso_da_acao: falhas.length ? `${falhas.length} ${plural(falhas.length, "arte não entrou", "artes não entraram")} na fila: ${falhas[0]}` : null };
  };
  // "Ficam como estão" (e não "com o selo antigo"): a lâmina sem o selo na arte também conta
  // aqui (impactoDaTroca). `n` conta lâminas; `enviadas` conta artes.
  const estado = [
    aprovadas > 0 ? `${aprovadas} ${plural(aprovadas, "aprovada fica como está", "aprovadas ficam como estão")}` : "",
    n > 0 ? `${n} ${plural(n, "lâmina", "lâminas")} a refazer${enviadas ? ` (${enviadas} ${plural(enviadas, "arte", "artes")} com o cliente)` : ""}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-w-0 flex-wrap items-center" data-selo="artes">
      <span className="mr-2 text-[12px] leading-4 text-muted-foreground">{estado}</span>
      {n > 0 && (
        <BotaoComCusto
          rotulo={
            <>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Refazer {n} {plural(n, "lâmina", "lâminas")}
            </>
          }
          titulo="Refazer com o selo novo"
          descricao={`As lâminas com selo das artes ainda não aprovadas entram na fila do Estúdio e saem com o selo novo${enviadas ? ", inclusive a arte que já está com o cliente" : ""}. O segundo clique confirma.`}
          partes={() => partesDoRefazer(catalogo, impacto)}
          executar={refazer}
          aoConcluir={() => onRefeito()}
          sempreConfirmar
          variant="ghost"
          className="h-7 px-2 text-primary"
        />
      )}
    </div>
  );
}

export default function CampanhaSelo({ campanha }: { campanha: Campanha }) {
  const { clientId, catalogo, catalogoCarregando } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const chave = chavesDoSelo.estado(clientId, campanha.id);
  const estado = useQuery({ queryKey: chave, queryFn: () => lerEstadoDoSelo(campanha.id), staleTime: 30_000 });
  // Resposta incompleta (função antiga no ar, SQL ainda não aplicado): a tela segue com listas vazias.
  const dados: EstadoDoSelo | undefined = estado.data && Array.isArray(estado.data.versoes) ? estado.data : undefined;

  // O caminho de costume fica lembrado por cliente (valor velho ou estranho volta ao Gerar).
  const [caminho, setCaminho] = useEstadoDaTela<Caminho>(`selo:caminho:${clientId}`, "gerar", { validar: (v) => v === "gerar" || v === "pronto" });
  // Um formulário por vez: Melhorar ou Trocar.
  const [painel, setPainel] = useState<Painel>(null);
  const [ampliar, setAmpliar] = useState<string | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [ultimaTroca, setUltimaTroca] = useState<{ anterior: string | null } | null>(null);
  const [tirarFundo, setTirarFundo] = useState(true);
  const [aviso, setAviso] = useState<string[]>([]);
  // Gerar: estilo, opções, modelo e qualidade lembrados por cliente, conferidos campo a campo.
  const [ajustesGuardados, setAjustesGuardados] = useEstadoDaTela<AjustesDoGerar>(`selo:ajustes:${clientId}`, AJUSTES_PADRAO, {
    validar: (v) => !!v && typeof v === "object",
    esperaMs: 0,
  });
  const { estilo, quantidade, qualidade, modelo: modeloGuardado } = limparAjustesDoGerar(ajustesGuardados);
  const mudarAjustes = (m: Partial<AjustesDoGerar>) => setAjustesGuardados((a) => ({ ...limparAjustesDoGerar(a), ...m }));
  // O guardado só vale se ainda estiver ativo; senão o padrão de imagem. Conta a cada render: o catálogo que chega depois acerta sozinho.
  const modeloValido = modeloGuardado && modelosAtivos(catalogo, "imagem").some((m) => m.id === modeloGuardado) ? modeloGuardado : "";
  const imagemPadrao = padraoPara(catalogo, "imagem");
  const modeloId = modeloValido || (imagemPadrao ? imagemPadrao.id : "");
  const modeloDoSelo = modeloId ? catalogo.find((m) => m.id === modeloId) || null : null;
  const nomeDoModeloDoSelo = modeloDoSelo ? nomeDoModelo(modeloDoSelo) : catalogoCarregando ? "Lendo os modelos" : "Escolha o modelo";
  // A grade dos ajustes: recolhida por padrão, aberta quando a campanha não tem selo; a escolha fica guardada.
  const [ajustesAbertos, setAjustesAbertos] = useEstadoDaTela<string>(`selo:ajustes:aberto:${clientId}`, "", { validar: (v) => v === "aberto" || v === "recolhido" });
  // null = a pessoa não mexeu no texto: o campo mostra o do servidor e o pedido vai sem texto (o servidor decide).
  const [textoDigitado, setTextoDigitado] = useState<string | null>(null);
  const [pedido, setPedido] = useState("");
  // Desenho em curso guardado fora do componente (chave "selo:<id>"): trocar de campanha e voltar
  // não libera um segundo desenho pago no meio do primeiro.
  const emCurso = usePedidoDaCampanha(`selo:${campanha.id}`);
  const gerandoDesde = emCurso ? emCurso.desde : null;
  const gerandoAgora = useRef<number | null>(gerandoDesde);
  gerandoAgora.current = gerandoDesde;
  const [opcoes, setOpcoes] = useState<OpcaoGerada[]>([]);
  // Melhorar
  const [pedidoDeMelhora, setPedidoDeMelhora] = useState("");
  const [linkDeMelhora, setLinkDeMelhora] = useState("");
  const [refsDeMelhora, setRefsDeMelhora] = useState<string[]>([]);
  const [comparar, setComparar] = useState<{ antes: VersaoDoSelo; nova: OpcaoGerada } | null>(null);
  // Referências
  const [linkDeReferencia, setLinkDeReferencia] = useState("");
  const [subindo, setSubindo] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const referenciaRef = useRef<HTMLInputElement>(null);
  const melhoraRef = useRef<HTMLInputElement>(null);

  const versoes = dados ? dados.versoes : [];
  const atual = versoes.find((v) => v.id === (dados ? dados.campanha.selo_id : campanha.selo_id)) || null;
  const caminhoAtual = dados ? dados.campanha.selo_path : campanha.selo_path;
  const referencias = dados && Array.isArray(dados.referencias) ? dados.referencias : [];
  const tipo = tipoDaCampanha(campanha.identidade);
  // Com selo de versão, a linha de estado e os botões esperam a leitura (nada pisca nem pula).
  const lendoOSelo = estado.isLoading && !!campanha.selo_id;

  const textoDoServidor = dados ? dados.texto : campanha.nome;
  const textoDoResumo = (textoDigitado !== null ? textoDigitado.trim() : "") || textoDoServidor || "";
  const resumoDoGerar = [
    estilo === ESTILO_AUTOMATICO ? "Automático" : rotuloDoEstilo(estilo),
    `${quantidade} ${plural(quantidade, "opção", "opções")}`,
    nomeDoModeloDoSelo,
    rotuloDaQualidade(qualidade),
    textoDoResumo ? `"${textoDoResumo}"` : "",
    pedido.trim() ? "com pedido" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const semModelo = !modeloId && !catalogoCarregando;
  const gradeAberta = semModelo || (ajustesAbertos === "" ? !caminhoAtual : ajustesAbertos === "aberto");

  const reler = () => {
    void qc.invalidateQueries({ queryKey: chave });
  };

  /** Resposta de uma troca (escolher, usar pronto): a campanha muda na tela e o Desfazer fica à mão. */
  const aplicarTroca = (data: { campanha?: unknown; anterior?: { selo_id: string | null } | null; avisos?: string[] }) => {
    aplicarRespostaDaCampanha(qc, clientId, data);
    if (data.anterior) setUltimaTroca({ anterior: data.anterior.selo_id });
    setAviso(data.avisos || []);
    reler();
  };

  /**
   * Troca o selo. O aviso de sucesso leva o Desfazer (com o selo de antes que
   * a própria resposta trouxe, não o do estado). `fecharCaminhos`: a troca
   * veio do Trocar (pronto, envio, logo, opção gerada): o formulário fecha e
   * as opções geradas ficam; com opções ainda chegando, fica aberto.
   */
  const trocar = async (fazer: () => Promise<any>, ok: string, opcoesDaTroca: { comDesfazer?: boolean; fecharCaminhos?: boolean } = {}) => {
    setTrocando(true);
    try {
      const data = await fazer();
      aplicarTroca(data);
      const anterior = opcoesDaTroca.comDesfazer !== false && data && data.anterior ? (data.anterior.selo_id as string | null) : undefined;
      if (anterior !== undefined) toast.success(ok, { action: { label: "Desfazer", onClick: () => void voltarPara(anterior) } });
      else toast.success(ok);
      if (opcoesDaTroca.fecharCaminhos && gerandoAgora.current === null) setPainel((p) => (p === "trocar" ? null : p));
      return data;
    } catch (e) {
      toast.error("O selo não foi trocado", { description: textoDoErro(e) });
      return null;
    } finally {
      setTrocando(false);
    }
  };

  const usarPronto = (p: SeloPronto, ok: string) => trocar(() => usarSeloPronto(campanha.id, p, tirarFundo), ok, { fecharCaminhos: true });
  const escolher = (seloId: string | null, ok = "Selo trocado.", opcoesDaTroca: { fecharCaminhos?: boolean } = {}) => trocar(() => escolherSelo(campanha.id, seloId), ok, opcoesDaTroca);
  /** Volta ao selo de antes (Desfazer do topo e do aviso). Esta troca não leva outro Desfazer. */
  async function voltarPara(anteriorId: string | null) {
    const r = await trocar(() => escolherSelo(campanha.id, anteriorId), "O selo de antes voltou.", { comDesfazer: false });
    if (r) setUltimaTroca(null);
    return r;
  }
  const desfazer = () => (ultimaTroca ? voltarPara(ultimaTroca.anterior) : Promise.resolve(null));

  const enviar = async (arquivo: File | null | undefined) => {
    if (!arquivo) return;
    setSubindo(true);
    try {
      const c = await subirImagemDoSelo(clientId, campanha.id, arquivo, "envio");
      await usarPronto({ origem: "enviado", caminho: c, nome: arquivo.name }, "Selo enviado e escolhido.");
    } catch (e) {
      toast.error("O arquivo não subiu", { description: textoDoErro(e) });
    } finally {
      setSubindo(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  };

  const adicionarReferencia = async (c: { caminho?: string; link?: string }) =>
    mudarReferencias({ campanhaId: campanha.id, adicionar: [c], pedido: pedido || undefined });

  const subirReferencia = async (arquivo: File | null | undefined, destino: "direcao" | "melhora") => {
    if (!arquivo) return;
    setSubindo(true);
    try {
      const c = await subirImagemDoSelo(clientId, campanha.id, arquivo, "referencia");
      if (destino === "melhora") {
        setRefsDeMelhora((l) => l.concat([c]).slice(0, 3));
      } else {
        const r = await adicionarReferencia({ caminho: c });
        if (r.avisos && r.avisos.length) toast.info(r.avisos[0]);
        reler();
      }
    } catch (e) {
      toast.error("A referência não entrou", { description: textoDoErro(e) });
    } finally {
      setSubindo(false);
      if (referenciaRef.current) referenciaRef.current.value = "";
      if (melhoraRef.current) melhoraRef.current.value = "";
    }
  };

  const trocarPapel = async (c: string, papel: PapelDaReferencia) => {
    try {
      await mudarReferencias({ campanhaId: campanha.id, papeis: [{ caminho: c, papel }] });
      reler();
    } catch (e) {
      toast.error("O papel não mudou", { description: textoDoErro(e) });
    }
  };

  const tirarReferencia = async (c: string) => {
    try {
      await mudarReferencias({ campanhaId: campanha.id, tirar: [c] });
      reler();
    } catch (e) {
      toast.error("A referência não saiu", { description: textoDoErro(e) });
    }
  };

  const gerar = async () => {
    setOpcoes([]);
    const chaveDoPedido = `selo:${campanha.id}`;
    marcarPedidoDaCampanha(chaveDoPedido, { mensagem: "selo", desde: Date.now() });
    try {
      const r = await gerarOpcoes(
        // Sem edição, o texto não vai: o servidor segue decidindo o texto do selo.
        { campanhaId: campanha.id, estilo, quantidade, tipo, modeloId, qualidade, texto: textoDigitado !== null ? textoDigitado : "", pedido },
        (o) => setOpcoes((l) => l.concat([o])),
      );
      reler();
      return { custo_usd: r.custo_usd, aviso_da_acao: r.falhas.length ? `${r.falhas.length} ${plural(r.falhas.length, "opção não saiu", "opções não saíram")}: ${r.falhas[0]}` : null };
    } finally {
      marcarPedidoDaCampanha(chaveDoPedido, null);
    }
  };

  const melhorar = async () => {
    if (!atual) throw new Error("Escolha um selo antes de melhorar.");
    const chaveDoPedido = `selo:${campanha.id}`;
    marcarPedidoDaCampanha(chaveDoPedido, { mensagem: "melhorar", desde: Date.now() });
    const r = await melhorarSelo({ campanhaId: campanha.id, seloId: atual.id, pedido: pedidoDeMelhora.trim(), referencias: refsDeMelhora, link: linkDeMelhora, modeloId, qualidade }).finally(() =>
      marcarPedidoDaCampanha(chaveDoPedido, null),
    );
    setComparar({ antes: r.anterior || atual, nova: r });
    setPedidoDeMelhora("");
    setLinkDeMelhora("");
    setRefsDeMelhora([]);
    reler();
    return r;
  };

  /** Arquivar e depois desfazer o arquivar, com o erro na tela (nada engolido). */
  const desarquivar = (seloId: string) =>
    arquivarSelo(campanha.id, seloId, true)
      .then(reler)
      .catch((e) => toast.error("A versão não voltou", { description: textoDoErro(e) }));

  /** Comparar: fica o selo de hoje e a versão nova é arquivada (com Desfazer). Se não arquivar, o Comparar continua. */
  const ficarComADeAntes = async () => {
    if (!comparar) return;
    const id = comparar.nova.versao.id;
    try {
      await arquivarSelo(campanha.id, id);
    } catch (e) {
      toast.error("A versão nova não foi arquivada", { description: textoDoErro(e) });
      return;
    }
    setComparar(null);
    reler();
    toast.success("Versão nova arquivada.", { action: { label: "Desfazer", onClick: () => void desarquivar(id) } });
  };

  const conferencia = atual ? atual.conferencia : null;
  const impacto = dados && dados.impacto && Array.isArray(dados.impacto.refazer) ? dados.impacto : null;
  const antigos = dados && Array.isArray(dados.antigos) ? dados.antigos : [];
  const nomeDaMarca = marca ? `da ${marca.nome}` : "da marca";

  return (
    <div className="min-w-0 space-y-4" data-selo="secao">
      {/* O selo de hoje, o estado dele e as ações de trocar. */}
      <div className="flex min-w-0 flex-col sm:flex-row">
        <div className="mb-3 shrink-0 sm:mb-0 sm:mr-4">
          {caminhoAtual ? (
            <button type="button" onClick={() => setAmpliar(caminhoAtual)} aria-label="Ver o selo grande" className="block cursor-zoom-in">
              <Miniatura caminho={caminhoAtual} alt={`Selo da campanha ${campanha.nome}`} tamanho="h-32 w-32" />
            </button>
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-md border border-dashed border-border p-2 text-center text-[12px] text-muted-foreground">
              Sem selo
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {lendoOSelo ? (
            <div className="min-w-0" aria-busy="true" aria-label="Lendo o selo" data-selo="lendo">
              <div className="h-5 w-48 max-w-full animate-pulse rounded bg-muted" />
              <div className="mt-2 flex min-w-0 flex-wrap items-center">
                <div className="mb-1 mr-1.5 h-8 w-36 animate-pulse rounded-md bg-muted" />
                <div className="mb-1 mr-1.5 h-8 w-28 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          ) : (
            <p className={texto.corpo} data-selo="atual">
              {atual
                ? [ROTULO_DA_ORIGEM[atual.origem] || atual.origem, rotuloDoEstilo(atual.estilo), atual.texto ? `"${atual.texto}"` : ""].filter(Boolean).join(" · ")
                : caminhoAtual
                  ? "Selo de antes das versões"
                  : "A campanha ainda não tem selo."}
            </p>
          )}
          {conferencia && conferencia.ok === true && <Linha tom="ok">Texto conferido.</Linha>}
          {conferencia && conferencia.aviso && <Linha tom="aviso">{conferencia.aviso}</Linha>}
          {aviso.map((a) => <Linha key={a} tom="aviso">{a}</Linha>)}
          {!lendoOSelo && (
            <div className="flex min-w-0 flex-wrap items-center">
              {atual && (
                <Button
                  type="button"
                  size="sm"
                  variant={painel === "melhorar" ? "secondary" : "outline"}
                  className="mb-1 mr-1.5 h-8"
                  onClick={() => setPainel((p) => (p === "melhorar" ? null : "melhorar"))}
                  aria-expanded={painel === "melhorar"}
                >
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Melhorar este selo
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={painel === "trocar" ? "secondary" : atual ? "ghost" : "default"}
                className="mb-1 mr-1.5 h-8"
                onClick={() => setPainel((p) => (p === "trocar" ? null : "trocar"))}
                aria-expanded={painel === "trocar"}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {caminhoAtual ? "Trocar o selo" : "Escolher o selo"}
              </Button>
              {ultimaTroca && (
                <Button type="button" size="sm" variant="ghost" className="mb-1 h-8" onClick={() => void desfazer()} disabled={trocando}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Desfazer
                </Button>
              )}
              {trocando && <Loader2 className="mb-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Trocando o selo" />}
            </div>
          )}
          {impacto && <ArtesDaCampanha impacto={impacto} onRefeito={reler} />}
        </div>
      </div>

      {estado.isError && (
        <div className="min-w-0 space-y-1.5">
          <AvisoDeErro erro={estado.error} />
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => void estado.refetch()} disabled={estado.isFetching}>
            {estado.isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />} Tentar de novo
          </Button>
        </div>
      )}

      {/* Melhorar: pedido em texto e referência (imagem ou link); a versão nova aparece ao lado da de hoje. */}
      {painel === "melhorar" && atual && (
        <div className="min-w-0 space-y-2 border-t border-border pt-3" data-selo="melhorar">
          <Textarea
            value={pedidoDeMelhora}
            onChange={(e) => setPedidoDeMelhora(e.target.value)}
            rows={2}
            aria-label="O que melhorar no selo"
            placeholder="Ex.: menos genérico, letra da marca, sem dourado"
            className="min-h-[56px] text-[13px]"
          />
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex min-w-0 items-center">
              <Link2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input value={linkDeMelhora} onChange={(e) => setLinkDeMelhora(e.target.value)} placeholder="Link de uma imagem de referência (opcional)" aria-label="Link da referência do Melhorar" className="h-8 text-[13px]" />
            </div>
            <div className="flex min-w-0 flex-wrap items-center">
              <input ref={melhoraRef} type="file" accept={TIPOS_DO_SELO_ENVIADO} className="hidden" data-testid="referencia-do-melhorar" onChange={(e) => void subirReferencia(e.target.files && e.target.files[0], "melhora")} />
              <Button type="button" size="sm" variant="ghost" className="mr-1 h-8" onClick={() => melhoraRef.current && melhoraRef.current.click()} disabled={subindo || refsDeMelhora.length >= 3}>
                <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> Referência
              </Button>
              {refsDeMelhora.map((c) => (
                <span key={c} className="mr-1 inline-flex items-center">
                  <Miniatura caminho={c} alt="Referência do Melhorar" tamanho="h-8 w-8" />
                  <button type="button" aria-label="Tirar a referência" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => setRefsDeMelhora((l) => l.filter((x) => x !== c))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center">
            <BotaoComCusto
              rotulo="Melhorar"
              titulo="Melhorar o selo"
              descricao="O gerador edita o selo de hoje com o pedido e a referência. A versão nova aparece ao lado; a de hoje continua até você escolher."
              partes={() => partesDoMelhorar(catalogo, modeloId, qualidade)}
              executar={melhorar}
              disabled={!pedidoDeMelhora.trim() || subindo || gerandoDesde !== null || !modeloId}
              className="mb-1 mr-1 h-8"
            />
            {/* Modelo e qualidade à vista onde se gasta (os mesmos do Gerar, lembrados por cliente). */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Modelo e qualidade do Melhorar"
                  title="Trocar o modelo e a qualidade (os mesmos do Gerar)"
                  className={juntar("mb-1 inline-flex h-8 min-w-0 max-w-full items-center rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", foco)}
                  data-selo="modelo-do-melhorar"
                >
                  <span className="min-w-0 truncate">
                    {nomeDoModeloDoSelo} · {rotuloDaQualidade(qualidade)}
                  </span>
                  <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={6} className="w-[calc(100vw-24px)] max-w-[300px] space-y-3 p-3">
                <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modeloId} onChange={(id) => mudarAjustes({ modelo: id })} rotulo="Modelo de imagem" qualidade={qualidade} />
                <SeletorDeQualidade valor={qualidade} onChange={(q) => mudarAjustes({ qualidade: q })} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {comparar && (
        <div className="min-w-0 border-t border-border pt-3" data-selo="comparar">
          <div className="flex min-w-0 flex-wrap items-start">
            <div className="mb-2 mr-4">
              <p className={texto.rotulo}>Antes</p>
              <div className="mt-1"><Miniatura caminho={comparar.antes.caminho} alt="Selo de antes" tamanho="h-28 w-28" /></div>
            </div>
            <div className="mb-2 mr-4">
              <p className={texto.rotulo}>Nova</p>
              <div className="mt-1"><Miniatura caminho={comparar.nova.versao.caminho} alt="Selo novo" tamanho="h-28 w-28" marcada /></div>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {comparar.nova.avisos.map((a) => <Linha key={a} tom="aviso">{a}</Linha>)}
              <div className="flex flex-wrap items-center">
                <Button
                  type="button"
                  size="sm"
                  className="mb-1 mr-1.5 h-8"
                  disabled={trocando}
                  onClick={async () => {
                    const r = await escolher(comparar.nova.versao.id, "Versão nova escolhida.");
                    if (r) setComparar(null);
                  }}
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" /> Escolher a nova
                </Button>
                <Button type="button" size="sm" variant="ghost" className="mb-1 h-8" onClick={() => void ficarComADeAntes()} disabled={trocando}>
                  <X className="mr-1.5 h-3.5 w-3.5" /> Ficar com a de antes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Os 2 caminhos para escolher o selo: gerar ou usar um pronto. */}
      {painel === "trocar" && (
        <div className="min-w-0 space-y-3 border-t border-border pt-3" data-selo="caminhos">
          <div className="flex min-w-0 flex-wrap items-center">
            <SeletorCompacto opcoes={CAMINHOS} valor={caminho} onEscolher={(v) => setCaminho(v as Caminho)} rotulo="Como escolher o selo" listaQuandoNaoCabe />
            <AjudaRecolhida className="ml-1.5" rotulo="Como o selo entra nas artes">
              O selo escolhido vai para o gerador junto com a arte, na capa e no fechamento, e entra integrado à composição: grande, em destaque e fiel ao desenho (mesmas letras, forma e cores). Nada é colado por cima. As artes que ainda vão ser geradas já saem com ele.
            </AjudaRecolhida>
            {/* Só no pronto: no Gerar o fundo não muda nada. */}
            {caminho === "pronto" && (
              <label className="ml-3 inline-flex items-center text-[12px] text-muted-foreground">
                <input type="checkbox" className="mr-1.5" checked={tirarFundo} onChange={(e) => setTirarFundo(e.target.checked)} /> Tirar o fundo liso
              </label>
            )}
          </div>

          {caminho === "gerar" && (
            <div className="min-w-0 space-y-3" data-selo="gerar">
              {/* O caminho mais comum primeiro: gerar com os ajustes de costume; ajustar é um clique na linha-resumo. */}
              <div className="flex min-w-0 flex-wrap items-center">
                <BotaoComCusto
                  rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />{quantidade === 1 ? "Gerar 1 opção" : `Gerar ${quantidade} opções`}</>}
                  titulo="Opções de selo"
                  descricao="O gerador desenha as opções com a campanha, a marca, o estilo, as referências e o que o dono já ensinou. Você escolhe uma; nada é aplicado sozinho."
                  partes={() => partesDaGeracao(catalogo, modeloId, qualidade, quantidade)}
                  executar={gerar}
                  disabled={gerandoDesde !== null || !modeloId}
                  className="mb-1 mr-2 h-8"
                />
                <button
                  type="button"
                  onClick={() => setAjustesAbertos(gradeAberta ? "recolhido" : "aberto")}
                  aria-expanded={gradeAberta}
                  title={gradeAberta ? "Recolher os ajustes" : "Ajustar estilo, opções, modelo, qualidade e texto"}
                  className={juntar("mb-1 mr-1 flex min-w-0 max-w-full items-center rounded-md px-1 py-0.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", foco)}
                  data-selo="resumo-do-gerar"
                >
                  <ChevronDown className={juntar("mr-1 h-4 w-4 shrink-0 transition-transform", gradeAberta ? "" : "-rotate-90")} aria-hidden="true" />
                  <span className="min-w-0 truncate">{resumoDoGerar}</span>
                </button>
                <AjudaRecolhida className="mb-1 ml-1" rotulo="O que vai na direção do selo">
                  A direção junta o tipo, o objetivo, o conceito, o período, o público e o tom da campanha, a paleta e a fonte de título da marca da campanha, o estilo escolhido, as referências pelo papel e o que o dono já pediu para evitar. Cada opção sai num estilo ou composição diferente. O texto é lido depois e, se o gerador errar, aparece o aviso.
                </AjudaRecolhida>
              </div>
              {gerandoDesde !== null && <Cronometro desde={gerandoDesde} rotulo="Desenhando as opções" previsao="~40s" />}
              {dados && (dados.avisos_do_texto || []).map((a) => <Linha key={a} tom="aviso">{a}</Linha>)}

              {gradeAberta && (
                <div className="min-w-0 space-y-3" data-selo="ajustes">
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Campo rotulo="Estilo">
                      <Select value={estilo} onValueChange={(v) => mudarAjustes({ estilo: v as EscolhaDeEstilo })}>
                        <SelectTrigger className="h-9 min-w-0 text-[13px]" aria-label="Estilo do selo"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ESTILO_AUTOMATICO}>Automático (estilos diferentes)</SelectItem>
                          {ESTILOS_DE_SELO.map((e) => <SelectItem key={e} value={e}>{DEFINICAO_DO_ESTILO[e].rotulo}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Campo>
                    <Campo rotulo="Opções">
                      <Select value={String(quantidade)} onValueChange={(v) => mudarAjustes({ quantidade: Number(v) })}>
                        <SelectTrigger className="h-9 min-w-0 text-[13px]" aria-label="Quantas opções"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "opção" : "opções"}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Campo>
                    <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modeloId} onChange={(id) => mudarAjustes({ modelo: id })} rotulo="Modelo de imagem" qualidade={qualidade} />
                    <SeletorDeQualidade valor={qualidade} onChange={(q) => mudarAjustes({ qualidade: q })} />
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                    <Campo rotulo="Texto do selo">
                      <Input
                        value={textoDigitado !== null ? textoDigitado : textoDoServidor || ""}
                        onChange={(e) => setTextoDigitado(e.target.value.slice(0, 60))}
                        placeholder={textoDoServidor || campanha.nome}
                        aria-label="Texto do selo"
                        className="h-9 text-[13px]"
                      />
                    </Campo>
                    <Campo rotulo="Algo a mais (opcional)">
                      <Input value={pedido} onChange={(e) => setPedido(e.target.value.slice(0, 400))} placeholder="Ex.: com um coração no lugar do o" aria-label="Pedido extra para o selo" className="h-9 text-[13px]" />
                    </Campo>
                  </div>
                </div>
              )}

              {/* Referências do selo, com o papel que o Jev decidiu (dá para trocar). */}
              <div className="min-w-0 space-y-2" data-selo="referencias">
                <div className="flex min-w-0 flex-wrap items-center">
                  <span className={texto.rotulo}>Referências ({referencias.length} de {MAX_REFERENCIAS_DO_SELO})</span>
                  <AjudaRecolhida className="ml-1" rotulo="Como as referências entram">
                    Cada referência ganha um papel: estilo, forma, cor ou só inspiração. O Jev decide pela sua nota e pelo que se vê na imagem; troque se quiser. A direção do selo segue o papel e nunca copia o texto nem a marca da referência.
                  </AjudaRecolhida>
                </div>
                <div className="flex min-w-0 flex-wrap items-start">
                  {referencias.map((r) => (
                    <div key={r.caminho} className="mb-2 mr-3 w-24 min-w-0" data-papel={r.papel}>
                      <Miniatura caminho={r.caminho} alt="Referência do selo" tamanho="h-16 w-16" />
                      <Select value={r.papel} onValueChange={(v) => void trocarPapel(r.caminho, v as PapelDaReferencia)}>
                        <SelectTrigger className="mt-1 h-7 min-w-0 px-2 text-[11px]" aria-label="Papel da referência"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAPEIS_DA_REFERENCIA.map((p) => <SelectItem key={p} value={p}>{ROTULO_DO_PAPEL_DA_REFERENCIA[p]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <button type="button" className="mt-0.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void tirarReferencia(r.caminho)}>
                        Tirar
                      </button>
                    </div>
                  ))}
                </div>
                {referencias.length < MAX_REFERENCIAS_DO_SELO && (
                  <div className="flex min-w-0 flex-wrap items-center">
                    <input ref={referenciaRef} type="file" accept={TIPOS_DO_SELO_ENVIADO} className="hidden" data-testid="referencia-do-selo" onChange={(e) => void subirReferencia(e.target.files && e.target.files[0], "direcao")} />
                    <Button type="button" size="sm" variant="ghost" className="mb-1 mr-1 h-8" disabled={subindo} onClick={() => referenciaRef.current && referenciaRef.current.click()}>
                      <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> Enviar referência
                    </Button>
                    <span className="mb-1 mr-2">
                      <EstimativaInline partes={partesDasReferencias(catalogo, 1)} />
                    </span>
                    <Input value={linkDeReferencia} onChange={(e) => setLinkDeReferencia(e.target.value)} placeholder="ou cole o link de uma imagem" aria-label="Link da referência do selo" className="mb-1 mr-1.5 h-8 w-56 min-w-0 text-[13px]" />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mb-1 h-8"
                      disabled={!linkDeReferencia.trim() || subindo}
                      onClick={async () => {
                        setSubindo(true);
                        try {
                          const r = await adicionarReferencia({ link: linkDeReferencia.trim() });
                          if (r.avisos && r.avisos.length) toast.info(r.avisos[0]);
                          setLinkDeReferencia("");
                          reler();
                        } catch (e) {
                          toast.error("A referência não entrou", { description: textoDoErro(e) });
                        } finally {
                          setSubindo(false);
                        }
                      }}
                    >
                      Adicionar
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {caminho === "pronto" && (
            <div className="min-w-0 space-y-3" data-selo="pronto">
              {/* Logo e envio primeiro: um clique cada, sem custo. */}
              <ul className="flex min-w-0 flex-wrap" aria-label="Logo ou arquivo">
                <li className="mb-2 mr-2">
                  <button
                    type="button"
                    className={QUADRINHO}
                    disabled={trocando}
                    onClick={() => void usarPronto({ origem: "logo" }, "A logo virou o selo da campanha.")}
                    aria-label={`Usar a logo ${nomeDaMarca} como selo`}
                    title={`Usar a logo ${nomeDaMarca} como selo`}
                  >
                    <BadgeCheck className="mb-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="max-w-full truncate">Logo {nomeDaMarca}</span>
                  </button>
                </li>
                <li className="mb-2 mr-2">
                  <input ref={arquivoRef} type="file" accept={TIPOS_DO_SELO_ENVIADO} className="hidden" data-testid="selo-enviado" onChange={(e) => void enviar(e.target.files && e.target.files[0])} />
                  <button
                    type="button"
                    className={QUADRINHO}
                    disabled={subindo || trocando}
                    onClick={() => arquivoRef.current && arquivoRef.current.click()}
                    aria-label="Enviar um arquivo como selo (PNG, SVG, JPG ou WebP)"
                    title="Enviar um arquivo como selo: PNG, SVG, JPG ou WebP"
                  >
                    {subindo ? (
                      <Loader2 className="mb-1 h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <Upload className="mb-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span>Enviar arquivo</span>
                    <span className="text-[11px] text-muted-foreground">PNG, SVG, JPG, WebP</span>
                  </button>
                </li>
              </ul>
              {antigos.length > 0 && (
                <div className="min-w-0">
                  <p className={texto.rotulo}>Selos de outras campanhas</p>
                  <ul className="mt-1.5 flex min-w-0 flex-wrap" aria-label="Selos de outras campanhas">
                    {antigos.map((s) => (
                      <li key={s.id} className="mb-2 mr-2">
                        <button type="button" disabled={trocando} onClick={() => void usarPronto({ origem: "arquivo", selo_id: s.id }, "Selo antigo escolhido.")} aria-label={`Usar o selo ${s.texto || "antigo"}`}>
                          <Miniatura caminho={s.caminho} alt={s.texto || "Selo antigo"} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <SeletorDoAcervo titulo="Acervo do cliente (logos, selos, imagens)" onEscolher={(img) => void usarPronto({ origem: "acervo", imagem_id: img.id }, "Imagem do acervo escolhida como selo.")} />
            </div>
          )}
        </div>
      )}

      {/* Opções do último Gerar: escolher uma (sem laço: o aviso do texto é só aviso). */}
      {opcoes.length > 0 && (
        <div className="min-w-0 border-t border-border pt-3" data-selo="opcoes">
          <p className={texto.rotulo}>Opções geradas</p>
          <ul className="mt-2 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Opções de selo">
            {opcoes.map((o) => (
              <li key={o.versao.id} className="min-w-0">
                <button type="button" className="block w-full cursor-zoom-in" onClick={() => setAmpliar(o.versao.caminho)} aria-label="Ver a opção grande">
                  <span className="relative block w-full overflow-hidden rounded-md border border-border bg-background" style={{ paddingBottom: "100%" }}>
                    <ImagemDaMesa caminho={o.versao.caminho} alt={`Opção ${rotuloDoEstilo(o.versao.estilo)}`} className="absolute inset-0 h-full w-full !object-contain p-2" />
                  </span>
                </button>
                <p className="mt-1 truncate text-[12px] text-muted-foreground">{rotuloDoEstilo(o.versao.estilo) || "Opção"} · {usd(Number(o.custo_usd) || 0)}</p>
                {o.conferencia && o.conferencia.ok === false && <Linha tom="aviso">Texto errado: {o.conferencia.lido ? `"${o.conferencia.lido}"` : "confira"}</Linha>}
                <Button
                  type="button"
                  size="sm"
                  variant={o.versao.id === (atual && atual.id) ? "secondary" : "outline"}
                  className="mt-1 h-7 w-full"
                  disabled={trocando || o.versao.id === (atual && atual.id)}
                  onClick={() => void escolher(o.versao.id, "Selo escolhido.", { fecharCaminhos: true })}
                >
                  {o.versao.id === (atual && atual.id) ? "Escolhido" : "Escolher"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Histórico: toda versão fica guardada; usar uma antiga é voltar. */}
      {versoes.length > 1 && (
        <div className="min-w-0 border-t border-border pt-3" data-selo="historico">
          <p className={texto.rotulo}>Versões ({versoes.length})</p>
          <ul className="mt-2 flex min-w-0 flex-wrap" aria-label="Versões do selo">
            {versoes.map((v) => {
              const eAtual = !!atual && v.id === atual.id;
              return (
                <li key={v.id} className="mb-2 mr-3 w-20 min-w-0">
                  <button type="button" onClick={() => setAmpliar(v.caminho)} className="block cursor-zoom-in" aria-label="Ver a versão grande">
                    <Miniatura caminho={v.caminho} alt={`Versão ${ROTULO_DA_ORIGEM[v.origem] || v.origem}`} marcada={eAtual} />
                  </button>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{ROTULO_DA_ORIGEM[v.origem] || v.origem}</p>
                  {eAtual ? (
                    <span className="text-[11px] text-primary">Em uso</span>
                  ) : (
                    <span className="inline-flex items-center">
                      <button type="button" className="mr-2 text-[11px] text-primary hover:underline" disabled={trocando} onClick={() => void escolher(v.id, "Versão escolhida.")}>
                        Usar
                      </button>
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={async () => {
                          try {
                            await arquivarSelo(campanha.id, v.id);
                            reler();
                            toast.success("Versão arquivada.", { action: { label: "Desfazer", onClick: () => void desarquivar(v.id) } });
                          } catch (e) {
                            toast.error("Não arquivou", { description: textoDoErro(e) });
                          }
                        }}
                      >
                        Arquivar
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ampliar && <Ampliar imagens={[{ caminho: ampliar, titulo: `Selo: ${campanha.nome}` }]} indice={0} onFechar={() => setAmpliar(null)} />}
    </div>
  );
}
