import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Archive, CalendarPlus, FileText, ImagePlus, ListChecks, Loader2, Paperclip, Plus, Sparkles, Wand2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/shared/confirmDialog";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import CaminhoPronto from "@/components/agentes/CaminhoPronto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { chamarFuncao, confirmarPublicacao, dataCurta, lerMelhoresHorarios, padraoPara, TAMANHOS, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { repetirEntregaEmPartes } from "@/lib/mesa/entregaEmPartes";
import { useCampanhaEmUso } from "@/lib/mesa/campanhaAtiva";
import { campanhaDaMarcaNaTela } from "@/lib/mesa/marcas";
import { EDITORIAL_DEFAULT_TIME_ZONE } from "@/lib/editorialDate";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "./MesaContexto";
import { useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import { Ditado } from "./Ditado";
import { SeloDoItem } from "./EstudioLista";
import { lerArquivosDoAgente } from "./leituraDeArquivos";
import { chaves, lerCampanhas, periodoCurto, useMidia, type Campanha } from "./mesaV4Api";
import { SeletorDeFormatoCompacto } from "./EstudioControles";
import { botao, juntar, superficie } from "@/components/sistema/estilos";
import { enviarUmParaAprovacao, FORMATOS_DO_POST, type FormatoDoPost } from "./estudioUtil";
import { JanelaDaAprovada, type AprovadaSemData } from "./AprovadasSemData";
import { corpoDaConclusao, corpoDoEntregar, opcoesDaEntrega, type ModoDeEntrega, type RespostaDaConclusao } from "@/lib/mesa/entregaComOpcoes";
import { ultimasVersoes, type ItemDoMes, type Trabalho } from "./useItensDoMes";
import {
  arquivarArteRapida,
  artesDoHistorico,
  arteDoTrabalho,
  arteRapidaDaMarca,
  chavesDaArteRapida,
  gerarNaFila,
  gravarArteRapidaNoCache,
  itemDaArteRapida,
  lerArteRapida,
  lerArtesRapidas,
  lerFotosDoAcervo,
  levarArteRapidaParaAgenda,
  miniaturaDaArteRapida,
  prepararArteRapida,
  situacaoDaArteRapida,
} from "./arteRapidaApi";
import {
  corpoDaArteRapida,
  DICA_DO_PAPEL,
  linkDoItemNoEstudio,
  MAX_DOCUMENTOS_DA_ARTE_RAPIDA,
  MAX_IMAGENS_DA_ARTE_RAPIDA,
  NOVA_ARTE_RAPIDA,
  PAPEIS_DO_ARQUIVO,
  papelPeloNome,
  pedidoProntoParaIr,
  ROTULO_DA_PECA,
  ROTULO_DO_PAPEL,
  type ArquivoPedido,
  type DocumentoDaArteRapida,
  type PapelPedido,
  type PecaPedida,
} from "../../../supabase/functions/estudio-arte/modulos/arte-rapida";
import { horarioSugerido, localParaIso, partesNoFuso, problemaNoHorario } from "../../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import { rotuloDoTipo, tipoDaCampanha } from "../../../supabase/functions/_shared/tipos-de-campanha";
import { AJUDA_DO_USO } from "../../../supabase/functions/estudio-arte/modulos/uso-da-foto";

/**
 * Arte rápida (frente AE, 28/09): a arte avulsa, fora do plano do mês, no
 * mesmo Estúdio. Pedido do dono: "melhore esta arte que o cliente mandou";
 * "subir a foto de uma pessoa ou de um evento e criar a arte ou o carrossel";
 * "faça uma promoção do mouse com estas informações"; "ponha estas logos
 * nesta imagem". Fácil e rápido, porque ele já entende o contexto geral.
 *
 * Na tela: o pedido (texto, microfone, fotos do celular, PDFs), a campanha
 * (a em uso nas mesas já vem marcada; "Automático" deixa o Jev achar a
 * campanha que o pedido cita), a peça (Automático, arte única ou carrossel)
 * e um botão. O mesmo diretor de arte escreve a direção com a marca; a arte
 * única já entra na fila de geração. Depois a peça abre no Estúdio de sempre
 * (lâminas, conferência, ajustes, diretor, legenda) e a ferramenta Entrega
 * vira "Levar para a Agenda": pergunta a data, confirma e manda pelo fluxo da
 * Agenda (entrega em Arquivos, data confirmada, aprovação do cliente).
 *
 * À esquerda (computador), o histórico com rolagem própria para voltar e
 * continuar ajustando; no celular, o histórico recolhe em cima.
 */

export interface ModoRapidoDoDetalhe {
  subtitulo: ReactNode;
  entrega: ReactNode;
}

// ------------------------------------------------------------------ campanha

function SeloDaCampanha({ campanha, tamanho = "h-6 w-6" }: { campanha: Campanha; tamanho?: string }) {
  const paleta = (campanha.identidade && campanha.identidade.paleta_apoio) || [];
  const cor = paleta.length && paleta[0].hex ? String(paleta[0].hex) : undefined;
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background ${tamanho}`}>
      {campanha.selo_path ? (
        <ImagemDaMesa caminho={campanha.selo_path} alt="" className="h-full w-full !object-contain" />
      ) : (
        <span className="text-[11px] font-semibold" style={cor ? { color: cor } : undefined}>{(campanha.nome || "C").charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

/** A base da campanha em uma linha: tipo, oferta e produto (o que o Estúdio vai puxar). */
export function resumoDaBaseDaCampanha(c: Campanha): string {
  const tipo = rotuloDoTipo(tipoDaCampanha(c.identidade));
  const b = (c.briefing || {}) as { oferta?: string; produtos?: { nome?: string }[] };
  const produtos = Array.isArray(b.produtos) ? b.produtos.map((p) => (p && p.nome) || "").filter(Boolean).slice(0, 2).join(", ") : "";
  return [tipo, b.oferta ? `oferta: ${b.oferta}` : "", produtos ? `produto: ${produtos}` : "", c.selo_path ? "com selo" : ""]
    .filter(Boolean)
    .join(" · ");
}

function EscolhaDaCampanha({
  campanhas,
  valor,
  onValor,
  carregando,
  emUso,
}: {
  campanhas: Campanha[];
  valor: string | "auto" | null;
  onValor: (v: string | "auto" | null) => void;
  carregando: boolean;
  emUso: string | null;
}) {
  const ativas = campanhas.filter((c) => c.status !== "encerrada" || c.id === valor);
  const escolhida = valor && valor !== "auto" ? ativas.filter((c) => c.id === valor)[0] || null : null;
  const pilula = (ativa: boolean) =>
    `mb-1.5 mr-1.5 inline-flex h-9 max-w-full shrink-0 items-center rounded-full border px-3 text-[12.5px] transition-colors ${
      ativa ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary/50"
    }`;
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Campanha</p>
      <div role="radiogroup" aria-label="Campanha da arte" className="flex min-w-0 flex-wrap" data-campanha-da-arte-rapida={valor || "nenhuma"}>
        <button type="button" role="radio" aria-checked={valor === null} className={pilula(valor === null)} onClick={() => onValor(null)}>
          Só a marca
        </button>
        {ativas.length > 0 && (
          <button
            type="button"
            role="radio"
            aria-checked={valor === "auto"}
            className={pilula(valor === "auto")}
            onClick={() => onValor("auto")}
            title="O agente reconhece a campanha quando o pedido cita (nome, produto ou oferta)"
          >
            <Sparkles className="mr-1 h-3.5 w-3.5 shrink-0" /> Automático
          </button>
        )}
        {ativas.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={valor === c.id} className={pilula(valor === c.id)} onClick={() => onValor(c.id)} title={resumoDaBaseDaCampanha(c) || c.nome}>
            <SeloDaCampanha campanha={c} tamanho="mr-1.5 h-5 w-5" />
            <span className="truncate">{c.nome}</span>
            {emUso === c.id && <span className={`ml-1.5 shrink-0 text-[10.5px] ${valor === c.id ? "opacity-90" : "text-primary"}`}>em uso</span>}
          </button>
        ))}
        {carregando && <span className="mb-1.5 inline-flex h-9 items-center text-[12px] text-muted-foreground"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> campanhas</span>}
      </div>
      {escolhida ? (
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-base-da-campanha={escolhida.id}>
          A arte puxa a base inteira: {resumoDaBaseDaCampanha(escolhida) || "tema e identidade"}. {periodoCurto(escolhida.periodo_inicio, escolhida.periodo_fim)}.
        </p>
      ) : valor === "auto" ? (
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">O agente procura a campanha que o pedido cita; sem certeza, segue só a marca e avisa.</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ pedido

const PLACEHOLDER = "Ex.: promoção do mouse gamer, R$ 149 no Pix até sexta. Ou: arte do palestrante com esta foto. Ou: ponha estas logos nesta imagem.";

interface FotoDoAcervoNoPedido {
  id: string;
  nome: string;
  bucket: string;
  caminho: string;
  papel: PapelPedido;
}

function SeletorDoPapel({ valor, onValor, rotulo }: { valor: PapelPedido; onValor: (v: PapelPedido) => void; rotulo: string }) {
  return (
    <select
      value={valor}
      onChange={(e) => onValor(e.target.value as PapelPedido)}
      aria-label={`Papel de ${rotulo}`}
      title={valor === "auto" ? "O agente decide pelo pedido" : DICA_DO_PAPEL[valor]}
      className="mt-1 h-8 w-full min-w-0 rounded-md border border-border bg-background px-1.5 text-[11.5px]"
    >
      <option value="auto">Automático</option>
      {PAPEIS_DO_ARQUIVO.map((p) => (
        <option key={p} value={p}>{ROTULO_DO_PAPEL[p]}</option>
      ))}
    </select>
  );
}

function PedidoDaArteRapida({
  onCriada,
  fotosDaUrl,
  campanhaDaUrl,
  colunas,
  largo,
}: {
  onCriada: (t: Trabalho) => void;
  fotosDaUrl: string[];
  campanhaDaUrl: string | null;
  /** Computador: formulário com rolagem própria e o botão fixo embaixo. */
  colunas: boolean;
  /** Tela larga: a prévia "Como vai sair" ao lado. */
  largo: boolean;
}) {
  const { clientId, catalogo } = useMesa();
  const { marca } = useMarcaDaMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  const [emUso, setEmUso] = useCampanhaEmUso(clientId);
  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), queryFn: () => lerCampanhas(clientId) });
  // Frente AE: só as campanhas da marca aberta (Acerbi ou CME).
  const lista = (campanhas.data || []).filter((c) => campanhaDaMarcaNaTela(c.identidade, marca));
  const [pedido, setPedido] = useState("");
  const [peca, setPeca] = useState<PecaPedida>("auto");
  const [laminas, setLaminas] = useState("auto");
  const [formato, setFormato] = useState<FormatoDoPost>("feed_4x5");
  const [gerarLogo, setGerarLogo] = useState(true);
  const [papeis, setPapeis] = useState<Record<string, PapelPedido>>({});
  const [documentos, setDocumentos] = useState<DocumentoDaArteRapida[]>([]);
  const [lendo, setLendo] = useState(false);
  const [maisRecolhido, setMaisRecolhido] = useRecolhido("mesa:arte-rapida:mais", true);
  const entrada = useRef<HTMLInputElement>(null);
  // A campanha: a do endereço (veio da Mesa Foto ou das Campanhas), senão a em uso nas mesas, senão automático.
  const [campanha, setCampanha] = useState<string | "auto" | null>(() => {
    const daMarca = (id: string | null) => !!id && (campanhas.data || []).some((c) => c.id === id && campanhaDaMarcaNaTela(c.identidade, marca));
    if (campanhaDaUrl && (!campanhas.data || daMarca(campanhaDaUrl))) return campanhaDaUrl;
    if (emUso && (!campanhas.data || daMarca(emUso))) return emUso;
    return "auto";
  });
  // A campanha escolhida que não é desta marca (chegou do endereço ou de outra aba) volta para "Automático".
  useEffect(() => {
    if (campanha && campanha !== "auto" && campanhas.isSuccess && !lista.some((c) => c.id === campanha)) setCampanha("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanhas.isSuccess, lista.length, campanha]);
  const [fotosDoAcervo, setFotosDoAcervo] = useState<FotoDoAcervoNoPedido[]>([]);

  const fotosUrl = useQuery({
    queryKey: chavesDaArteRapida.fotos(clientId, fotosDaUrl),
    enabled: fotosDaUrl.length > 0,
    queryFn: () => lerFotosDoAcervo(clientId, fotosDaUrl),
  });
  useEffect(() => {
    if (!fotosUrl.data) return;
    setFotosDoAcervo(fotosUrl.data.map((f) => ({ id: f.id, nome: f.nome || "foto", bucket: f.storage_bucket || "mesa", caminho: f.storage_path, papel: "foto" as PapelPedido })));
  }, [fotosUrl.data]);

  // Sem nenhuma campanha no cliente, "Automático" vira "Só a marca".
  useEffect(() => {
    if (campanhas.isSuccess && !lista.some((c) => c.status !== "encerrada") && campanha === "auto") setCampanha(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanhas.isSuccess, lista.length]);

  const escolherCampanha = (v: string | "auto" | null) => {
    setCampanha(v);
    // Escolher uma campanha aqui também a põe em uso nas mesas (Mesa Foto, Estúdio, Mesa Ads).
    if (v && v !== "auto") setEmUso(v);
  };

  const imagensProntas = anexos.lista.filter((a) => a.estado === "pronto" && a.caminho);
  const totalDeImagens = anexos.lista.length + fotosDoAcervo.length;
  const cheio = totalDeImagens >= MAX_IMAGENS_DA_ARTE_RAPIDA;

  const adicionarArquivos = async (arquivos: File[]) => {
    if (!arquivos.length) return;
    const imagens = arquivos.filter((f) => /^image\//.test(f.type || "") || /\.(jpe?g|png|webp)$/i.test(f.name || ""));
    const outros = arquivos.filter((f) => imagens.indexOf(f) < 0);
    const vagas = MAX_IMAGENS_DA_ARTE_RAPIDA - totalDeImagens;
    if (imagens.length > vagas) toast.warning(`Até ${MAX_IMAGENS_DA_ARTE_RAPIDA} imagens por pedido.`);
    if (imagens.length && vagas > 0) anexos.adicionar(imagens.slice(0, vagas));
    if (!outros.length) return;
    setLendo(true);
    try {
      const usados = documentos.reduce((s, d) => s + d.texto.length, 0);
      const r = await lerArquivosDoAgente(outros, usados);
      const novos = r.lidos.map((l) => ({ nome: l.nome, texto: l.texto }));
      setDocumentos((d) => d.concat(novos).slice(0, MAX_DOCUMENTOS_DA_ARTE_RAPIDA));
      if (r.imagens.length) anexos.adicionar(r.imagens.slice(0, Math.max(0, vagas - imagens.length)));
      if (r.naoLidos.length) toast.warning("Alguns arquivos não foram lidos", { description: r.naoLidos.map((n) => `${n.nome}: ${n.motivo}`).join("; ").slice(0, 300) });
    } catch (e) {
      toast.error("Não deu para ler o arquivo", { description: textoDoErro(e) });
    } finally {
      setLendo(false);
    }
  };

  const papelDe = (id: string, nome: string): PapelPedido => (Object.prototype.hasOwnProperty.call(papeis, id) ? papeis[id] : papelPeloNome(nome) || "auto");
  const arquivos: ArquivoPedido[] = fotosDoAcervo
    .map((f) => ({ imagem_id: f.id, nome: f.nome, papel: f.papel }) as ArquivoPedido)
    .concat(imagensProntas.map((a) => ({ caminho: a.caminho as string, nome: a.nome, papel: papelDe(a.id, a.nome) })));

  const diretor = padraoPara(catalogo, "diretor_arte");
  const leitor = padraoPara(catalogo, "leitura");
  const imagem = padraoPara(catalogo, "imagem");
  const vistas = Math.min(4, arquivos.filter((a) => a.papel !== "logo").length);
  const geraJunto = gerarLogo && peca !== "carrossel";
  const partes = (): ParteDaEstimativa[] => {
    const p: ParteDaEstimativa[] = [
      { modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada + vistas * TAMANHOS.imagemAnexos.entrada, tokensSaida: TAMANHOS.preparar.saida },
    ];
    if (geraJunto && imagem) {
      p.push({ modeloId: imagem.id, tipo: "imagem", imagens: 1, qualidade: "media", tokensEntrada: TAMANHOS.imagemAnexos.entrada });
      p.push({ modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida });
    }
    return p;
  };

  const pronto = pedidoProntoParaIr(pedido, arquivos.length, documentos.length) && !anexos.subindo && !lendo;

  const criar = async () => {
    const r = await prepararArteRapida(
      corpoDaArteRapida({
        clientId,
        pedido,
        peca,
        campanha,
        arquivos,
        documentos,
        formato,
        laminas: peca === "carrossel" && laminas !== "auto" ? Number(laminas) : null,
        marcaId: marca ? marca.id : null,
        modeloImagemId: imagem ? imagem.id : null,
        qualidade: "media",
      }),
    );
    const t = r && r.trabalho ? (r.trabalho as Trabalho) : null;
    // A arte única já entra na fila de geração (o preço dela estava no botão); o carrossel espera o "Gerar".
    if (t && gerarLogo && Array.isArray(t.direcao && t.direcao.cards) && t.direcao.cards.length === 1) {
      try {
        await gerarNaFila(t.id, [1], marca ? marca.id : null);
      } catch (e) {
        toast.info("A direção está pronta", { description: `Clique em Gerar no Estúdio. ${textoDoErro(e)}`.slice(0, 240) });
      }
    }
    return r;
  };

  const concluir = (r: any) => {
    const t = r && r.trabalho ? (r.trabalho as Trabalho) : null;
    const avisos: string[] = r && Array.isArray(r.avisos) ? r.avisos : [];
    if (avisos.length) toast.info("Sobre o pedido", { description: avisos.join(" ").slice(0, 400), duration: 10000 });
    if (!t) return;
    gravarArteRapidaNoCache(queryClient, clientId, t);
    void queryClient.invalidateQueries({ queryKey: chavesDaArteRapida.todas(clientId) });
    anexos.limpar();
    setDocumentos([]);
    setPedido("");
    setPapeis({});
    onCriada(t);
  };

  const rotuloDoFormato = formato === "feed_4x5" ? "4:5" : formato === "quadrado_1x1" ? "1:1" : formato === "retrato_3x4" ? "3:4" : "9:16";
  const escolhida = campanha && campanha !== "auto" ? lista.filter((c) => c.id === campanha)[0] || null : null;
  const primeiraImagem: { src?: string; caminho?: string; bucket?: string } | null = fotosDoAcervo.length
    ? { caminho: fotosDoAcervo[0].caminho, bucket: fotosDoAcervo[0].bucket }
    : anexos.lista.length
      ? anexos.lista[0].previa
        ? { src: anexos.lista[0].previa as string }
        : { caminho: anexos.lista[0].caminho || undefined }
      : null;

  // Frente AE-2 (dono, 28/09: "apertado, sem contraste, mal alinhado"): blocos com o mesmo respiro,
  // controles do sistema com contraste, o segmentado com o ativo bem visível e o botão sempre à vista.
  const corpo = (
    <div className="min-w-0 space-y-5">
      <EscolhaDaCampanha campanhas={lista} valor={campanha} onValor={escolherCampanha} carregando={campanhas.isLoading} emUso={emUso} />

      {/* O campo grande: texto, microfone, fotos e arquivos. */}
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center">
          <label htmlFor="pedido-da-arte-rapida" className="block text-[12px] font-medium text-muted-foreground">
            O que você precisa?
          </label>
          {(fotosDoAcervo.length > 0 || anexos.lista.length > 0) && (
            <AjudaRecolhida className="ml-1.5" rotulo="Foto exata ou Rosto (identidade)" titulo="Foto ou só o rosto">
              {AJUDA_DO_USO} Em Automático, o agente decide pelo pedido: "coloca essa foto" entra exata; "faz uma arte com ele falando sobre..." usa o rosto. Dá para trocar depois na base da lâmina.
            </AjudaRecolhida>
          )}
        </div>
        <div className="rounded-xl border border-border bg-background focus-within:border-primary/60">
          <Textarea
            id="pedido-da-arte-rapida"
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            rows={4}
            placeholder={PLACEHOLDER}
            className="min-h-[112px] resize-y border-0 bg-transparent px-3 py-2.5 text-[14px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {(fotosDoAcervo.length > 0 || anexos.lista.length > 0) && (
            <ul className="grid grid-cols-3 gap-2 px-3 pb-2 sm:grid-cols-4 xl:grid-cols-6" aria-label="Imagens do pedido">
              {fotosDoAcervo.map((f) => (
                <li key={f.id} className="min-w-0">
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted" style={{ paddingBottom: "100%" }}>
                    <ImagemDaMesa caminho={f.caminho} bucket={f.bucket} alt={f.nome} className="absolute inset-0 h-full w-full object-cover" />
                    <button type="button" onClick={() => setFotosDoAcervo((l) => l.filter((x) => x.id !== f.id))} aria-label={`Tirar ${f.nome}`} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <SeletorDoPapel valor={f.papel} rotulo={f.nome} onValor={(v) => setFotosDoAcervo((l) => l.map((x) => (x.id === f.id ? { ...x, papel: v } : x)))} />
                </li>
              ))}
              {anexos.lista.map((a) => (
                <li key={a.id} className="min-w-0">
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted" style={{ paddingBottom: "100%" }}>
                    {a.previa ? <img src={a.previa} alt={a.nome} className="absolute inset-0 h-full w-full object-cover" /> : <ImagemDaMesa caminho={a.caminho} alt={a.nome} className="absolute inset-0 h-full w-full object-cover" />}
                    {a.estado === "subindo" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="h-4 w-4 animate-spin" /></span>
                    )}
                    <button type="button" onClick={() => anexos.remover(a.id)} aria-label={`Tirar ${a.nome}`} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <SeletorDoPapel valor={papelDe(a.id, a.nome)} rotulo={a.nome} onValor={(v) => setPapeis((m) => ({ ...m, [a.id]: v }))} />
                </li>
              ))}
            </ul>
          )}
          {documentos.length > 0 && (
            <ul className="space-y-1 px-3 pb-2" aria-label="Arquivos lidos">
              {documentos.map((d, i) => (
                <li key={`${d.nome}-${i}`} className="flex min-w-0 items-center rounded-md bg-muted px-2 py-1.5 text-[12px]">
                  <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{d.nome}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{d.texto.length.toLocaleString("pt-BR")} caracteres</span>
                  <button type="button" onClick={() => setDocumentos((l) => l.filter((_, j) => j !== i))} aria-label={`Tirar ${d.nome}`} className="ml-1.5 shrink-0 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Barra do campo: anexar e microfone com contraste (fundo cheio), a dica à direita. */}
          <div className="flex min-w-0 flex-wrap items-center border-t border-border/70 px-2 py-1.5">
            <button
              type="button"
              onClick={() => entrada.current && entrada.current.click()}
              disabled={cheio && documentos.length >= MAX_DOCUMENTOS_DA_ARTE_RAPIDA}
              className={juntar(botao.primario, "my-0.5 mr-2 h-9 bg-secondary px-3 text-[12.5px] text-foreground hover:bg-secondary/80")}
            >
              {lendo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1.5 h-4 w-4" />} Fotos e arquivos
            </button>
            <input
              ref={entrada}
              type="file"
              multiple
              accept="image/*,.pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.zip"
              className="hidden"
              aria-label="Enviar fotos, logos, a arte do cliente ou arquivos"
              onChange={(e) => {
                const escolhidos = Array.prototype.slice.call(e.target.files || []) as File[];
                if (entrada.current) entrada.current.value = "";
                void adicionarArquivos(escolhidos);
              }}
            />
            <Ditado valor={pedido} onChange={setPedido} className="my-0.5 min-w-0 [&_button]:h-9 [&_button]:w-9 [&_button]:border-transparent [&_button]:bg-secondary [&_button]:text-foreground" />
            <span className="ml-auto hidden truncate pl-2 text-[11.5px] text-muted-foreground md:inline">
              <Paperclip className="mr-0.5 inline h-3 w-3" /> Arraste, cole ou envie (até {MAX_IMAGENS_DA_ARTE_RAPIDA} imagens)
            </span>
          </div>
        </div>
      </div>

      {/* A peça: o agente reconhece sozinho; a equipe pode decidir antes. */}
      <div className="min-w-0">
        <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Peça</p>
        <div className="flex min-w-0 flex-wrap items-center">
          <div role="radiogroup" aria-label="Peça" className="mb-1 mr-3 inline-flex min-w-0 rounded-lg border border-border bg-background p-0.5">
            {(["auto", "unica", "carrossel"] as PecaPedida[]).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={peca === v}
                onClick={() => setPeca(v)}
                className={juntar(
                  "toque-compacto h-8 min-w-0 rounded-md px-3 text-[12.5px] font-medium transition-colors",
                  peca === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
                title={v === "auto" ? "O agente decide pelo pedido: arte única ou carrossel" : undefined}
              >
                {v === "auto" ? "Automático" : ROTULO_DA_PECA[v]}
              </button>
            ))}
          </div>
          {peca === "carrossel" && (
            <label className="mb-1 inline-flex items-center text-[12px] text-muted-foreground">
              Lâminas
              <select value={laminas} onChange={(e) => setLaminas(e.target.value)} className="ml-1.5 h-8 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground" aria-label="Quantidade de lâminas">
                <option value="auto">Pelo conteúdo</option>
                {["2", "3", "4", "5", "6", "7", "8"].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="min-w-0 border-t border-border pt-3">
        <TituloRecolhivel titulo="Mais opções" recolhido={maisRecolhido} onAlternar={() => setMaisRecolhido(!maisRecolhido)} resumo={`${rotuloDoFormato}${geraJunto ? ", já gera" : ""}`} />
        {!maisRecolhido && (
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <div className="min-w-0">
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Formato</p>
              <SeletorDeFormatoCompacto valor={formato} onMudar={setFormato} />
            </div>
            <label className="flex min-w-0 items-start text-[12.5px]">
              <Switch checked={gerarLogo} onCheckedChange={setGerarLogo} className="mr-2 mt-0.5 shrink-0" aria-label="Gerar a arte logo em seguida" />
              <span className="min-w-0">
                Gerar a arte logo em seguida
                <span className="block text-[11.5px] text-muted-foreground">Arte única: a lâmina entra na fila assim que a direção fica pronta. Carrossel: você confere a direção e gera.</span>
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );

  const acao = (
    <div className="flex min-w-0 flex-col-reverse items-stretch sm:flex-row sm:items-center sm:justify-end">
      <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground sm:mr-3 sm:mt-0">
        {geraJunto ? "Direção e arte em seguida." : "Direção pronta para você conferir e gerar."} Foto real entra como está.
      </p>
      <BotaoComCusto
        rotulo={<><Wand2 className="mr-1.5 h-4 w-4" />Criar arte</>}
        titulo="Arte rápida criada"
        descricao="O diretor de arte lê o pedido, as imagens e os arquivos, com a marca e a campanha, e escreve a direção."
        partes={partes}
        executar={criar}
        aoConcluir={concluir}
        disabled={!pronto}
        size="default"
        className="h-10 w-full sm:w-auto"
      />
    </div>
  );

  const cabecalho = (
    <div className="flex min-w-0 items-baseline">
      <h2 className="mr-2 shrink-0 text-[15.5px] font-semibold leading-tight">Arte rápida</h2>
      <p className="min-w-0 truncate text-[12px] text-muted-foreground">Fora do plano do mês, com a marca, a campanha e o diretor de arte de sempre.</p>
    </div>
  );

  // Prévia à direita (tela larga): como a peça vai sair, com o que já foi escolhido.
  const previa = (
    <aside className={juntar(superficie.painel, "flex min-h-0 min-w-0 flex-col overflow-hidden")} aria-label="Como vai sair" data-previa-da-arte-rapida="">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-[13px] font-semibold">Como vai sair</p>
      </div>
      <RegiaoRolavel modo="sempre" classeDeFora="min-h-0 flex-1" className="space-y-4 p-4" sobre="cartao">
        <div className="mx-auto w-full max-w-[220px]">
          <div className="relative overflow-hidden rounded-lg border border-border bg-muted" style={{ paddingBottom: `${Math.round(100 / (FORMATOS_DO_POST.filter((f) => f.valor === formato)[0] || FORMATOS_DO_POST[0]).proporcao)}%` }}>
            {primeiraImagem ? (
              primeiraImagem.src ? (
                <img src={primeiraImagem.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <ImagemDaMesa caminho={primeiraImagem.caminho} bucket={primeiraImagem.bucket} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )
            ) : (
              <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12px] leading-snug text-muted-foreground">{pedido.trim() ? pedido.trim().slice(0, 90) : "A foto e o texto do pedido aparecem aqui."}</span>
            )}
            {escolhida && (
              <span className="absolute left-2 top-2">
                <SeloDaCampanha campanha={escolhida} tamanho="h-8 w-8" />
              </span>
            )}
            <span className="absolute bottom-2 right-2 rounded bg-background/90 px-1.5 text-[10.5px] font-medium tabular-nums">{rotuloDoFormato}</span>
          </div>
        </div>
        <dl className="space-y-2.5 text-[12.5px]">
          <div className="flex min-w-0 justify-between">
            <dt className="text-muted-foreground">Peça</dt>
            <dd className="ml-3 min-w-0 truncate text-right font-medium">{peca === "auto" ? "o agente decide" : ROTULO_DA_PECA[peca]}</dd>
          </div>
          <div className="flex min-w-0 justify-between">
            <dt className="text-muted-foreground">Campanha</dt>
            <dd className="ml-3 min-w-0 truncate text-right font-medium">{escolhida ? escolhida.nome : campanha === "auto" ? "se o pedido citar" : "só a marca"}</dd>
          </div>
          {escolhida && resumoDaBaseDaCampanha(escolhida) && <p className="text-[11.5px] leading-snug text-muted-foreground">{resumoDaBaseDaCampanha(escolhida)}</p>}
          <div className="flex min-w-0 justify-between">
            <dt className="text-muted-foreground">Imagens</dt>
            <dd className="ml-3 text-right font-medium tabular-nums">{arquivos.length}</dd>
          </div>
          <div className="flex min-w-0 justify-between">
            <dt className="text-muted-foreground">Arquivos lidos</dt>
            <dd className="ml-3 text-right font-medium tabular-nums">{documentos.length}</dd>
          </div>
        </dl>
        <ol className="space-y-1.5 border-t border-border pt-3 text-[11.5px] leading-snug text-muted-foreground">
          <li>1. O diretor lê o pedido com a marca{escolhida ? " e a campanha" : ""}.</li>
          <li>2. {geraJunto ? "A arte única já entra na fila de geração." : "Você confere a direção e gera."}</li>
          <li>3. Depois: ajustar no Estúdio e levar para a Agenda com a data.</li>
        </ol>
      </RegiaoRolavel>
    </aside>
  );

  if (!colunas) {
    return (
      <ZonaDeAnexos anexos={anexos} className="w-full min-w-0" rotulo="Solte fotos, logos ou a arte do cliente">
        <section className={juntar(superficie.painel, "min-w-0 space-y-5 p-4")} aria-label="Pedido da arte rápida">
          {cabecalho}
          {corpo}
          <div className="border-t border-border pt-4">{acao}</div>
        </section>
      </ZonaDeAnexos>
    );
  }

  // Computador: o formulário ocupa a coluna (rolagem própria) com o botão sempre à vista; a prévia ao lado na tela larga.
  return (
    <div className={juntar("grid h-full min-h-0 min-w-0 gap-3", largo ? "grid-cols-[minmax(0,1fr)_300px]" : "grid-cols-1")}>
      <ZonaDeAnexos anexos={anexos} className="flex h-full min-h-0 min-w-0 flex-col" rotulo="Solte fotos, logos ou a arte do cliente">
        <section className={juntar(superficie.painel, "flex h-full min-h-0 min-w-0 flex-col overflow-hidden")} aria-label="Pedido da arte rápida">
          <div className="shrink-0 border-b border-border px-5 py-3">{cabecalho}</div>
          <RegiaoRolavel modo="sempre" classeDeFora="min-h-0 flex-1" className="px-5 py-4" sobre="cartao" memoria={`mesa:arte-rapida:pedido:${clientId}`} rotulo="Pedido">
            <div className="max-w-[860px]">{corpo}</div>
          </RegiaoRolavel>
          <div className="shrink-0 border-t border-border px-5 py-3">{acao}</div>
        </section>
      </ZonaDeAnexos>
      {largo && previa}
    </div>
  );
}

// ------------------------------------------------------------------ histórico

function ItemDoHistorico({ t, ativo, onAbrir }: { t: Trabalho; ativo: boolean; onAbrir: () => void }) {
  const a = arteDoTrabalho(t);
  const s = situacaoDaArteRapida(t);
  const mini = miniaturaDaArteRapida(t);
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-current={ativo ? "true" : undefined}
      className={`flex w-full min-w-0 items-center rounded-lg p-1.5 text-left transition-colors ${ativo ? "bg-primary/10" : "hover:bg-muted"}`}
      data-arte-rapida={t.id}
    >
      <span className="flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {mini ? <ImagemDaMesa caminho={mini} alt="" className="h-full w-full object-cover" /> : <Zap className="h-4 w-4 text-muted-foreground" />}
      </span>
      <span className="ml-2 min-w-0 flex-1">
        <span className={`block truncate text-[12.5px] ${ativo ? "font-semibold" : "font-medium"}`}>{a ? a.titulo : "Arte rápida"}</span>
        <span className="mt-0.5 flex min-w-0 items-center text-[11px] text-muted-foreground">
          <span className="mr-1.5 truncate">{a ? ROTULO_DA_PECA[a.peca] : ""} · {dataCurta(t.atualizado_em)}</span>
          <SeloDoItem tom={s.tom} className="shrink-0">{s.rotulo}</SeloDoItem>
        </span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ levar para a Agenda

function amanhaEmSaoPaulo(): string {
  const agora = partesNoFuso(new Date(), EDITORIAL_DEFAULT_TIME_ZONE);
  const d = new Date(`${agora.dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function LevarParaAgenda({ trabalho, onAbrirItem }: { trabalho: Trabalho; onAbrirItem: (taskId: string) => void }) {
  const { clientId, catalogo, podeRecarregar } = useMesa();
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const avisarErro = useAvisarErro();
  const a = arteDoTrabalho(trabalho);
  const [data, setData] = useState(amanhaEmSaoPaulo);
  const [hora, setHora] = useState("");
  // Frente RO (29/09, arte rápida da Acerbi que "foi" mas não chegou ao cliente): as 3 opções da entrega (EN),
  // o erro à vista (nada de silêncio) e o "Na Agenda" só quando a arte foi entregue de verdade.
  const opcoes = opcoesDaEntrega(podeRecarregar);
  const [modo, setModo] = useState<ModoDeEntrega>("aprovacao");
  const [passo, setPasso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agendar, setAgendar] = useState<AprovadaSemData | null>(null);
  const [fim, setFim] = useState<{ taskId: string; data: string; avisos: string[]; entregue: boolean } | null>(null);
  const [arquivando, setArquivando] = useState(false);
  const melhores = useQuery({ queryKey: ["mesa", "melhores-horarios", clientId], staleTime: 10 * 60_000, retry: false, queryFn: () => lerMelhoresHorarios(clientId) });

  const cards = (trabalho.direcao && Array.isArray(trabalho.direcao.cards) ? trabalho.direcao.cards : []).length;
  const feitas = ultimasVersoes(trabalho.cards || []).size;
  const todas = cards > 0 && feitas >= cards;
  const tipoDoPost = cards > 1 ? "carousel" : "static";
  const horaSugerida = useMemo(() => {
    const agora = partesNoFuso(new Date(), EDITORIAL_DEFAULT_TIME_ZONE);
    const porTipo = (melhores.data && (melhores.data as any).por_tipo) || {};
    return horarioSugerido({ diaDaPeca: data, hoje: agora.dia, agoraHHMM: agora.hora, melhorHora: porTipo[tipoDoPost] || null }).hora;
  }, [data, melhores.data, tipoDoPost]);
  const horaFinal = hora || horaSugerida;
  const iso = data && horaFinal ? localParaIso(data, horaFinal, EDITORIAL_DEFAULT_TIME_ZONE) : null;
  const problema = iso ? problemaNoHorario(iso, new Date()) : "Escolha a data.";
  const diretor = padraoPara(catalogo, "diretor_arte");
  const semLegenda = !(trabalho.legenda || "").trim();

  /**
   * O fluxo das pautas, na ordem: item na Agenda (idempotente: "Entregar de novo" reaproveita o item), legenda,
   * arquivos em Arquivos no projeto da marca (entregar), a data confirmada ANTES da aprovação, e o modo:
   * aprovação do cliente, pronto para agendar (aprova em nome dele e agenda; sem perfil ou data, a janela do
   * Agendar pergunta) ou só Arquivos. Qualquer falha fica escrita na tela e pode ser refeita.
   */
  const levar = async () => {
    const avisos: string[] = [];
    let custo = 0;
    setErro(null);
    let taskId: string | null = a && a.task_id ? a.task_id : null;
    try {
      setPasso("Criando o item na Agenda");
      const r = await levarArteRapidaParaAgenda({ trabalhoId: trabalho.id, data, pedidoId: `${trabalho.id}:${data}` });
      gravarArteRapidaNoCache(queryClient, clientId, r.trabalho);
      taskId = r.task.id;
      if (semLegenda && modo !== "arquivos") {
        setPasso("Escrevendo a legenda");
        const l = await chamarFuncao<any>("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id });
        custo += Number(l && l.custo_usd) || 0;
      }
      setPasso(modo === "arquivos" ? "Entregando em Arquivos" : "Entregando em Arquivos e na Agenda");
      await repetirEntregaEmPartes(() => chamarFuncao("estudio-arte", corpoDoEntregar(trabalho.id, modo)));
      if (modo !== "arquivos" && iso) {
        setPasso("Confirmando a data");
        try {
          await confirmarPublicacao(trabalho.id, iso, false);
        } catch (e) {
          avisos.push(`A data fica para confirmar na Entrega do item: ${textoDoErro(e)}`);
        }
      }
      if (modo === "aprovacao") {
        setPasso("Enviando para aprovação");
        await enviarUmParaAprovacao(trabalho.id);
      } else {
        setPasso(modo === "pronto" ? "Aprovando pelo cliente e agendando" : "Guardando em Arquivos");
        const c = await chamarFuncao<RespostaDaConclusao>("estudio-arte", corpoDaConclusao(trabalho.id, modo, false));
        if (modo === "pronto" && c && c.precisa_data) {
          // Sem perfil ou sem data que sirva: pergunta aqui mesmo (a janela do Agendar), com a peça já entregue.
          if (c.motivo) avisos.push(c.motivo);
          const atual = await lerArteRapida(clientId, trabalho.id).catch(() => null);
          const t = atual || trabalho;
          setAgendar({
            id: t.id,
            task_id: taskId,
            file_ids: t.file_ids || [],
            post_id: t.post_id || null,
            aprovado_em: t.aprovado_em || null,
            publicar_em: iso || t.publicar_em || null,
            entrega_aviso: t.entrega_aviso || null,
            titulo: a ? a.titulo : "Arte rápida",
            dia: data || null,
            project_id: null,
          });
        }
      }
      setFim({ taskId: taskId as string, data, avisos, entregue: true });
      return { custo_usd: custo };
    } catch (e) {
      const motivo = textoDoErro(e, "Não foi possível entregar.");
      setErro(motivo);
      if (taskId) setFim({ taskId, data, avisos, entregue: false });
      throw e;
    } finally {
      setPasso(null);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "arte-rapida", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["mesa", "agenda-do-mes", clientId] });
      void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    }
  };

  const arquivar = async () => {
    const ok = await confirmar({
      title: "Arquivar esta arte rápida?",
      description: "Ela sai do histórico. Nada é apagado: as versões e o custo ficam no trabalho.",
    });
    if (!ok) return;
    setArquivando(true);
    try {
      const r = await arquivarArteRapida(trabalho.id);
      gravarArteRapidaNoCache(queryClient, clientId, r.trabalho);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "arte-rapida", clientId] });
      toast.success("Arte arquivada", { description: "Saiu do histórico da arte rápida." });
    } catch (e) {
      avisarErro(e, "Não foi possível arquivar");
    } finally {
      setArquivando(false);
    }
  };

  const taskFeito = fim ? fim.taskId : a && a.task_id ? a.task_id : null;
  const dataFeita = fim ? fim.data : a && a.data ? a.data : null;
  // Entregue de verdade: a arte está em Arquivos (file_ids). Item na Agenda sem entrega é o caso da Acerbi (29/09).
  const entregue = (fim && fim.entregue) || (trabalho.status === "entregue" && (trabalho.file_ids || []).length > 0);
  const naoEntregue = !!taskFeito && !entregue;
  const seletorDoModo = (
    <div className="min-w-0">
      <p className="mb-1 flex items-center text-[12px] text-muted-foreground">
        Como entregar
        <AjudaRecolhida className="ml-1.5" rotulo="As opções da entrega">
          {opcoes.map((o) => `${o.curto}: ${o.dica}`).join(" ")}
        </AjudaRecolhida>
      </p>
      <div className="flex min-w-0 flex-wrap" role="radiogroup" aria-label="Como entregar" data-modo-da-entrega={modo}>
        {opcoes.map((o) => (
          <button
            key={o.modo}
            type="button"
            role="radio"
            aria-checked={modo === o.modo}
            title={o.dica}
            onClick={() => setModo(o.modo)}
            className={
              modo === o.modo
                ? "mb-1 mr-3 text-[12px] font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4"
                : "mb-1 mr-3 text-[12px] text-muted-foreground hover:text-foreground"
            }
          >
            {o.curto}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-levar-para-agenda={trabalho.id}>
      {a && (
        <div className="rounded-lg bg-muted px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">O pedido</p>
          <p className="mt-0.5 text-[12.5px] leading-snug [overflow-wrap:anywhere]">{a.pedido || a.titulo}</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {ROTULO_DA_PECA[a.peca]} {a.peca_por === "jev" ? "(o agente reconheceu)" : a.peca_por === "regra" ? "(pelo pedido)" : ""}
            {a.arquivos.length ? ` · ${a.arquivos.map((x) => `${x.nome} (${ROTULO_DO_PAPEL[x.papel].toLowerCase()}${x.papel_por !== "equipe" && (x.papel === "foto" || x.papel === "rosto") ? ", pelo agente" : ""})`).join(", ")}` : ""}
          </p>
          {a.avisos.length > 0 && <p className="mt-1 text-[11.5px] text-warning">{a.avisos.join(" ")}</p>}
        </div>
      )}

      {naoEntregue ? (
        <div className="space-y-3" data-nao-entregue={trabalho.id}>
          <p className="text-[13px] font-semibold text-warning" role="alert">O item está na Agenda, mas a arte não chegou ao cliente</p>
          <p className="text-[12px] leading-snug text-muted-foreground">
            {erro || "A entrega em Arquivos não terminou. Entregue de novo: o item da Agenda é o mesmo, nada se repete."}
          </p>
          {seletorDoModo}
          {passo && (
            <p className="flex items-center text-[12px] text-muted-foreground" role="status">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {passo}
            </p>
          )}
          <BotaoComCusto
            rotulo={<><CalendarPlus className="mr-1.5 h-4 w-4" />Entregar de novo</>}
            titulo="Entregar de novo"
            descricao={semLegenda ? "Escreve a legenda (a única parte que usa IA) e entrega pelo fluxo da Agenda, no mesmo item." : "Entrega pelo fluxo da Agenda, no mesmo item. Sem custo de IA."}
            partes={() => (semLegenda ? [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }] : [])}
            executar={levar}
            fecharAoConfirmar
            disabled={!todas || passo !== null}
            size="default"
            className="h-11 w-full"
          />
          <div className="flex min-w-0 flex-wrap items-center">
            <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" onClick={() => onAbrirItem(taskFeito as string)}>
              Continuar no item
            </Button>
          </div>
        </div>
      ) : taskFeito ? (
        <div className="space-y-2 rounded-lg border border-success/40 bg-success/5 px-3 py-3" role="status">
          <p className="flex items-center text-[13px] font-semibold">
            Na Agenda{dataFeita ? ` em ${dataCurta(dataFeita)}` : ""}
            <AjudaRecolhida className="ml-1.5" rotulo="O que acontece agora">
              A peça segue pelo fluxo da Agenda: aprovação do cliente e publicação só com a data confirmada. Ajustes, reenvio e a data ficam no item.
            </AjudaRecolhida>
          </p>
          {fim && fim.avisos.length > 0 && <p className="text-[12px] text-warning">{fim.avisos.join(" ")}</p>}
          <div className="flex min-w-0 flex-wrap items-center">
            <CaminhoPronto caminho={{ rotulo: "Abrir o item no Estúdio", destino: linkDoItemNoEstudio(clientId, taskFeito, dataFeita) }} />
            <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" onClick={() => onAbrirItem(taskFeito)}>
              Continuar no item
            </Button>
            <Link to={`/calendario?client=${clientId}`} className="mb-1 inline-flex h-8 items-center rounded-md px-2 text-[12px] font-medium text-primary hover:underline">
              Ver na Agenda
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center text-[13px] font-semibold">
            Levar para a Agenda
            <AjudaRecolhida className="ml-1.5" rotulo="O que o botão faz">
              Escolha a data, a hora e como entregar: o item nasce na Agenda, a arte vai para Arquivos (no projeto da marca) e para o post, a data fica confirmada e, conforme a opção, o cliente recebe para aprovar, a peça já fica aprovada e agendada, ou fica só em Arquivos.
            </AjudaRecolhida>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-[12px] text-muted-foreground">
              Data
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1 h-10 min-w-0" aria-label="Data do post" />
            </label>
            <label className="min-w-0 text-[12px] text-muted-foreground">
              Hora
              <Input type="time" value={horaFinal} onChange={(e) => setHora(e.target.value)} className="mt-1 h-10 min-w-0" aria-label="Hora do post" />
            </label>
          </div>
          {!hora && <p className="text-[11.5px] text-muted-foreground">Hora sugerida pelo melhor horário do perfil.</p>}
          {problema && data && <p className="text-[12px] text-destructive">{problema}</p>}
          {seletorDoModo}
          {erro && <p className="text-[12px] leading-snug text-destructive" role="alert">{erro}</p>}
          {!todas && <p className="rounded-md bg-warning/10 px-2.5 py-2 text-[12px] text-warning">Gere {cards > 1 ? "todas as lâminas" : "a arte"} antes de levar ({feitas} de {cards || 1}).</p>}
          {passo && (
            <p className="flex items-center text-[12px] text-muted-foreground" role="status">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {passo}
            </p>
          )}
          <BotaoComCusto
            rotulo={<><CalendarPlus className="mr-1.5 h-4 w-4" />Confirmar e levar para {data ? dataCurta(data) : "a Agenda"}</>}
            titulo="Arte na Agenda"
            descricao={semLegenda ? "Escreve a legenda (a única parte que usa IA), cria o item na data e entrega pelo fluxo da Agenda." : "Cria o item na data e entrega pelo fluxo da Agenda. Sem custo de IA."}
            partes={() => (semLegenda ? [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }] : [])}
            executar={levar}
            fecharAoConfirmar
            disabled={!todas || !!problema || passo !== null}
            size="default"
            className="h-11 w-full"
          />
        </div>
      )}

      {agendar && (
        <JanelaDaAprovada
          peca={agendar}
          posicao={1}
          total={1}
          titulo="Agendar"
          onFechar={() => setAgendar(null)}
          onFeita={() => {
            setAgendar(null);
            void queryClient.invalidateQueries({ queryKey: ["mesa", "arte-rapida", clientId] });
            void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
          }}
        />
      )}

      <div className="border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[12px] text-muted-foreground" onClick={() => void arquivar()} disabled={arquivando}>
          {arquivando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" />} Arquivar esta arte
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tela

export default function EstudioArteRapida({
  alvo,
  onAlvo,
  colunas,
  altura,
  refDaAltura,
  foco,
  alturaDaJanela,
  topo,
  renderPeca,
  onAbrirItem,
}: {
  alvo: string;
  onAlvo: (alvo: string, limpar?: string[]) => void;
  colunas: boolean;
  altura?: number | null;
  /** Frente AE-3: o elemento que a altura mede (useAlturaQueCabe da AbaEstudio): a tela começa nele. */
  refDaAltura?: Ref<HTMLDivElement>;
  foco: boolean;
  alturaDaJanela: number;
  topo: ReactNode;
  renderPeca: (p: { item: ItemDoMes; trabalho: Trabalho; rapida: ModoRapidoDoDetalhe }) => ReactNode;
  onAbrirItem: (taskId: string) => void;
}) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const largo = useMidia("(min-width: 1440px)");
  const [params] = useSearchParams();
  const nova = alvo === NOVA_ARTE_RAPIDA;
  const lista = useQuery({ queryKey: chavesDaArteRapida.lista(clientId), queryFn: () => lerArtesRapidas(clientId) });
  // Frente AE: com duas marcas, o histórico só mostra as artes da marca aberta.
  const historico = artesDoHistorico(lista.data || []).filter((t) => arteRapidaDaMarca(t, marca));
  const naLista = !nova ? (lista.data || []).filter((t) => t.id === alvo)[0] || null : null;
  const um = useQuery({
    queryKey: chavesDaArteRapida.um(clientId, alvo),
    enabled: !nova && !!lista.data && !naLista,
    queryFn: () => lerArteRapida(clientId, alvo),
  });
  const trabalho = naLista || (um.data && arteDoTrabalho(um.data) ? um.data : null);
  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), queryFn: () => lerCampanhas(clientId) });
  const [historicoRecolhido, setHistoricoRecolhido] = useRecolhido("mesa:arte-rapida:historico", true);

  // O que veio no endereço (da Mesa Foto ou das Campanhas) vale para o pedido novo.
  const fotosDaUrl = useMemo(
    () => (params.get("fotos") || "").split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_IMAGENS_DA_ARTE_RAPIDA),
    [params],
  );
  const campanhaBruta = params.get("campanha") || "";
  const campanhaDaUrl = /^[0-9a-f-]{36}$/i.test(campanhaBruta) ? campanhaBruta : null;

  const nomeDaCampanha = (id: string | null | undefined) => {
    const c = id ? (campanhas.data || []).filter((x) => x.id === id)[0] : null;
    return c ? c.nome : "";
  };

  const rapida: ModoRapidoDoDetalhe | null = trabalho
    ? (() => {
        const a = arteDoTrabalho(trabalho);
        const campanha = nomeDaCampanha(trabalho.direcao && (trabalho.direcao as { campanha_id?: string | null }).campanha_id);
        return {
          subtitulo: `Arte rápida · ${a ? ROTULO_DA_PECA[a.peca] : ""}${campanha ? ` · ${campanha}` : ""}${a && a.task_id ? " · na Agenda" : ""}`,
          entrega: <LevarParaAgenda key={trabalho.id} trabalho={trabalho} onAbrirItem={onAbrirItem} />,
        };
      })()
    : null;

  // Frente AE: a arte de outra marca (endereço antigo ou outra aba) não abre misturada: pede para trocar a marca.
  const daOutraMarca = !!trabalho && !arteRapidaDaMarca(trabalho, marca);
  const peca = trabalho && rapida && !daOutraMarca ? renderPeca({ item: itemDaArteRapida(trabalho), trabalho, rapida }) : null;
  const carregandoPeca = !nova && !trabalho && (lista.isLoading || um.isLoading || um.isFetching);

  const conteudo = nova ? (
    <PedidoDaArteRapida
      key={`${fotosDaUrl.join(",")}|${campanhaDaUrl || ""}`}
      fotosDaUrl={fotosDaUrl}
      campanhaDaUrl={campanhaDaUrl}
      colunas={colunas}
      largo={largo}
      onCriada={(t) => onAlvo(t.id, ["fotos", "campanha"])}
    />
  ) : peca ? (
    peca
  ) : daOutraMarca ? (
    <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center rounded-xl border border-warning/50 bg-warning/5 p-6 text-center" role="status" data-arte-de-outra-marca="">
      <p className="text-[14px] font-semibold">Esta arte é de outra marca</p>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">Troque a marca no topo da Mesa para abrir. Aqui o Estúdio mostra e gera só a marca {marca ? marca.nome : "aberta"}.</p>
      <Button type="button" className="mt-4 h-10" onClick={() => onAlvo(NOVA_ARTE_RAPIDA)}>
        <Plus className="mr-1.5 h-4 w-4" /> Nova arte
      </Button>
    </div>
  ) : carregandoPeca ? (
    <div className={juntar(superficie.painel, "flex min-h-[280px] flex-1 items-center justify-center text-[12.5px] text-muted-foreground")}>
      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Abrindo a arte…
    </div>
  ) : (
    <div className={juntar(superficie.painel, "flex min-h-[280px] flex-1 flex-col items-center justify-center p-6 text-center")}>
      <p className="text-[14px] font-semibold">Esta arte rápida não está mais aqui</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">Ela pode ter sido arquivada. Comece outra ou escolha no histórico.</p>
      <Button type="button" className="mt-4 h-10" onClick={() => onAlvo(NOVA_ARTE_RAPIDA)}>
        <Plus className="mr-1.5 h-4 w-4" /> Nova arte
      </Button>
    </div>
  );

  // Tela cheia (computador): só a peça, como no Estúdio das pautas.
  if (foco && colunas && peca) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-background p-2" role="region" aria-label="Arte rápida em tela cheia" data-estudio-foco="">
        <div className="flex min-h-0 min-w-0 flex-col" style={{ height: Math.max(480, alturaDaJanela - 16) }}>{peca}</div>
      </div>
    );
  }

  const listaDoHistorico = (
    <>
      {lista.isLoading && (
        <div className="space-y-1.5 p-1">
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
        </div>
      )}
      {lista.isError && <p className="p-2 text-[12px] text-destructive">{textoDoErro(lista.error)}</p>}
      {lista.isSuccess && !historico.length && <p className="px-2 py-4 text-center text-[12px] text-muted-foreground">Nenhuma arte rápida ainda. As que você criar ficam aqui para voltar e ajustar.</p>}
      <ul className="space-y-0.5" aria-label="Histórico da arte rápida">
        {historico.map((t) => (
          <li key={t.id} className="min-w-0">
            <ItemDoHistorico t={t} ativo={t.id === alvo} onAbrir={() => onAlvo(t.id, ["fotos", "campanha"])} />
          </li>
        ))}
      </ul>
    </>
  );

  // Nunca esmaecido: na arte nova ele fica marcado (secundário), senão é a ação principal da coluna.
  const botaoNova = (
    <button
      type="button"
      className={juntar(nova ? botao.secundario : botao.primario, "h-8 px-2.5 text-[12.5px]")}
      onClick={() => !nova && onAlvo(NOVA_ARTE_RAPIDA)}
      aria-current={nova ? "page" : undefined}
      title={nova ? "Você está numa arte nova" : "Começar uma arte nova"}
    >
      <Plus className="mr-1 h-3.5 w-3.5" /> Nova arte
    </button>
  );

  if (colunas) {
    // Frente AE-2 (dono, 28/09: "apertado, o scroll não funciona"): a tela inteira cabe na altura abaixo da
    // barra da Mesa; o histórico, o formulário e a prévia rolam cada um por dentro; a página não rola.
    return (
      <div ref={refDaAltura} className="grid min-h-0 min-w-0 grid-cols-[260px_minmax(0,1fr)] gap-3" style={altura ? { height: altura } : undefined} data-arte-rapida-tela="colunas">
        <aside className={juntar(superficie.painel, "flex min-h-0 min-w-0 flex-col overflow-hidden")} aria-label="Histórico da arte rápida">
          <div className="shrink-0 space-y-2 border-b border-border px-3 py-2.5">
            {topo}
            <div className="flex min-w-0 items-center">
              <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">Histórico{historico.length ? ` (${historico.length})` : ""}</h2>
              {botaoNova}
            </div>
          </div>
          <RegiaoRolavel modo="sempre" className="p-1.5" classeDeFora="min-h-0 flex-1" sobre="cartao" memoria={`mesa:arte-rapida:${clientId}`} rotulo="Artes rápidas">
            {listaDoHistorico}
          </RegiaoRolavel>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col">{conteudo}</div>
      </div>
    );
  }

  // Celular e tablet em pé: uma coluna; o histórico recolhe em cima, o pedido ou a peça embaixo.
  return (
    <div className="min-w-0 space-y-3" data-arte-rapida-tela="pilha">
      <div className={juntar(superficie.painel, "p-2.5")}>
        <div className="mb-2 flex min-w-0">{topo}</div>
        <div className="flex min-w-0 items-center">
          <div className="min-w-0 flex-1">
            <TituloRecolhivel
              titulo={`Histórico${historico.length ? ` (${historico.length})` : ""}`}
              recolhido={historicoRecolhido}
              onAlternar={() => setHistoricoRecolhido(!historicoRecolhido)}
              resumo={trabalho ? arteDoTrabalho(trabalho)?.titulo : undefined}
            />
          </div>
          {botaoNova}
        </div>
        {!historicoRecolhido && <div className="mt-2">{listaDoHistorico}</div>}
      </div>
      {conteudo}
    </div>
  );
}
