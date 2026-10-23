import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Image as IconeDeImagem, Loader2, Minus, Plus, Sparkles, Upload, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, ErroDaMesa, padraoPara, textoDoErro } from "@/lib/mesa/api";
import { useMarcaDaMesa, useMesa, useUrlDaMesa } from "../MesaContexto";
import { chamarInstagram, normalizarPainel } from "../instagram/instagramApi";
import { useAcervo } from "../SeletorDoAcervo";
import { BotaoComCusto } from "../Custo";
import ImagensReaisDoDiretor from "../ImagensReaisDoDiretor";
import { formatoDoTrabalho, gravarTrabalhoNoCache, useEstadoGuardado, type TrabalhoGravado } from "../estudioUtil";
import { chaveDoRascunho, esquecerRascunhos, gravarRascunho, lerRascunhoGuardado, publicarBaseDoTemplate, useRascunhoCompartilhado } from "./rascunhoDoTemplate";
import PainelDoCarrossel from "./PainelDoCarrossel";
import EditorDoTextoDaLamina from "./EditorDoTextoDaLamina";
import { blocoInicialDaLamina, carregarMidiaDoBloco, midiaParaCarregar, pendenciaDoBloco, type CardDoCarrossel } from "./blocoDaLamina";
import { FUNDOS_PRONTOS, textoSemMarcas, type ResultadoDoCarrossel } from "./renderCarrossel";
import type { CardDaDirecao, CardGerado, Trabalho } from "../useItensDoMes";
import { carregarImagemProfile, desenharProfile, TEMPO_PADRAO, type FormatoProfile, type RetanguloProfile } from "./renderProfile";
import { chaveDaFonteProfile, fontesDoProfile, pontoNaImagemProfile, referenciaDaFonteProfile, resolverFonteProfile, ROTULO_DO_GRUPO, type CardComFontes, type FonteProfile, type GrupoDaFonte } from "./fontesDoProfile";
import { NumeroOpcional, Segmentado } from "./controlesDoTemplate";
import { partesDaFotoDoTemplate, partesDoTextoDoTemplate } from "./partesDoTemplate";
import type { BlocoDaLamina, NumerosDoPost, TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";
import { limiteDoTexto } from "../../../../supabase/functions/estudio-arte/modulos/limites-do-post";

/**
 * Template do Estúdio: só o post do X, no padrão do Estúdio (rodada 4, 21/10, dono: "ele recriou e não precisava").
 * - parte "centro": entra na lâmina grande do Estúdio pela `moldura` (mesmo título, versões, ampliar e quadro);
 *   daqui vêm só a faixa (estado e Guardar, no lugar do "Gerar de novo") e o desenho do post no quadro.
 * - parte "painel": a ferramenta Template (arte ou post no centro, aparência, imagem, perfil e Gerar).
 * O texto do post é o texto da lâmina, editado na ferramenta Lâmina; a prancheta mostra a miniatura do X.
 * Legenda, aprovação, agenda e postar continuam nas ferramentas da sequência. A foto entra inteira.
 */

const ultimaVersao = (trabalho: Trabalho, ordem: number): CardGerado | undefined => trabalho.cards.filter((v) => v.ordem === ordem).sort((a, b) => b.versao - a.versao)[0];
const metadados = (versao: CardGerado | undefined): TemplateProfile | undefined => versao?.template_profile;
type Rede = TemplateProfile["estilo"];
type Origem = "gerar" | "internet" | "cliente";
/** texto_editado (24/10): o texto da lâmina em edição, ainda não salvo; a prévia e a miniatura já mostram. */
type Ajustes = Omit<TemplateProfile, "nome" | "username"> & { nome: string | null; username: string | null; texto_base: string; sem_imagem?: boolean; texto_editado?: string };

/**
 * O modelo da peça vem do carrossel inteiro, nunca de uma lâmina só (24/10, dono: "está misturando os
 * templates"): a escolha guardada na sessão; sem ela, o da versão mais nova entre todas as lâminas; sem
 * versão, o carrossel quando o gerador sugeriu mídia, ou o post do X.
 */
export function modeloDoTrabalho(trabalho: Pick<Trabalho, "cards" | "direcao">): TemplateProfile["estilo"] {
  const versoes = (trabalho.cards || []).filter((v) => v.template_profile && v.template_profile.estilo);
  const maisNova = versoes.sort((a, b) => String(b.criado_em || "").localeCompare(String(a.criado_em || "")) || b.versao - a.versao)[0];
  if (maisNova && maisNova.template_profile) return maisNova.template_profile.estilo;
  return (trabalho.direcao.cards || []).some((c) => (c as CardDoCarrossel).carrossel) ? "carrossel" : "twitter";
}

const PADRAO: Omit<TemplateProfile, "nome" | "username" | "texto"> = {
  versao: 1, estilo: "twitter", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 34, tamanho_foto: 88, espacamento: 48, arredondamento: 24,
};
const FUNDO_DO_TEMA = { claro: "#ffffff", escuro: "#000000", dim: "#15202b" } as const;
const ORIGENS: Array<{ valor: Origem; rotulo: string }> = [
  { valor: "gerar", rotulo: "Gerar" },
  { valor: "internet", rotulo: "Internet" },
  { valor: "cliente", rotulo: "Do cliente" },
];
/** Proporção pedida ao gerador para a foto caber inteira na mídia do post. */
const proporcaoDaFoto = (t: Pick<TemplateProfile, "estilo" | "proporcao">): "16:9" | "1:1" | "4:5" | "9:16" =>
  t.estilo === "story" ? "9:16" : t.estilo === "instagram" ? (t.proporcao === "1:1" ? "1:1" : "4:5") : t.proporcao === "1:1" ? "1:1" : "16:9";

/**
 * A aparência que cada lâmina guarda no próprio rascunho (23/10): o "Aplicar a todas" copia estes campos para
 * as outras lâminas, e o Montar todas usa os de cada uma (a lâmina nunca aberta herda os da lâmina aberta).
 */
export const CAMPOS_DA_APARENCIA = ["tema", "cor_fundo", "tamanho_texto", "peso_texto", "seta", "rodape_cinza", "verificado", "espacamento"] as const;
export type CampoDaAparencia = (typeof CAMPOS_DA_APARENCIA)[number];
const aparenciaDe = (a: Partial<TemplateProfile>): Partial<TemplateProfile> => {
  const r: Partial<TemplateProfile> = {};
  for (const k of CAMPOS_DA_APARENCIA) if (a[k] !== undefined) (r as Record<string, unknown>)[k] = a[k];
  return r;
};

/** Partes da estimativa (moram em partesDoTemplate.ts; o painel do carrossel usa as mesmas). */
export { partesDaFotoDoTemplate, partesDoTextoDoTemplate };

/** O painel remonta por cliente/marca/trabalho/lâmina: consultas pendentes nunca mostram o perfil anterior. */
export default function TemplateProfileEditor({ trabalho, card, bloqueado: bloqueadoDeFora, onMudou, onAbrirFotos, parte = "tudo", moldura, modoTemplate, onModoTemplate }: {
  trabalho: Trabalho; card: CardDaDirecao; bloqueado: boolean; onMudou: () => void; onAbrirFotos: () => void;
  /**
   * "centro": o post entra na lâmina grande do Estúdio pela `moldura` (a faixa e o desenho do quadro);
   * "painel": a ferramenta Template. Os dois dividem o mesmo rascunho.
   */
  parte?: "tudo" | "centro" | "painel";
  moldura?: (p: { faixa: ReactNode; conteudo: (largura: number) => ReactNode }) => ReactNode;
  /** O centro do Estúdio mostra a arte da lâmina (false) ou o post do X (true): troca dentro da própria ferramenta. */
  modoTemplate?: boolean;
  onModoTemplate?: (template: boolean) => void;
}) {
  const mesa = useMesa(), { marca } = useMarcaDaMesa(), cache = useQueryClient();
  const bloqueado = bloqueadoDeFora || ["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"].includes(trabalho.entrega_status || "");
  const livre = mesa.carteira === "laboratorio";
  const salvo = metadados(ultimaVersao(trabalho, card.ordem));
  const chaveDe = (ordem: number) => chaveDoRascunho(mesa.clientId, marca?.id, trabalho.id, ordem);
  const chave = chaveDe(card.ordem);
  // Carrossel estilo X (22/10): lâmina com sugestão do gerador e sem versão abre direto no modelo novo, com o bloco sugerido.
  const cardDoCarrossel = card as CardDoCarrossel;
  /** O rascunho inicial de uma lâmina: a versão guardada dela, ou a sugestão do gerador, ou o padrão. */
  const inicialDe = (c: CardDaDirecao): Ajustes => {
    const s0 = metadados(ultimaVersao(trabalho, c.ordem));
    const estilo = s0?.estilo || ((c as CardDoCarrossel).carrossel ? "carrossel" : PADRAO.estilo);
    return { ...PADRAO, ...s0, estilo, nome: s0?.nome ?? null, username: s0?.username ?? null, texto: s0?.texto ?? c.texto_exato ?? "", texto_base: c.texto_exato || "", ...(estilo === "carrossel" ? { bloco: blocoInicialDaLamina(c as CardDoCarrossel, s0, mesa.clientId), seta: s0?.seta ?? true } : {}) };
  };
  // Um modelo para o trabalho inteiro (24/10): a lâmina que chega com outro modelo é convertida ao abrir.
  const chaveDoModelo = `${chaveDe(0).slice(0, -1)}modelo`;
  const [modeloEscolhido, setModeloEscolhido] = useRascunhoCompartilhado<Rede | null>(chaveDoModelo, null);
  const modelo: Rede = modeloEscolhido || modeloDoTrabalho(trabalho);
  const [ajustesGuardados, setAjustes] = useRascunhoCompartilhado<Ajustes>(chave, inicialDe(card));
  /** O rascunho de uma lâmina convertido para o modelo (mesma regra de antes da troca, agora para todas). */
  function paraOModelo(a: Ajustes, rede: Rede, c: CardDaDirecao): Ajustes {
    if (a.estilo === rede) return a;
    // Carrossel X (22/10): lâmina inteira estilo post do X, fundo branco ou preto, com o bloco de mídia.
    if (rede === "carrossel" || a.estilo === "carrossel") {
      const tema = rede === "carrossel" ? (a.tema === "claro" ? "claro" : "escuro") : a.tema === "escuro" ? "escuro" : "claro";
      return { ...a, estilo: rede, texto: a.texto_base, tema, cor_fundo: tema === "claro" ? "#ffffff" : "#000000", destaque: undefined, ...(rede === "carrossel" ? { bloco: a.bloco || blocoInicialDaLamina(c as CardDoCarrossel, metadados(ultimaVersao(trabalho, c.ordem)), mesa.clientId), seta: a.seta ?? true } : {}) };
    }
    const legenda = (trabalho.legenda || "").trim();
    // A legenda do post entra no Instagram só se a equipe não tinha mexido no texto da lâmina (e volta ao sair).
    const texto = rede === "instagram" && legenda && a.texto === a.texto_base ? legenda : a.estilo === "instagram" && legenda && a.texto === legenda ? a.texto_base : a.texto;
    const tema = rede !== "twitter" && a.tema === "dim" ? "escuro" : a.tema;
    const proporcao = rede === "instagram" ? (a.proporcao === "1:1" ? "1:1" : "4:5") : rede === "twitter" ? (a.proporcao === "1:1" ? "1:1" : "16:9") : undefined;
    return { ...a, estilo: rede, texto, tema, proporcao, cor_fundo: tema !== a.tema ? FUNDO_DO_TEMA[tema] : a.cor_fundo, destaque: undefined };
  }
  // A lâmina sempre aparece no modelo do trabalho; o rascunho dela é acertado logo depois (sem piscar).
  const ajustes = ajustesGuardados.estilo === modelo ? ajustesGuardados : paraOModelo(ajustesGuardados, modelo, card);
  useEffect(() => {
    if (ajustesGuardados.estilo !== modelo) setAjustes((a) => paraOModelo(a, modelo, card));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo, ajustesGuardados.estilo, chave]);
  const [origem, setOrigem] = useEstadoGuardado<Origem>(`mesa:template:origem:${trabalho.id}`, "gerar");
  const [contaId, setContaId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false), [pronto, setPronto] = useState(false), [erro, setErro] = useState("");
  const [andamento, setAndamento] = useState("");
  // A marcação do ponto começa no painel e termina no clique no centro: estado dividido, como o rascunho.
  const [marcacao, setMarcacao] = useRascunhoCompartilhado<{ marcando: boolean; rotulo: string }>(`${chave}:marcacao`, { marcando: false, rotulo: ajustes.destaque?.rotulo || "" });
  const marcando = marcacao.marcando, rotulo = marcacao.rotulo;
  const setMarcando = (v: boolean | ((antes: boolean) => boolean)) => setMarcacao((m) => ({ ...m, marcando: typeof v === "function" ? v(m.marcando) : v }));
  const setRotulo = (valor: string) => setMarcacao((m) => ({ ...m, rotulo: valor }));
  const [gerarAberto, setGerarAberto] = useState(false), [tema, setTema] = useState(""), [todas, setTodas] = useState(true), [gravarLegenda, setGravarLegenda] = useState(!trabalho.legenda);
  const [avisosDoGerar, setAvisosDoGerar] = useState<string[]>([]);
  const [descricaoDaFoto, setDescricaoDaFoto] = useState(() => (card.composicao || card.ilustracao || card.texto_exato || "").replace(/\s+/g, " ").trim().slice(0, 600));
  const [quadro, setQuadro] = useState<HTMLCanvasElement | null>(null);
  const vivo = useRef(true), upload = useRef<HTMLInputElement>(null);
  const imagemNaPrevia = useRef<RetanguloProfile | null>(null);
  const tentativas = useRef(new Map<string, string>());
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const perfil = useQuery({
    queryKey: ["mesa", "profile-template", mesa.clientId, marca?.id || "-", contaId],
    enabled: !!mesa.clientId && !livre, staleTime: 120_000, retry: 1,
    queryFn: async () => normalizarPainel(await chamarInstagram("painel", mesa.clientId, contaId ? { conta_id: contaId } : {})),
  });
  // IDs anexados pela equipe são escolhas explícitas, também no Livre. Isso não importa identidade.
  const acervo = useAcervo(!!trabalho.direcao.cards?.some((c) => c.imagens_ids?.length));
  const cardsOrdenados = [...(trabalho.direcao.cards || [card])].sort((a, b) => a.ordem - b.ordem);
  const posicaoDe = (ordem: number) => ({ atual: Math.max(1, cardsOrdenados.findIndex((c) => c.ordem === ordem) + 1), total: Math.max(1, cardsOrdenados.length) });
  const fontes = fontesDoProfile(card as CardComFontes, acervo.data || [], mesa.clientId);
  const preferida = ajustes.sem_imagem ? undefined : resolverFonteProfile(fontes, ajustes);
  const fonte = ajustes.sem_imagem ? undefined : preferida || fontes[0];
  const fonteMudou = ajustes.estilo !== "carrossel" && !ajustes.sem_imagem && (!preferida && !!(ajustes.imagem_acervo_id || ajustes.imagem_caminho) || !!ajustes.destaque && !ajustes.imagem_acervo_id && !ajustes.imagem_caminho);
  const foto = useUrlDaMesa(fonte?.caminho, fonte?.bucket);
  const avatarGuardado = useUrlDaMesa(ajustes.foto_caminho);
  const nome = ajustes.nome ?? (!livre ? perfil.data?.perfil.nome : "") ?? "";
  const textoSalvoDaLamina = card.texto_exato || "";
  // O texto em edição (cada tecla, Enter incluído) já vale na prévia e na miniatura, antes de salvar.
  const textoDaLamina = ajustes.texto_editado ?? textoSalvoDaLamina;
  useEffect(() => {
    // Salvo (aqui, no Guardar ou na ferramenta Lâmina): a edição pendente igual ao guardado sai do rascunho.
    if (ajustesGuardados.texto_editado !== undefined && ajustesGuardados.texto_editado.trim() === textoSalvoDaLamina.trim()) setAjustes((a) => { const { texto_editado: _t, ...resto } = a; return resto; });
  }, [ajustesGuardados.texto_editado, textoSalvoDaLamina, setAjustes]);
  const ehInstagram = ajustes.estilo === "instagram";
  // A legenda do Instagram não reescreve a lâmina: a base muda sozinha; no X e no Story, só sem edição da equipe.
  const textoDesatualizado = ajustes.texto_base !== textoSalvoDaLamina;
  // Post do X: um texto só, o da lâmina (o mesmo campo de conteúdo do Estúdio). Rascunho de texto só nos antigos.
  const ehX = ajustes.estilo === "twitter";
  const ehCarrossel = ajustes.estilo === "carrossel";
  const textoDoPost = ehX || ehCarrossel ? textoDaLamina : ajustes.texto;
  const conflitoDeTexto = !ehX && !ehCarrossel && textoDesatualizado && !ehInstagram && ajustes.texto !== ajustes.texto_base;
  // Só quando o texto da lâmina chega diferente (abertura ou mudança de fora); o Gerar já põe o texto novo antes.
  const ultimoTextoDaLamina = useRef<string | null>(null);
  useEffect(() => {
    if (ultimoTextoDaLamina.current === textoSalvoDaLamina) return;
    ultimoTextoDaLamina.current = textoSalvoDaLamina;
    if (!textoDesatualizado || conflitoDeTexto) return;
    setAjustes((a) => ({ ...a, texto: a.estilo === "instagram" ? a.texto : textoSalvoDaLamina, texto_base: textoSalvoDaLamina }));
  }, [textoDesatualizado, conflitoDeTexto, textoSalvoDaLamina, setAjustes]);
  const username = (ajustes.username ?? (!livre ? perfil.data?.perfil.username : "") ?? "").replace(/^@/, "");
  const perfilConfere = !!username && perfil.data?.perfil.username.toLowerCase() === username.toLowerCase();
  const avatarUrl = ajustes.foto_caminho ? avatarGuardado.data : !livre && perfilConfere ? perfil.data?.perfil.foto_url : null;
  const contaSalvaId = perfil.data?.contas.find((c) => c.username.toLowerCase() === username.toLowerCase())?.id;
  useEffect(() => {
    // O @ salvo pode pertencer à segunda conta: nunca combinar esse nome com o avatar da principal.
    if (!contaId && contaSalvaId && contaSalvaId !== perfil.data?.conta_id) setContaId(contaSalvaId);
  }, [contaId, contaSalvaId, perfil.data?.conta_id]);
  const formato = formatoDoTrabalho(trabalho.direcao as { formato?: unknown }) as FormatoProfile;
  const { texto_base: _base, sem_imagem: _sem, texto_editado: _editado, ...semRascunho } = ajustes;
  const bloco: BlocoDaLamina | undefined = ehCarrossel ? (ajustes.bloco || blocoInicialDaLamina(cardDoCarrossel, salvo, mesa.clientId)) : undefined;
  const template: TemplateProfile = ehCarrossel
    ? { ...semRascunho, texto: textoDoPost, nome, username, bloco, imagem_caminho: undefined, imagem_acervo_id: undefined }
    : { ...semRascunho, texto: textoDoPost, nome, username, ...referenciaDaFonteProfile(fonte) };
  if (ehCarrossel) { delete template.imagem_caminho; delete template.imagem_acervo_id; delete template.destaque; }
  if (fonteMudou || !fonte) delete template.destaque;
  const midiaDoBloco = ehCarrossel ? midiaParaCarregar(bloco) : null;
  const urlDaMidia = useUrlDaMesa(midiaDoBloco?.caminho, midiaDoBloco?.bucket);
  const [desenhoDoBloco, setDesenhoDoBloco] = useState<ResultadoDoCarrossel | null>(null);
  const assinatura = JSON.stringify(template);
  const posicao = posicaoDe(card.ordem);
  const fotosPendentes = ehCarrossel
    ? (!!midiaDoBloco && !urlDaMidia.data && !urlDaMidia.isError) || (!!ajustes.foto_caminho && !avatarGuardado.data)
    : (!!fonte && !foto.data) || (!!ajustes.foto_caminho && !avatarGuardado.data) || (!!card.imagens_ids?.length && acervo.isPending);
  const erroDasFontes = ehCarrossel ? urlDaMidia.isError || avatarGuardado.isError : foto.isError || avatarGuardado.isError || acervo.isError;
  const rotuloValido = !!rotulo.trim() && rotulo.trim().length <= 60 && !/[\r\n\t<>]/.test(rotulo);
  const limite = ehCarrossel
    ? { usado: Array.from(textoSemMarcas(textoDoPost)).length, limite: 0, passou: false, texto: `${Array.from(textoSemMarcas(textoDoPost)).length} caracteres` }
    : limiteDoTexto(ajustes.estilo === "carrossel" ? "twitter" : ajustes.estilo, textoSemMarcas(textoDoPost));
  const faltaImagemDoIG = ehInstagram && !fonte;
  const pendenciaDoCarrossel = ehCarrossel ? pendenciaDoBloco(bloco) : "";
  const escolherFonte = (escolhida: FonteProfile | undefined) => {
    setMarcando(false);
    setAjustes((a) => ({ ...a, ...referenciaDaFonteProfile(escolhida), destaque: undefined, sem_imagem: !escolhida }));
  };

  // As miniaturas da prancheta usam o desenho desta lâmina (perfil, tema, cores e tamanhos), ao vivo.
  useEffect(() => {
    if (parte === "painel") return;
    const dados = JSON.parse(assinatura) as TemplateProfile;
    delete dados.destaque;
    publicarBaseDoTemplate(trabalho.id, { template: dados, avatarUrl: avatarUrl || null, formato });
  }, [assinatura, avatarUrl, formato, parte, trabalho.id]);

  useEffect(() => {
    let atual = true; setPronto(false); setErro(""); imagemNaPrevia.current = null;
    if (fotosPendentes || erroDasFontes || !quadro) return;
    const dados = JSON.parse(assinatura) as TemplateProfile;
    if (!dados.nome.trim() || !/^[a-zA-Z0-9_.]{1,30}$/.test(dados.username) || !dados.texto.trim()) return;
    const midiaUrl = dados.estilo === "carrossel" ? urlDaMidia.data : null;
    const tipoDaMidia = dados.bloco?.tipo === "video" ? "video" : "imagem";
    void Promise.all([avatarUrl ? carregarImagemProfile(avatarUrl) : null, dados.estilo !== "carrossel" && foto.data ? carregarImagemProfile(foto.data) : null, midiaUrl ? carregarMidiaDoBloco(midiaUrl, tipoDaMidia) : null]).then(([avatar, imagem, midia]) => {
      if (!atual || !quadro) return;
      const r = desenharProfile(quadro, dados, formato, { avatar, imagem, imagemExata: fonte?.exata, posicao, midia });
      imagemNaPrevia.current = r?.imagem || null;
      setDesenhoDoBloco(r?.carrossel || null);
      // Também verifica CORS na prévia: nunca habilita Guardar para um canvas contaminado.
      quadro.toDataURL("image/png"); setPronto(true);
    }).catch((e: unknown) => { if (atual) setErro(textoDoErro(e)); });
    return () => { atual = false; };
    // posicao é derivada de cards (atual/total), entra pela assinatura do conjunto.
  }, [assinatura, formato, avatarUrl, foto.data, urlDaMidia.data, fotosPendentes, erroDasFontes, fonte?.exata, quadro, posicao.atual, posicao.total]);

  const mudar = <K extends keyof Ajustes>(k: K, valor: Ajustes[K]) => setAjustes((a) => ({ ...a, [k]: valor }));
  /**
   * "Aplicar a todas as lâminas" (23/10, dono: "se eu selecionei um tamanho de texto posso aplicar para todas"):
   * os campos de aparência vão para o rascunho de cada lâmina (a que nunca abriu ganha o rascunho inicial dela
   * com eles). A prévia e as miniaturas mudam na hora; nada é guardado sem o Guardar ou o Montar todas.
   */
  const aplicarATodas = (patch: Partial<Pick<TemplateProfile, CampoDaAparencia>>) => {
    for (const c of cardsOrdenados) {
      if (c.ordem === card.ordem) { setAjustes((a) => ({ ...a, ...patch })); continue; }
      const antes = lerRascunhoGuardado<Ajustes>(chaveDe(c.ordem)) || inicialDe(c);
      // O modelo segue o da lâmina aberta (carrossel com o bloco da lâmina), para ela abrir igual às outras.
      const doModelo = ajustes.estilo === "carrossel" && antes.estilo !== "carrossel" ? { estilo: "carrossel" as const, bloco: antes.bloco || blocoInicialDaLamina(c as CardDoCarrossel, metadados(ultimaVersao(trabalho, c.ordem)), mesa.clientId), seta: antes.seta ?? true } : {};
      gravarRascunho<Ajustes>(chaveDe(c.ordem), { ...antes, ...doModelo, ...patch });
    }
  };
  /** O selo é do perfil: marcar ou tirar vale para todas as lâminas de uma vez. */
  const mudarSelo = (v: boolean) => aplicarATodas({ verificado: v });
  const mudarNumero = (k: keyof NumerosDoPost, v: number | undefined) => setAjustes((a) => {
    const numeros = { ...(a.numeros || {}) };
    if (v === undefined) delete numeros[k]; else numeros[k] = v;
    return { ...a, numeros: Object.keys(numeros).length ? numeros : undefined };
  });
  /**
   * Trocar o modelo vale para o carrossel inteiro (24/10): a escolha fica no trabalho, o rascunho de cada lâmina
   * já aberta é convertido e as que nunca abriram são convertidas ao abrir. O Montar todas usa o mesmo modelo.
   */
  const trocarRede = (rede: Rede) => {
    setModeloEscolhido(rede);
    setAjustes((a) => paraOModelo(a, rede, card));
    for (const c of cardsOrdenados) {
      if (c.ordem === card.ordem) continue;
      const dela = lerRascunhoGuardado<Ajustes>(chaveDe(c.ordem));
      if (dela && dela.estilo !== rede) gravarRascunho<Ajustes>(chaveDe(c.ordem), paraOModelo(dela, rede, c));
    }
  };

  const rascunhoDoCardDoLote = (ordem: number) => lerRascunhoGuardado<Ajustes>(chaveDe(ordem));
  const salvar = async (todasAsLaminas: boolean) => {
    if (!pronto || ocupado || bloqueado || conflitoDeTexto || fonteMudou || faltaImagemDoIG) return;
    setOcupado(true); setErro(""); let feitas = 0;
    try {
      const baseDaAberta = card.texto_exato || "";
      const ordens = todasAsLaminas ? cardsOrdenados : [card];
      for (const c of ordens) {
        if (!vivo.current) break;
        setAndamento(`Montando ${feitas + 1} de ${ordens.length}`);
        const disponiveis = fontesDoProfile(c as CardComFontes, acervo.data || [], mesa.clientId);
        const salvoDoCard = metadados(ultimaVersao(trabalho, c.ordem));
        const esta = c.ordem === card.ordem;
        if (template.estilo === "carrossel") {
          // Carrossel X: o bloco de cada lâmina vem do rascunho dela, da versão guardada ou da sugestão do gerador.
          const rascunhoDela = esta ? null : lerRascunhoGuardado<Ajustes>(chaveDe(c.ordem));
          const blocoDela = esta ? template.bloco : rascunhoDela?.bloco || blocoInicialDaLamina(c as CardDoCarrossel, salvoDoCard, mesa.clientId);
          const falta = pendenciaDoBloco(blocoDela);
          if (falta) throw new Error(`Lâmina ${c.ordem}: ${falta.toLowerCase()}.`);
          // A aparência é a do rascunho de cada lâmina (fundo, tamanho, selo); sem rascunho, a da lâmina aberta.
          const cfgC: TemplateProfile = { ...template, ...(rascunhoDela ? aparenciaDe(rascunhoDela) : {}), texto: esta ? template.texto : rascunhoDela?.texto_editado ?? c.texto_exato ?? "", bloco: blocoDela };
          const m = midiaParaCarregar(blocoDela);
          const url = m ? await supabase.storage.from(m.bucket).createSignedUrl(m.caminho, 3600) : null;
          if (url?.error) throw url.error;
          const [avatarC, midiaC] = await Promise.all([avatarUrl ? carregarImagemProfile(avatarUrl) : null, url?.data?.signedUrl ? carregarMidiaDoBloco(url.data.signedUrl, blocoDela?.tipo === "video" ? "video" : "imagem") : null]);
          const telaC = document.createElement("canvas");
          const desenho = desenharProfile(telaC, cfgC, formato, { avatar: avatarC, midia: midiaC, posicao: posicaoDe(c.ordem) });
          const pngC = telaC.toDataURL("image/png").split(",")[1];
          const versaoC = ultimaVersao(trabalho, c.ordem)?.versao || 0;
          const chaveDoPedidoC = JSON.stringify([c.ordem, versaoC, c.texto_exato || "", cfgC, formato]);
          let pedidoC = tentativas.current.get(chaveDoPedidoC);
          if (!pedidoC) { pedidoC = crypto.randomUUID(); tentativas.current.set(chaveDoPedidoC, pedidoC); }
          const rC = await chamarFuncao<{ trabalho: TrabalhoGravado; versao: number }>("estudio-arte", { acao: "salvar_template", trabalho_id: trabalho.id, ordem: c.ordem, versao_esperada: versaoC, texto_base: esta ? baseDaAberta : c.texto_exato || "", pedido_id: pedidoC, png_base64: pngC, template: cfgC });
          gravarTrabalhoNoCache(cache, mesa.clientId, rC.trabalho);
          // Lâmina de vídeo: o MP4 com a moldura e o vídeo inteiro no bloco sai pela fila de render.
          if (blocoDela?.tipo === "video" && desenho.carrossel?.bloco) await pedirVideoDaLamina(c.ordem, rC.versao, desenho.carrossel);
          if (vivo.current && esta) setAjustes((a) => ({ ...a, texto_base: cfgC.texto }));
          feitas++;
          continue;
        }
        const escolha = esta ? template : salvoDoCard;
        const f = esta && ajustes.sem_imagem ? undefined : resolverFonteProfile(disponiveis, escolha);
        if (!f && (escolha?.imagem_acervo_id || escolha?.imagem_caminho)) throw new Error(`A imagem guardada saiu da lâmina ${c.ordem}. Escolha novamente em seu Template.`);
        if (c.imagens_ids?.length && !f && !c.fotos_livres?.length && !(esta && ajustes.sem_imagem)) throw new Error(`Escolha uma foto em Fotos para a lâmina ${c.ordem}.`);
        if (template.estilo === "instagram" && !f) throw new Error(`A lâmina ${c.ordem} está sem imagem. O post do Instagram precisa de uma foto em cada lâmina.`);
        // No Instagram o texto é a legenda do post, a mesma em todas as lâminas do carrossel.
        const textoDoCard = esta || template.estilo === "instagram" ? template.texto : rascunhoDoCardDoLote(c.ordem)?.texto_editado ?? c.texto_exato ?? "";
        const rascunhoDoCard = esta ? null : lerRascunhoGuardado<Ajustes>(chaveDe(c.ordem));
        const cfg: TemplateProfile = { ...template, ...(rascunhoDoCard ? aparenciaDe(rascunhoDoCard) : {}), ...referenciaDaFonteProfile(f), texto: textoDoCard };
        // Cada ponto pertence à sua própria fonte autorizada, inclusive ao montar o lote.
        if (!esta) cfg.destaque = f && (salvoDoCard?.imagem_acervo_id || salvoDoCard?.imagem_caminho) ? salvoDoCard.destaque : undefined;
        const imagemUrl = f ? await supabase.storage.from(f.bucket).createSignedUrl(f.caminho, 3600) : null;
        if (imagemUrl?.error) throw imagemUrl.error;
        const [avatar, imagem] = await Promise.all([avatarUrl ? carregarImagemProfile(avatarUrl) : null, imagemUrl?.data?.signedUrl ? carregarImagemProfile(imagemUrl.data.signedUrl) : null]);
        const tela = document.createElement("canvas"); desenharProfile(tela, cfg, formato, { avatar, imagem, imagemExata: f?.exata, posicao: posicaoDe(c.ordem) });
        const png = tela.toDataURL("image/png").split(",")[1];
        const versao = ultimaVersao(trabalho, c.ordem)?.versao || 0;
        // A mesma tentativa após falha de rede usa o mesmo identificador; metadados mudados iniciam outra.
        const chaveDoPedido = JSON.stringify([c.ordem, versao, c.texto_exato || "", cfg, formato]);
        let pedidoId = tentativas.current.get(chaveDoPedido);
        if (!pedidoId) { pedidoId = crypto.randomUUID(); tentativas.current.set(chaveDoPedido, pedidoId); }
        const r = await chamarFuncao<{ trabalho: TrabalhoGravado }>("estudio-arte", { acao: "salvar_template", trabalho_id: trabalho.id, ordem: c.ordem, versao_esperada: versao, texto_base: esta ? baseDaAberta : c.texto_exato || "", pedido_id: pedidoId, png_base64: png, template: cfg });
        gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
        if (vivo.current && esta) setAjustes((a) => ({ ...a, ...referenciaDaFonteProfile(f), texto_base: template.estilo === "instagram" ? a.texto_base : cfg.texto }));
        feitas++;
      }
      if (vivo.current) toast.success(feitas === 1 ? "Template guardado como nova versão" : `${feitas} lâminas montadas`, { description: "Confira a peça na prancheta e continue em Entrega." });
    } catch (e) {
      if (vivo.current) setErro(`${feitas ? `${feitas} lâmina(s) já guardada(s). ` : ""}${textoDoErro(e)}`);
    } finally { onMudou(); if (vivo.current) { setOcupado(false); setAndamento(""); } }
  };

  // ---------------------------------------------------------------- MP4 da lâmina de vídeo (fila de render)

  const [videoDaLamina, setVideoDaLamina] = useState<{ estado: string; url: string | null; erro: string | null } | null>(null);
  const pedirVideoDaLamina = async (ordem: number, versao: number, desenho: ResultadoDoCarrossel) => {
    const b = desenho.bloco!;
    try {
      const r = await chamarFuncao<{ pedido: { estado: string } }>("estudio-arte", {
        acao: "template_video_pedir", trabalho_id: trabalho.id, ordem, versao, uid: crypto.randomUUID(),
        retangulo: { x: b.x, y: b.y, largura: b.largura, altura: b.altura, raio: b.raio }, cor_do_bloco: desenho.fundoDoBloco,
      });
      if (ordem === card.ordem && vivo.current) setVideoDaLamina({ estado: r.pedido.estado, url: null, erro: null });
      void cache.invalidateQueries({ queryKey: ["mesa", "template-video", trabalho.id, ordem] });
    } catch (e) {
      const semFila = e instanceof ErroDaMesa && e.codigo === "banco_sem_fila";
      toast.warning(`Lâmina ${ordem}: o MP4 não entrou na fila`, { description: semFila ? "A fila da lâmina de vídeo ainda não foi ativada no banco. A lâmina ficou guardada em PNG." : textoDoErro(e) });
    }
  };
  const ehLaminaDeVideo = ehCarrossel && bloco?.tipo === "video";
  const temVersaoComVideo = !!ultimaVersao(trabalho, card.ordem)?.template_profile?.bloco && ultimaVersao(trabalho, card.ordem)?.template_profile?.bloco?.tipo === "video";
  const consultarVideo = useQuery({
    queryKey: ["mesa", "template-video", trabalho.id, card.ordem],
    enabled: parte !== "painel" && temVersaoComVideo,
    retry: false,
    refetchInterval: (q) => {
      const estado = (q.state.data as { pedido?: { estado?: string } } | undefined)?.pedido?.estado;
      return estado === "fila" || estado === "rodando" ? 15_000 : false;
    },
    queryFn: async () => {
      const r = await chamarFuncao<{ trabalho: TrabalhoGravado; pedido: { estado: string; erro_mensagem: string | null } | null; url: string | null }>("estudio-arte", { acao: "template_video_estado", trabalho_id: trabalho.id, ordem: card.ordem });
      if (r.pedido?.estado === "pronto") gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
      return r;
    },
  });
  const estadoDoVideo = videoDaLamina && (!consultarVideo.data?.pedido || consultarVideo.data.pedido.estado === "pronto" && !consultarVideo.data.url) ? videoDaLamina : consultarVideo.data?.pedido ? { estado: consultarVideo.data.pedido.estado, url: consultarVideo.data.url, erro: consultarVideo.data.pedido.erro_mensagem } : null;

  const enviarAvatar = async (arquivo: File) => {
    setErro("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(arquivo.type) || arquivo.size > 8_000_000) { setErro("Use uma foto PNG, JPG ou WebP de até 8 MB."); return; }
    setOcupado(true);
    try {
      const ext = arquivo.type === "image/png" ? "png" : arquivo.type === "image/webp" ? "webp" : "jpg";
      const caminho = `${mesa.clientId}/estudio/fotos/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { upsert: false, contentType: arquivo.type });
      if (error) throw error;
      if (vivo.current) mudar("foto_caminho", caminho);
    } catch (e) { if (vivo.current) setErro(textoDoErro(e)); } finally { if (vivo.current) setOcupado(false); }
  };

  // ---------------------------------------------------------------- gerar (custo antes, no botão)

  const diretor = padraoPara(mesa.catalogo || [], "diretor_arte");
  const quantasNoFio = ajustes.estilo === "instagram" ? cardsOrdenados.length : todas ? cardsOrdenados.length : 1;
  const gerarConteudo = async () => {
    const r = await chamarFuncao<{ trabalho: TrabalhoGravado; posts: Array<{ ordem: number; texto: string }>; legenda: string | null; avisos?: string[]; custo_usd: number }>("estudio-arte", {
      acao: "template_conteudo", trabalho_id: trabalho.id, ordem: card.ordem, rede: ajustes.estilo, tema: tema.trim() || undefined,
      todas: ajustes.estilo !== "instagram" && cardsOrdenados.length > 1 && todas, gravar_legenda: ajustes.estilo !== "story" && gravarLegenda, confirmado: true,
    });
    gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
    if (vivo.current) {
      const meu = r.posts.find((p) => p.ordem === card.ordem);
      if (ajustes.estilo === "instagram" && r.legenda) setAjustes((a) => ({ ...a, texto: r.legenda || a.texto }));
      else if (meu) setAjustes((a) => ({ ...a, texto: meu.texto, texto_base: meu.texto }));
      setAvisosDoGerar(r.avisos || []);
    }
    onMudou();
    return r;
  };
  const semFonte = (c: CardDaDirecao) => fontesDoProfile(c as CardComFontes, acervo.data || [], mesa.clientId).length === 0;
  const laminasSemImagem = cardsOrdenados.filter((c) => c.ordem !== card.ordem && semFonte(c));
  const gerarFoto = async (ordens: number[]) => {
    let custo = 0, ultima: { caminho: string } | null = null;
    for (const ordem of ordens) {
      if (!vivo.current) break;
      setAndamento(ordens.length > 1 ? `Gerando a foto ${ordens.indexOf(ordem) + 1} de ${ordens.length}` : "Gerando a foto");
      const r = await chamarFuncao<{ trabalho: TrabalhoGravado; imagem: { caminho: string }; custo_usd: number }>("estudio-arte", {
        acao: "template_imagem", trabalho_id: trabalho.id, ordem, rede: ajustes.estilo, proporcao: proporcaoDaFoto(ajustes),
        descricao: ordem === card.ordem ? descricaoDaFoto.trim() || undefined : undefined, confirmado: true,
      });
      custo += Number(r.custo_usd) || 0;
      gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
      if (ordem === card.ordem) ultima = r.imagem;
    }
    if (vivo.current) {
      setAndamento("");
      if (ultima) { const caminho = ultima.caminho; setAjustes((a) => ({ ...a, imagem_caminho: caminho, imagem_acervo_id: undefined, destaque: undefined, sem_imagem: false })); }
    }
    onMudou();
    return { custo_usd: custo };
  };

  // ---------------------------------------------------------------- partes da tela

  const travado = ocupado || bloqueado;
  const pendencia = !nome.trim() || !username ? "Preencha nome e @ do perfil na ferramenta Template" : limite.passou ? limite.texto : fonteMudou ? "A imagem guardada saiu desta lâmina" : faltaImagemDoIG ? "O post do Instagram precisa de uma foto" : pendenciaDoCarrossel;
  const podeGuardar = pronto && !travado && !conflitoDeTexto && !fonteMudou && !faltaImagemDoIG && !pendenciaDoCarrossel;

  /**
   * Rodada 4 (dono: "o Estúdio ali dá pra deixar o mesmo padrão com o templates; ele recriou e não
   * precisava"): o centro é a lâmina grande do Estúdio (EstudioLaminaGrande, pela `moldura`), com o mesmo
   * título, versões, ampliar e quadro. Do Template só vem a faixa (estado e Guardar, no lugar do "Gerar de
   * novo") e o desenho do post no quadro. Texto: o da lâmina, editado na ferramenta Lâmina, como sempre.
   */
  const faixa = <div className="mb-2 min-w-0 space-y-1.5" data-faixa-do-template="">
    <div className="flex min-h-7 min-w-0 items-center">
      <p className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate", pendencia && "text-warning")} role="status" data-limite-do-texto="">{andamento || pendencia || `${ehCarrossel ? `Carrossel X${ehLaminaDeVideo ? " · lâmina de vídeo" : ""}` : "Post do X"} · ${limite.texto}`}</p>
      <Button type="button" size="sm" variant="outline" className="ml-2 h-7 shrink-0 px-2.5 text-[12px]" disabled={!podeGuardar} onClick={() => void salvar(false)} title="Guarda o post como nova versão da lâmina (sem custo)">{ocupado && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Guardar nova versão</Button>
    </div>
    {ehCarrossel && estadoDoVideo && <div role="status" className={juntar(texto.auxiliar, "flex flex-wrap items-center")} data-mp4-da-lamina={estadoDoVideo.estado}>
      <span className="mr-2">{estadoDoVideo.estado === "pronto" ? "MP4 da lâmina pronto" : estadoDoVideo.estado === "erro" ? `O MP4 falhou${estadoDoVideo.erro ? `: ${estadoDoVideo.erro}` : ""}` : estadoDoVideo.estado === "cancelado" ? "O MP4 foi cancelado" : "MP4 da lâmina na fila de render"}</span>
      {estadoDoVideo.url && <a href={estadoDoVideo.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center underline"><Download className="mr-1 h-3.5 w-3.5" />Baixar MP4</a>}
    </div>}
    {!ehX && !ehCarrossel && <div role="status" className={juntar(texto.auxiliar, "flex flex-wrap items-center")}><span className="mb-1 mr-2">Template antigo ({ajustes.estilo === "instagram" ? "Instagram" : "Story"}): abre como foi guardado. Os novos são do X.</span><Button size="sm" variant="outline" className="mb-1" disabled={travado} onClick={() => trocarRede("twitter")}>Passar para post do X</Button></div>}
    {(erro || erroDasFontes) && <p role="alert" className="text-[12px] text-destructive">{erro || "Não foi possível ler as fotos selecionadas. Confira a ferramenta Fotos."}</p>}
    {conflitoDeTexto && <div role="status" className="space-y-2 text-[12px]"><p>O texto da lâmina mudou desde que você abriu este rascunho.</p><div className="flex flex-wrap"><Button size="sm" variant="outline" className="mb-1 mr-2" onClick={() => setAjustes((a) => ({ ...a, texto: textoDaLamina, texto_base: textoDaLamina }))}>Usar texto atual da lâmina</Button><Button size="sm" variant="ghost" className="mb-1" onClick={() => setAjustes((a) => ({ ...a, texto_base: textoDaLamina }))}>Manter minha edição</Button></div></div>}
    {fonteMudou && <div role="status" className={texto.auxiliar}>A imagem guardada saiu desta lâmina. <Button size="sm" variant="outline" onClick={() => escolherFonte(fonte || fontes[0])}>Usar imagem atual</Button></div>}
    {marcando && <p role="status" className={texto.auxiliar}>Clique no ponto exato da imagem no post.</p>}
  </div>;

  /** O post do X dentro do quadro da lâmina grande (o mesmo PNG que será guardado). */
  const blocoNaTela = ehLaminaDeVideo && pronto ? desenhoDoBloco?.bloco || null : null;
  const alturaDoQuadro = quadro?.height || 1350;
  const conteudo = () => <div className="relative h-full w-full" data-quadro-do-template="">
    <canvas ref={setQuadro} aria-label="Prévia do template Profile" className={juntar("block h-full w-full", marcando && "cursor-crosshair", !pronto && "hidden")} onClick={(e) => {
      if (!marcando || ocupado || bloqueado || !pronto || !rotuloValido || fonteMudou) return;
      const q = e.currentTarget, limites = q.getBoundingClientRect(), estilo = getComputedStyle(q);
      const esquerda = Number.parseFloat(estilo.borderLeftWidth) || 0, direita = Number.parseFloat(estilo.borderRightWidth) || 0;
      const topo = Number.parseFloat(estilo.borderTopWidth) || 0, baixo = Number.parseFloat(estilo.borderBottomWidth) || 0;
      const largura = limites.width - esquerda - direita, altura = limites.height - topo - baixo;
      const ponto = largura > 0 && altura > 0 ? pontoNaImagemProfile((e.clientX - limites.left - esquerda) * q.width / largura, (e.clientY - limites.top - topo) * q.height / altura, imagemNaPrevia.current) : null;
      if (!ponto) { setErro("Clique dentro da imagem real, fora das margens do template."); return; }
      setAjustes((a) => ({ ...a, ...referenciaDaFonteProfile(fonte), destaque: { ...ponto, rotulo: rotulo.trim() } })); setMarcando(false);
    }} />
    {/* Lâmina de vídeo: o vídeo toca no lugar exato do bloco (o mesmo retângulo do MP4); o som fica desligado, como no Instagram. */}
    {blocoNaTela && urlDaMidia.data && <video aria-label="Vídeo do bloco" src={urlDaMidia.data} muted loop autoPlay playsInline className="pointer-events-none absolute" data-video-do-bloco=""
      style={{ left: `${(blocoNaTela.x / 1080) * 100}%`, top: `${(blocoNaTela.y / alturaDoQuadro) * 100}%`, width: `${(blocoNaTela.largura / 1080) * 100}%`, height: `${(blocoNaTela.altura / alturaDoQuadro) * 100}%`, borderRadius: `${(blocoNaTela.raio / blocoNaTela.largura) * 100}% / ${(blocoNaTela.raio / blocoNaTela.altura) * 100}%`, objectFit: bloco?.enquadramento === "preencher" ? "cover" : "contain", objectPosition: `${Math.round((bloco?.foco_x ?? 0.5) * 100)}% ${Math.round((bloco?.foco_y ?? 0.5) * 100)}%` }} />}
    {ehLaminaDeVideo && pronto && <span className="pointer-events-none absolute bottom-[3%] right-[3%] inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground/70 text-background" title="Lâmina de vídeo (som desligado, como no Instagram)" data-lamina-de-video=""><VolumeX className="h-3.5 w-3.5" aria-hidden="true" /></span>}
    {!pronto && <p role="status" className={juntar(texto.auxiliar, "flex h-full items-center justify-center p-4 text-center")}>{fotosPendentes ? "Carregando fotos…" : erro || erroDasFontes ? "Prévia indisponível" : "Preencha nome e @ na ferramenta Template."}</p>}
  </div>;
  const centro = moldura ? moldura({ faixa, conteudo }) : <div className="min-w-0" data-previa-do-template="">{faixa}<div className="relative mx-auto w-full max-w-[540px]" style={{ paddingTop: "125%" }}><div className="absolute inset-0">{conteudo()}</div></div></div>;

  const destaqueDaImagem = fonte ? <div className="min-w-0 space-y-2">
    <div className="flex items-center"><span className={texto.rotulo}>Indicar botão ou ponto</span><AjudaRecolhida className="ml-1.5" rotulo="Como marcar um ponto na imagem">Escreva um rótulo e ative a marcação. Clique no botão ou ponto da imagem real no post do centro. O marcador usa essa posição no PNG; trocar de imagem remove a marcação.</AjudaRecolhida></div>
    <Input aria-label="Rótulo do ponto na imagem" placeholder="Ex.: Clique em Configurações" maxLength={60} value={rotulo} disabled={travado} onChange={(e) => { const valor = e.target.value; setRotulo(valor); if (ajustes.destaque) setAjustes((a) => ({ ...a, destaque: a.destaque ? { ...a.destaque, rotulo: valor } : undefined })); }} />
    <div className="flex flex-wrap"><Button size="sm" variant="outline" className="mb-1 mr-2" disabled={!pronto || !rotuloValido || fonteMudou || travado} aria-pressed={marcando} onClick={() => setMarcando((v) => !v)}>{marcando ? "Cancelar marcação" : "Marcar ponto na imagem"}</Button>{ajustes.destaque && <Button size="sm" variant="ghost" className="mb-1" disabled={travado} onClick={() => { setMarcando(false); setAjustes((a) => ({ ...a, destaque: undefined })); }}>Remover ponto</Button>}</div>
  </div> : null;

  const conteudoDoPerfil = <div className="space-y-4">
    {!livre && (perfil.data?.contas.length || 0) > 1 && <label className={juntar("block", texto.rotulo)}>Conta do perfil<select aria-label="Conta do Instagram do template" value={contaId || perfil.data?.conta_id || ""} disabled={travado} onChange={(e) => { setContaId(e.target.value); setAjustes((a) => ({ ...a, nome: null, username: null, foto_caminho: undefined, verificado: false })); }} className={juntar(campo, "mt-1")}>{perfil.data?.contas.map((c) => <option key={c.id} value={c.id}>@{c.username}</option>)}</select></label>}
    {!livre && perfil.isPending && <p role="status" className={texto.auxiliar}>Lendo o perfil de Redes…</p>}
    {!livre && (perfil.isError || perfil.data?.perfil.aviso) && <p role="status" className={texto.auxiliar}>{perfil.isError ? "Perfil indisponível: preencha os campos ou confira Redes." : perfil.data?.perfil.aviso}</p>}
    <div className="grid min-w-0 gap-3">
      <label className={juntar("block min-w-0", texto.rotulo)}>Nome de exibição<Input aria-label="Nome de exibição do template" value={nome} maxLength={120} disabled={travado} onChange={(e) => mudar("nome", e.target.value)} className="mt-1" /></label>
      <label className={juntar("block min-w-0", texto.rotulo)}>@ do perfil<Input aria-label="Perfil do Instagram do template" value={username} maxLength={31} disabled={travado} onChange={(e) => mudar("username", e.target.value)} className="mt-1" placeholder="nomedocliente" /></label>
    </div>
    {!livre && perfil.data?.perfil.username && <p className={texto.auxiliar}>Redes: @{perfil.data.perfil.username}{perfil.data.perfil.lido_em ? ` · lido em ${new Date(perfil.data.perfil.lido_em).toLocaleDateString("pt-BR")}` : ""}</p>}
    <input ref={upload} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Foto do perfil do template" onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarAvatar(f); e.target.value = ""; }} />
    <div className="flex flex-wrap items-center">
      <Button size="sm" variant="outline" className="mb-1 mr-2" disabled={travado} onClick={() => upload.current?.click()}><Upload className="mr-1 h-3.5 w-3.5" />Foto do perfil</Button>
      {ajustes.foto_caminho && <Button size="sm" variant="ghost" className="mb-1 mr-2" disabled={travado} onClick={() => setAjustes((a) => ({ ...a, foto_caminho: undefined }))}>{livre ? "Usar iniciais" : "Usar foto de Redes"}</Button>}
      <label className="mb-1 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={ajustes.verificado} disabled={travado} onChange={(e) => mudarSelo(e.target.checked)} />Exibir selo em todas as lâminas</label>
      <AjudaRecolhida className="mb-1 ml-1" rotulo="Quando usar o selo">Marque só quando o perfil do cliente tem verificação de verdade. O selo é desenho do template, não confirmação da rede.</AjudaRecolhida>
    </div>
    {!ehCarrossel && <div className="border-t border-border pt-3">
      <button type="button" aria-expanded={gerarAberto} onClick={() => setGerarAberto((v) => !v)} className={juntar(botao.discreto, "-ml-3.5")}><Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden="true" />Gerar conteúdo com IA</button>
      {gerarAberto && <div className="mt-2 space-y-3">
        <label className={juntar("block", texto.rotulo)}>Tema (opcional)<Input aria-label="Tema do conteúdo" value={tema} maxLength={600} disabled={travado} onChange={(e) => setTema(e.target.value)} placeholder="Sem tema, vale a pauta da lâmina" className="mt-1" /></label>
        {ajustes.estilo !== "instagram" && cardsOrdenados.length > 1 && <label className="flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={todas} disabled={travado} onChange={(e) => setTodas(e.target.checked)} />{ajustes.estilo === "twitter" ? `Fio: um post por lâmina (${cardsOrdenados.length})` : `Todas as telas (${cardsOrdenados.length})`}</label>}
        {ajustes.estilo !== "story" && <label className="flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={gravarLegenda} disabled={travado} onChange={(e) => setGravarLegenda(e.target.checked)} />Gravar também a legenda do post</label>}
        <div className="flex flex-wrap items-center">
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />{ajustes.estilo === "instagram" ? "Gerar a legenda" : quantasNoFio > 1 ? `Gerar ${quantasNoFio} ${ajustes.estilo === "story" ? "telas" : "posts"}` : "Gerar o texto"}</>}
            titulo="Gerar conteúdo do template"
            descricao="O redator do Estúdio escreve o texto no limite do X, com a voz da marca."
            partes={() => partesDoTextoDoTemplate(diretor?.id)}
            executar={gerarConteudo}
            sempreConfirmar
            disabled={travado}
          />
          <AjudaRecolhida className="ml-1.5" rotulo="Como funciona o gerar">Um post ou o fio inteiro, um post por lâmina, até 280 caracteres, com a voz da marca. O texto entra nos posts e você revisa antes de guardar. O custo aparece no botão e é confirmado no segundo clique.</AjudaRecolhida>
        </div>
        {avisosDoGerar.map((a) => <p key={a} role="status" className={juntar(texto.auxiliar, "text-warning")}>{a}</p>)}
      </div>}
    </div>}
  </div>;

  const grupos: GrupoDaFonte[] = ["gerada", "internet", "cliente"];
  const conteudoDaImagem = <div className="space-y-4">
    <div className="space-y-2">
      <label className={juntar("block", texto.rotulo)}>Imagem do post
        <select aria-label="Imagem real do template" className={juntar(campo, "mt-1")} disabled={travado} value={fonte ? chaveDaFonteProfile(fonte) : ""} onChange={(e) => escolherFonte(fontes.find((f) => chaveDaFonteProfile(f) === e.target.value))}>
          <option value="">Sem imagem</option>
          {grupos.map((g) => { const doGrupo = fontes.filter((f) => f.grupo === g); return doGrupo.length ? <optgroup key={g} label={ROTULO_DO_GRUPO[g]}>{doGrupo.map((f) => <option key={chaveDaFonteProfile(f)} value={chaveDaFonteProfile(f)}>{f.nome} · {f.origem}</option>)}</optgroup> : null; })}
        </select>
      </label>
      {fonte && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")} data-origem-da-imagem={fonte.grupo}><span className="font-medium text-foreground">{ROTULO_DO_GRUPO[fonte.grupo]}</span> · {fonte.origem}: {fonte.nome}{fonte.autor && <> · {fonte.autor}</>}{fonte.licenca && <> · {fonte.licenca}</>}{fonte.url && <> · <a href={fonte.url} target="_blank" rel="noopener noreferrer" className="underline">Abrir fonte da imagem</a></>}</p>}
      {!fonte && !ehInstagram && <p className={texto.auxiliar}>Sem imagem: {ajustes.estilo === "story" ? "Story de texto no fundo escolhido" : "post só com texto"}.</p>}
    </div>
    <div className="border-t border-border pt-3">
      <Segmentado<Origem> rotulo="De onde vem a imagem" opcoes={ORIGENS} valor={origem} onEscolher={(v) => setOrigem(v)} desativado={ocupado} />
      {origem === "gerar" && <div className="mt-2 space-y-3">
        <label className={juntar("block", texto.rotulo)}>O que a foto mostra<Textarea aria-label="Descrição da foto do post" value={descricaoDaFoto} maxLength={600} rows={3} disabled={travado} onChange={(e) => setDescricaoDaFoto(e.target.value)} className="mt-1" /></label>
        <p className={texto.auxiliar}>Foto {proporcaoDaFoto(ajustes)} sem texto, pelo gerador do Estúdio</p>
        {!trabalho.modelo_imagem_id ? <p role="status" className={texto.auxiliar}>Escolha o modelo de imagem na barra do Estúdio para gerar.</p> : <div className="flex flex-wrap items-center">
          <span className="mb-1 mr-2"><BotaoComCusto rotulo={<><IconeDeImagem className="mr-1.5 h-3.5 w-3.5" />Gerar foto</>} titulo="Gerar a foto do post" descricao="Uma foto sem texto, inteira na mídia do post." partes={() => partesDaFotoDoTemplate(trabalho.modelo_imagem_id, trabalho.qualidade)} executar={() => gerarFoto([card.ordem])} sempreConfirmar disabled={travado || !descricaoDaFoto.trim()} /></span>
          {laminasSemImagem.length > 0 && <span className="mb-1"><BotaoComCusto variant="outline" rotulo={`Gerar para os ${laminasSemImagem.length} posts sem imagem`} titulo="Gerar as fotos das lâminas" descricao="Uma foto por post sem imagem, a partir da pauta de cada um." partes={() => partesDaFotoDoTemplate(trabalho.modelo_imagem_id, trabalho.qualidade, laminasSemImagem.length)} executar={() => gerarFoto(laminasSemImagem.map((c) => c.ordem))} sempreConfirmar disabled={travado} /></span>}
        </div>}
      </div>}
      {origem === "internet" && <div className="mt-2"><ImagensReaisDoDiretor embutido trabalho={trabalho} ordem={card.ordem} bloqueado={travado} onAtualizar={onMudou} onAplicada={(f) => { if (f.caminho) { const caminho = f.caminho; setAjustes((a) => ({ ...a, imagem_caminho: caminho, imagem_acervo_id: undefined, destaque: undefined, sem_imagem: false })); } }} /></div>}
      {origem === "cliente" && <div className="mt-2 space-y-2">
        <p className={texto.auxiliar}>{fontes.filter((f) => f.grupo === "cliente").length ? `${fontes.filter((f) => f.grupo === "cliente").length} foto(s) do cliente neste post, na lista acima` : "Nenhuma foto do cliente neste post ainda"}</p>
        <Button size="sm" variant="outline" disabled={travado} onClick={onAbrirFotos}>Escolher em Fotos ou no acervo</Button>
      </div>}
    </div>
  </div>;

  const temas = ehX
    ? [{ valor: "claro" as const, rotulo: "Claro" }, { valor: "dim" as const, rotulo: "Dim" }, { valor: "escuro" as const, rotulo: "Escuro" }]
    : [{ valor: "claro" as const, rotulo: "Claro" }, { valor: "escuro" as const, rotulo: "Escuro" }];
  const numeros = ajustes.numeros || {};
  // Cores da marca: a paleta da marca aberta e a do kit lido em Redes, sem repetir; a cor livre fica no seletor.
  const coresDaMarca = Array.from(new Set([...(marca?.paleta || []).map((c) => (c.hex || "").toLowerCase()), ...(perfil.data?.kit?.paleta || []).map((c) => (c.hex || "").toLowerCase())].filter((h) => /^#[0-9a-f]{6}$/.test(h)))).slice(0, 8);
  const fundos = Array.from(new Set([...FUNDOS_PRONTOS.map((f) => f.cor as string), ...coresDaMarca]));
  type CampoNumerico = "tamanho_texto" | "tamanho_foto" | "midia" | "escala" | "espacamento" | "arredondamento";
  const regua = (c: { campo: CampoNumerico; rotulo: string; min: number; max: number; padrao: number; sufixo?: string }) => {
    const valor = (ajustes[c.campo] as number | undefined) ?? c.padrao;
    const ir = (d: number) => setAjustes((a) => ({ ...a, [c.campo]: Math.max(c.min, Math.min(c.max, ((a[c.campo] as number | undefined) ?? c.padrao) + d)) }));
    return <div key={c.campo} className="min-w-0">
      <div className="flex items-center"><span className={juntar(texto.rotulo, "min-w-0 flex-1")}>{c.rotulo} · {valor}{c.sufixo || ""}</span>
        <button type="button" className={botao.icone} aria-label={`Diminuir ${c.rotulo.toLowerCase()}`} title={`Diminuir ${c.rotulo.toLowerCase()}`} disabled={travado || valor <= c.min} onClick={() => ir(-2)}><Minus className="h-3.5 w-3.5" aria-hidden="true" /></button>
        <button type="button" className={botao.icone} aria-label={`Aumentar ${c.rotulo.toLowerCase()}`} title={`Aumentar ${c.rotulo.toLowerCase()}`} disabled={travado || valor >= c.max} onClick={() => ir(2)}><Plus className="h-3.5 w-3.5" aria-hidden="true" /></button>
      </div>
      <input aria-label={c.rotulo} type="range" min={c.min} max={c.max} value={valor} disabled={travado} onChange={(e) => setAjustes((a) => ({ ...a, [c.campo]: Number(e.target.value) }))} className="mt-1 w-full accent-primary" />
    </div>;
  };
  // 23/10 (dono: "ajustes mais intuitivos, tanto do Instagram quanto do X"): a aparência em três partes à
  // vista, Fundo, Texto e perfil, e Mídia, cada uma com o que muda nela.
  const subtitulo = (t: string) => <p className={juntar(texto.rotulo, "font-semibold text-foreground")}>{t}</p>;
  const conteudoDaAparencia = <div className="space-y-5">
    <div className="space-y-3" data-aparencia="fundo">
      {subtitulo("Fundo")}
      {ajustes.estilo !== "story" && <Segmentado rotulo="Tema do post" opcoes={temas} valor={ajustes.tema === "dim" && !ehX ? "escuro" : ajustes.tema} onEscolher={(t) => setAjustes((a) => ({ ...a, tema: t, cor_fundo: FUNDO_DO_TEMA[t] }))} desativado={travado} />}
      <div className="min-w-0">
        <p className={juntar(texto.rotulo, "mb-1.5")}>Cor de fundo da arte</p>
        <div role="group" aria-label="Cores de fundo" className="flex flex-wrap items-center">
          {fundos.map((cor) => <button key={cor} type="button" aria-label={`Fundo ${cor}${coresDaMarca.indexOf(cor) >= 0 ? " (cor da marca)" : ""}`} title={coresDaMarca.indexOf(cor) >= 0 ? `Cor da marca ${cor}` : FUNDOS_PRONTOS.find((f) => f.cor === cor)?.rotulo || cor} aria-pressed={ajustes.cor_fundo.toLowerCase() === cor} disabled={travado} onClick={() => mudar("cor_fundo", cor)} className={juntar("toque-compacto mb-1.5 mr-1.5 h-8 w-8 rounded-full border transition-shadow", ajustes.cor_fundo.toLowerCase() === cor ? "border-primary ring-2 ring-primary" : "border-border")} style={{ backgroundColor: cor }} />)}
          <label className="mb-1.5 inline-flex items-center text-[12px] text-muted-foreground">Livre<input aria-label="Cor de fundo do template" type="color" className="ml-1.5 h-8 w-10 cursor-pointer rounded-md border border-border bg-transparent" value={ajustes.cor_fundo} disabled={travado} onChange={(e) => mudar("cor_fundo", e.target.value)} /></label>
        </div>
        {coresDaMarca.length === 0 && <p className={texto.auxiliar}>Sem paleta da marca: use a cor livre.</p>}
      </div>
      <div className="grid min-w-0 gap-3">
        {regua({ campo: "escala", rotulo: "Escala do post", min: 50, max: 150, padrao: 100, sufixo: "%" })}
        {regua({ campo: "espacamento", rotulo: "Respiro em volta", min: 16, max: 96, padrao: 48 })}
        {regua({ campo: "arredondamento", rotulo: "Cantos do post", min: 0, max: 48, padrao: 24 })}
      </div>
    </div>
    <div className="space-y-3 border-t border-border pt-4" data-aparencia="texto">
      {subtitulo("Texto e perfil")}
      <div className="grid min-w-0 gap-3">
        {regua({ campo: "tamanho_texto", rotulo: "Tamanho do texto", min: 24, max: 56, padrao: 34 })}
        {ajustes.estilo !== "story" && regua({ campo: "tamanho_foto", rotulo: "Tamanho do avatar", min: 40, max: 120, padrao: 88 })}
      </div>
      <div className="flex flex-wrap">
        <label className="mb-1 mr-4 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={!ajustes.ocultar_numeros} disabled={travado} onChange={(e) => mudar("ocultar_numeros", e.target.checked ? undefined : true)} />Mostrar números</label>
        <label className="mb-1 mr-4 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={ajustes.verificado} disabled={travado} onChange={(e) => mudarSelo(e.target.checked)} />Mostrar selo</label>
        <label className="mb-1 mr-4 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={!ajustes.ocultar_tempo} disabled={travado} onChange={(e) => mudar("ocultar_tempo", e.target.checked ? undefined : true)} />Mostrar tempo</label>
        {ehX && cardsOrdenados.length > 1 && <label className="mb-1 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={!!ajustes.fio} disabled={travado} onChange={(e) => mudar("fio", e.target.checked || undefined)} />Linha do fio</label>}
      </div>
      <div className="grid min-w-0 gap-3">
        {!ajustes.ocultar_tempo && <label className={juntar("block min-w-0", texto.rotulo)}>Tempo<Input aria-label="Tempo do post" value={ajustes.tempo || ""} maxLength={24} disabled={travado} placeholder={TEMPO_PADRAO[ajustes.estilo]} onChange={(e) => mudar("tempo", e.target.value || undefined)} className="mt-1" /></label>}
        {ehInstagram && <label className={juntar("block min-w-0", texto.rotulo)}>Local<Input aria-label="Local do post" value={ajustes.local || ""} maxLength={60} disabled={travado} placeholder="Opcional" onChange={(e) => mudar("local", e.target.value || undefined)} className="mt-1" /></label>}
      </div>
      {ehX && !ajustes.ocultar_numeros && <div className="grid min-w-0 grid-cols-2 gap-3">
        <NumeroOpcional rotulo="Respostas" valor={numeros.respostas} onMudar={(v) => mudarNumero("respostas", v)} desativado={travado} />
        <NumeroOpcional rotulo="Reposts" valor={numeros.reposts} onMudar={(v) => mudarNumero("reposts", v)} desativado={travado} />
        <NumeroOpcional rotulo="Curtidas" valor={numeros.curtidas} onMudar={(v) => mudarNumero("curtidas", v)} desativado={travado} />
        <NumeroOpcional rotulo="Visualizações" valor={numeros.visualizacoes} onMudar={(v) => mudarNumero("visualizacoes", v)} desativado={travado} />
      </div>}
    </div>
    {ajustes.estilo !== "story" && <div className="space-y-3 border-t border-border pt-4" data-aparencia="midia">
      {subtitulo("Mídia")}
      <Segmentado rotulo="Proporção da mídia" opcoes={ehX ? [{ valor: "16:9", rotulo: "16:9" }, { valor: "1:1", rotulo: "1:1" }] : [{ valor: "4:5", rotulo: "4:5" }, { valor: "1:1", rotulo: "1:1" }]} valor={ajustes.proporcao || (ehX ? "16:9" : "4:5")} onEscolher={(p) => mudar("proporcao", p as TemplateProfile["proporcao"])} desativado={travado} />
      {ehX && <div className="grid min-w-0 gap-3">{regua({ campo: "midia", rotulo: "Tamanho da mídia", min: 40, max: 100, padrao: 100, sufixo: "%" })}</div>}
    </div>}
  </div>;

  // Rodada 3 (dono: "ser exatamente o Estúdio"): a ferramenta Template é uma seção aberta, como as outras
  // ferramentas do painel; sem abas próprias. Primeiro o desenho do post, depois a imagem, o perfil e o Gerar.
  const secao = (titulo: string, corpo: JSX.Element, primeira = false) => <section className={juntar("min-w-0 space-y-3", !primeira && "border-t border-border pt-4")} aria-label={titulo}><p className={juntar(texto.corpo, "font-semibold")}>{titulo}</p>{corpo}</section>;
  // O texto da lâmina, controlado pelo rascunho: cada tecla (Enter incluído) já redesenha a prévia e a miniatura.
  const editorDeTexto = <EditorDoTextoDaLamina trabalho={trabalho} card={card} total={cardsOrdenados.length} travado={travado} onMudou={onMudou}
    valor={ajustes.texto_editado} onMudar={(t) => setAjustes((a) => { if (t === null) { const { texto_editado: _t, ...resto } = a; return resto; } return { ...a, texto_editado: t }; })} />;
  const peca = <div className="space-y-3">
    {onModoTemplate && <Segmentado<"arte" | "x"> rotulo="No centro do Estúdio" opcoes={[{ valor: "arte", rotulo: "Arte da lâmina" }, { valor: "x", rotulo: ehCarrossel ? "Carrossel X" : "Post do X" }]} valor={modoTemplate ? "x" : "arte"} onEscolher={(v) => onModoTemplate(v === "x")} />}
    {(ehX || ehCarrossel) && <Segmentado<"twitter" | "carrossel"> rotulo="Modelo do template" opcoes={[{ valor: "twitter", rotulo: "Post com ações", dica: "O post do X dentro da lâmina, com as ações" }, { valor: "carrossel", rotulo: "Carrossel X", dica: "A lâmina inteira estilo post do X, com bloco de mídia" }]} valor={ehCarrossel ? "carrossel" : "twitter"} onEscolher={(v) => trocarRede(v)} desativado={travado} />}
    {cardsOrdenados.length > 1 && <Button size="sm" variant="outline" disabled={!podeGuardar} onClick={() => void salvar(true)}>Montar todas as lâminas</Button>}
    {/* 24/10: o campo próprio só no Instagram e no Story; no X e no Carrossel X o texto é o da lâmina (editor ao vivo). */}
    {!ehX && !ehCarrossel && <label className={juntar("block", texto.rotulo)}>{ehInstagram ? "Legenda do post" : "Texto do Story"}<Textarea aria-label="Texto do template" value={ajustes.texto} maxLength={2200} rows={5} disabled={travado} onChange={(e) => mudar("texto", e.target.value)} className="mt-1" /></label>}
    {ehX && editorDeTexto}
  </div>;
  const mudarBloco = (patch: Partial<BlocoDaLamina>) => setAjustes((a) => ({ ...a, bloco: { ...(a.bloco || blocoInicialDaLamina(cardDoCarrossel, salvo, mesa.clientId)), ...patch } }));
  const aoGerarCarrossel = (novo: TrabalhoGravado, soEsta = false) => {
    // As lâminas abrem com o texto novo e a mídia sugerida: os rascunhos antigos do trabalho saem
    // (só esta lâmina, quando o pedido foi "Preencher esta lâmina").
    if (!soEsta) esquecerRascunhos(`mesa:profile:v1:${mesa.clientId}:${marca?.id || "-"}:${trabalho.id}:`);
    // O gerador faz um carrossel: o modelo do trabalho passa a ser o Carrossel X.
    setModeloEscolhido("carrossel");
    const doCard = ((novo as unknown as Trabalho).direcao?.cards || []).find((c) => c.ordem === card.ordem) as CardDoCarrossel | undefined;
    setAjustes((a) => ({ ...a, estilo: "carrossel", texto: doCard?.texto_exato || a.texto, texto_base: doCard?.texto_exato || a.texto_base, bloco: doCard ? blocoInicialDaLamina(doCard, undefined, mesa.clientId) : a.bloco }));
  };
  if (ehCarrossel && parte !== "centro") {
    const painelDoCarrossel = <div className="min-w-0 space-y-4" data-ferramenta-template="" data-modelo-carrossel="">
      <PainelDoCarrossel trabalho={trabalho} card={card} cards={cardsOrdenados} fontes={fontes} bloco={bloco!} travado={travado}
        ajustes={{ tema: ajustes.tema, cor_fundo: ajustes.cor_fundo, tamanho_texto: ajustes.tamanho_texto, peso_texto: ajustes.peso_texto, seta: ajustes.seta, rodape_cinza: ajustes.rodape_cinza }}
        onBloco={mudarBloco} onAjuste={(k, v) => setAjustes((a) => ({ ...a, [k]: v }))} onMudou={onMudou} onGerado={aoGerarCarrossel} onAbrirFotos={onAbrirFotos} modeloSeletor={peca} coresDaMarca={coresDaMarca}
        perfilDeRedes={!livre && perfil.data && perfil.data.perfil.username ? perfil.data.perfil : null} verificado={!!ajustes.verificado} editorDeTexto={editorDeTexto}
        onAplicarATodas={cardsOrdenados.length > 1 ? (campos) => { aplicarATodas(aparenciaDe(Object.fromEntries(campos.map((k) => [k, ajustes[k]])) as Partial<TemplateProfile>)); toast.success(`Aplicado nas ${cardsOrdenados.length} lâminas`, { description: "Confira as miniaturas e use Montar todas as lâminas para guardar." }); } : undefined} />
      {secao("Perfil", conteudoDoPerfil)}
    </div>;
    if (parte === "painel") return <div aria-label="Ajustes do template" className="min-w-0">{painelDoCarrossel}</div>;
    return <div className="grid min-w-0 gap-6" aria-label="Template Profile">{centro}{painelDoCarrossel}</div>;
  }
  const painel = <div className="min-w-0 space-y-4" data-ferramenta-template="">
    {secao("Post do X", peca, true)}
    {secao("Aparência do post", conteudoDaAparencia)}
    {secao("Imagem do post", <div className="space-y-4">{conteudoDaImagem}{destaqueDaImagem}</div>)}
    {secao("Perfil e conteúdo", conteudoDoPerfil)}
  </div>;

  if (parte === "centro") return <>{centro}</>;
  if (parte === "painel") return <div aria-label="Ajustes do template" className="min-w-0">{painel}</div>;
  return <div className="grid min-w-0 gap-6" aria-label="Template Profile">{centro}{painel}</div>;
}
