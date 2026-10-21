import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Expand, Eye, Image as IconeDeImagem, LayoutTemplate, Loader2, Palette, Sparkles, Type, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import Etapas from "@/components/sistema/Etapas";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { useLargo } from "@/components/sistema/AreaDeTrabalho";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, padraoPara, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { useMarcaDaMesa, useMesa, useUrlDaMesa } from "../MesaContexto";
import { chamarInstagram, normalizarPainel } from "../instagram/instagramApi";
import { useAcervo } from "../SeletorDoAcervo";
import { BotaoComCusto } from "../Custo";
import ImagensReaisDoDiretor from "../ImagensReaisDoDiretor";
import { formatoDoTrabalho, gravarTrabalhoNoCache, useEstadoGuardado, type TrabalhoGravado } from "../estudioUtil";
import type { CardDaDirecao, CardGerado, Trabalho } from "../useItensDoMes";
import { carregarImagemProfile, desenharProfile, TEMPO_PADRAO, type FormatoProfile, type RetanguloProfile } from "./renderProfile";
import { chaveDaFonteProfile, fontesDoProfile, pontoNaImagemProfile, referenciaDaFonteProfile, resolverFonteProfile, ROTULO_DO_GRUPO, type CardComFontes, type FonteProfile, type GrupoDaFonte } from "./fontesDoProfile";
import { NumeroOpcional, Segmentado } from "./controlesDoTemplate";
import type { NumerosDoPost, TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";
import { limiteDoTexto } from "../../../../supabase/functions/estudio-arte/modulos/limites-do-post";

/**
 * Template do Estúdio (21/10/2026, dono: "melhore a nova aba de templates,
 * deixe no padrão e evolua ali com opção de gerar também"). Quatro etapas:
 * Conteúdo (rede, perfil, texto e o Gerar), Imagem (gerada pela casa, da
 * internet com licença ou do cliente), Aparência (recolhida) e Prévia e
 * guardar. No computador abre numa janela grande com a prévia ao lado; no
 * celular a prévia vem em cima e os controles embaixo. A moldura do post é
 * desenho (renderProfile); a foto entra inteira, nunca colada por cima.
 */

const ultimaVersao = (trabalho: Trabalho, ordem: number): CardGerado | undefined => trabalho.cards.filter((v) => v.ordem === ordem).sort((a, b) => b.versao - a.versao)[0];
const metadados = (versao: CardGerado | undefined): TemplateProfile | undefined => versao?.template_profile;
type Rede = TemplateProfile["estilo"];
type Etapa = "conteudo" | "imagem" | "aparencia" | "previa";
type Origem = "gerar" | "internet" | "cliente";
type Ajustes = Omit<TemplateProfile, "nome" | "username"> & { nome: string | null; username: string | null; texto_base: string; sem_imagem?: boolean };

const PADRAO: Omit<TemplateProfile, "nome" | "username" | "texto"> = {
  versao: 1, estilo: "twitter", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 34, tamanho_foto: 88, espacamento: 48, arredondamento: 24,
};
const REDES: Array<{ valor: Rede; rotulo: string; dica: string }> = [
  { valor: "twitter", rotulo: "Post do X", dica: "Post do X com nome, @, tempo, mídia e ações" },
  { valor: "instagram", rotulo: "Instagram", dica: "Post do feed do Instagram com legenda e carrossel" },
  { valor: "story", rotulo: "Story", dica: "Story 9:16 do Instagram com barras e cabeçalho" },
];
const FUNDO_DO_TEMA = { claro: "#ffffff", escuro: "#000000", dim: "#15202b" } as const;
const ORIGENS: Array<{ valor: Origem; rotulo: string }> = [
  { valor: "gerar", rotulo: "Gerar" },
  { valor: "internet", rotulo: "Internet" },
  { valor: "cliente", rotulo: "Do cliente" },
];
/** Proporção pedida ao gerador para a foto caber inteira na mídia do post. */
const proporcaoDaFoto = (t: Pick<TemplateProfile, "estilo" | "proporcao">): "16:9" | "1:1" | "4:5" | "9:16" =>
  t.estilo === "story" ? "9:16" : t.estilo === "instagram" ? (t.proporcao === "1:1" ? "1:1" : "4:5") : t.proporcao === "1:1" ? "1:1" : "16:9";

/** Partes da estimativa: uma chamada do redator do Estúdio; uma foto do gerador do trabalho. */
export const partesDoTextoDoTemplate = (diretorId: string | null | undefined): ParteDaEstimativa[] => [{ modeloId: diretorId, tipo: "texto", tokensEntrada: 9_000, tokensSaida: 3_000 }];
export const partesDaFotoDoTemplate = (modeloImagemId: string | null | undefined, qualidade: string | null | undefined, vezes = 1): ParteDaEstimativa[] => [
  { modeloId: modeloImagemId, tipo: "imagem", imagens: 1, qualidade: (qualidade === "baixa" || qualidade === "alta" ? qualidade : "media"), tokensEntrada: 1_500, vezes },
];

/** O painel remonta por cliente/marca/trabalho/lâmina: consultas pendentes nunca mostram o perfil anterior. */
export default function TemplateProfileEditor({ trabalho, card, bloqueado: bloqueadoDeFora, onMudou, onAbrirFotos, onEscolherLamina }: {
  trabalho: Trabalho; card: CardDaDirecao; bloqueado: boolean; onMudou: () => void; onAbrirFotos: () => void;
  /** Troca a lâmina aberta (setas da prévia). */
  onEscolherLamina?: (ordem: number) => void;
}) {
  const mesa = useMesa(), { marca } = useMarcaDaMesa(), cache = useQueryClient();
  const bloqueado = bloqueadoDeFora || ["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"].includes(trabalho.entrega_status || "");
  const livre = mesa.carteira === "laboratorio";
  const salvo = metadados(ultimaVersao(trabalho, card.ordem));
  const chave = `mesa:profile:v1:${mesa.clientId}:${marca?.id || "-"}:${trabalho.id}:${card.ordem}`;
  const [ajustes, setAjustes] = useEstadoGuardado<Ajustes>(chave, { ...PADRAO, ...salvo, nome: salvo?.nome ?? null, username: salvo?.username ?? null, texto: salvo?.texto ?? card.texto_exato ?? "", texto_base: card.texto_exato || "" });
  const [etapa, setEtapa] = useEstadoGuardado<Etapa>(`mesa:template:etapa:${trabalho.id}`, "conteudo");
  const [origem, setOrigem] = useEstadoGuardado<Origem>(`mesa:template:origem:${trabalho.id}`, "gerar");
  const largo = useLargo();
  const [janela, setJanela] = useState(largo);
  const [contaId, setContaId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false), [pronto, setPronto] = useState(false), [erro, setErro] = useState("");
  const [andamento, setAndamento] = useState(""), [grande, setGrande] = useState<string | null>(null), [miniatura, setMiniatura] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false), [rotulo, setRotulo] = useState(ajustes.destaque?.rotulo || "");
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
  const indice = Math.max(0, cardsOrdenados.findIndex((c) => c.ordem === card.ordem));
  const posicaoDe = (ordem: number) => ({ atual: Math.max(1, cardsOrdenados.findIndex((c) => c.ordem === ordem) + 1), total: Math.max(1, cardsOrdenados.length) });
  const fontes = fontesDoProfile(card as CardComFontes, acervo.data || [], mesa.clientId);
  const preferida = ajustes.sem_imagem ? undefined : resolverFonteProfile(fontes, ajustes);
  const fonte = ajustes.sem_imagem ? undefined : preferida || fontes[0];
  const fonteMudou = !ajustes.sem_imagem && (!preferida && !!(ajustes.imagem_acervo_id || ajustes.imagem_caminho) || !!ajustes.destaque && !ajustes.imagem_acervo_id && !ajustes.imagem_caminho);
  const foto = useUrlDaMesa(fonte?.caminho, fonte?.bucket);
  const avatarGuardado = useUrlDaMesa(ajustes.foto_caminho);
  const nome = ajustes.nome ?? (!livre ? perfil.data?.perfil.nome : "") ?? "";
  const textoDaLamina = card.texto_exato || "";
  const ehInstagram = ajustes.estilo === "instagram";
  // A legenda do Instagram não reescreve a lâmina: a base muda sozinha; no X e no Story, só sem edição da equipe.
  const textoDesatualizado = ajustes.texto_base !== textoDaLamina;
  const conflitoDeTexto = textoDesatualizado && !ehInstagram && ajustes.texto !== ajustes.texto_base;
  // Só quando o texto da lâmina chega diferente (abertura ou mudança de fora); o Gerar já põe o texto novo antes.
  const ultimoTextoDaLamina = useRef<string | null>(null);
  useEffect(() => {
    if (ultimoTextoDaLamina.current === textoDaLamina) return;
    ultimoTextoDaLamina.current = textoDaLamina;
    if (!textoDesatualizado || conflitoDeTexto) return;
    setAjustes((a) => ({ ...a, texto: a.estilo === "instagram" ? a.texto : textoDaLamina, texto_base: textoDaLamina }));
  }, [textoDesatualizado, conflitoDeTexto, textoDaLamina, setAjustes]);
  const username = (ajustes.username ?? (!livre ? perfil.data?.perfil.username : "") ?? "").replace(/^@/, "");
  const perfilConfere = !!username && perfil.data?.perfil.username.toLowerCase() === username.toLowerCase();
  const avatarUrl = ajustes.foto_caminho ? avatarGuardado.data : !livre && perfilConfere ? perfil.data?.perfil.foto_url : null;
  const contaSalvaId = perfil.data?.contas.find((c) => c.username.toLowerCase() === username.toLowerCase())?.id;
  useEffect(() => {
    // O @ salvo pode pertencer à segunda conta: nunca combinar esse nome com o avatar da principal.
    if (!contaId && contaSalvaId && contaSalvaId !== perfil.data?.conta_id) setContaId(contaSalvaId);
  }, [contaId, contaSalvaId, perfil.data?.conta_id]);
  const formato = formatoDoTrabalho(trabalho.direcao as { formato?: unknown }) as FormatoProfile;
  const { texto_base: _base, sem_imagem: _sem, ...semRascunho } = ajustes;
  const template: TemplateProfile = { ...semRascunho, nome, username, ...referenciaDaFonteProfile(fonte) };
  if (fonteMudou || !fonte) delete template.destaque;
  const assinatura = JSON.stringify(template);
  const posicao = posicaoDe(card.ordem);
  const fotosPendentes = (!!fonte && !foto.data) || (!!ajustes.foto_caminho && !avatarGuardado.data) || (!!card.imagens_ids?.length && acervo.isPending);
  const erroDasFontes = foto.isError || avatarGuardado.isError || acervo.isError;
  const rotuloValido = !!rotulo.trim() && rotulo.trim().length <= 60 && !/[\r\n\t<>]/.test(rotulo);
  const limite = limiteDoTexto(ajustes.estilo, ajustes.texto);
  const faltaImagemDoIG = ehInstagram && !fonte;
  const escolherFonte = (escolhida: FonteProfile | undefined) => {
    setMarcando(false);
    setAjustes((a) => ({ ...a, ...referenciaDaFonteProfile(escolhida), destaque: undefined, sem_imagem: !escolhida }));
  };

  useEffect(() => {
    let atual = true; setPronto(false); setErro(""); imagemNaPrevia.current = null;
    if (fotosPendentes || erroDasFontes || !quadro) return;
    const dados = JSON.parse(assinatura) as TemplateProfile;
    if (!dados.nome.trim() || !/^[a-zA-Z0-9_.]{1,30}$/.test(dados.username) || !dados.texto.trim()) return;
    void Promise.all([avatarUrl ? carregarImagemProfile(avatarUrl) : null, foto.data ? carregarImagemProfile(foto.data) : null]).then(([avatar, imagem]) => {
      if (!atual || !quadro) return;
      imagemNaPrevia.current = desenharProfile(quadro, dados, formato, { avatar, imagem, imagemExata: fonte?.exata, posicao })?.imagem || null;
      // Também verifica CORS na prévia: nunca habilita Guardar para um canvas contaminado.
      const png = quadro.toDataURL("image/png"); setPronto(true); setMiniatura(png);
    }).catch((e: unknown) => { if (atual) setErro(textoDoErro(e)); });
    return () => { atual = false; };
    // posicao é derivada de cards (atual/total), entra pela assinatura do conjunto.
  }, [assinatura, formato, avatarUrl, foto.data, fotosPendentes, erroDasFontes, fonte?.exata, quadro, posicao.atual, posicao.total]);

  const mudar = <K extends keyof Ajustes>(k: K, valor: Ajustes[K]) => setAjustes((a) => ({ ...a, [k]: valor }));
  const mudarNumero = (k: keyof NumerosDoPost, v: number | undefined) => setAjustes((a) => {
    const numeros = { ...(a.numeros || {}) };
    if (v === undefined) delete numeros[k]; else numeros[k] = v;
    return { ...a, numeros: Object.keys(numeros).length ? numeros : undefined };
  });
  const trocarRede = (rede: Rede) => setAjustes((a) => {
    if (a.estilo === rede) return a;
    const legenda = (trabalho.legenda || "").trim();
    // A legenda do post entra no Instagram só se a equipe não tinha mexido no texto da lâmina (e volta ao sair).
    const texto = rede === "instagram" && legenda && a.texto === a.texto_base ? legenda : a.estilo === "instagram" && legenda && a.texto === legenda ? a.texto_base : a.texto;
    const tema = rede !== "twitter" && a.tema === "dim" ? "escuro" : a.tema;
    const proporcao = rede === "instagram" ? (a.proporcao === "1:1" ? "1:1" : "4:5") : rede === "twitter" ? (a.proporcao === "1:1" ? "1:1" : "16:9") : undefined;
    return { ...a, estilo: rede, texto, tema, proporcao, cor_fundo: tema !== a.tema ? FUNDO_DO_TEMA[tema] : a.cor_fundo, destaque: undefined };
  });

  const salvar = async (todasAsLaminas: boolean) => {
    if (!pronto || ocupado || bloqueado || conflitoDeTexto || fonteMudou || faltaImagemDoIG) return;
    setOcupado(true); setErro(""); let feitas = 0;
    try {
      const ordens = todasAsLaminas ? cardsOrdenados : [card];
      for (const c of ordens) {
        if (!vivo.current) break;
        setAndamento(`Montando ${feitas + 1} de ${ordens.length}`);
        const disponiveis = fontesDoProfile(c as CardComFontes, acervo.data || [], mesa.clientId);
        const salvoDoCard = metadados(ultimaVersao(trabalho, c.ordem));
        const esta = c.ordem === card.ordem;
        const escolha = esta ? template : salvoDoCard;
        const f = esta && ajustes.sem_imagem ? undefined : resolverFonteProfile(disponiveis, escolha);
        if (!f && (escolha?.imagem_acervo_id || escolha?.imagem_caminho)) throw new Error(`A imagem guardada saiu da lâmina ${c.ordem}. Escolha novamente em seu Template.`);
        if (c.imagens_ids?.length && !f && !c.fotos_livres?.length && !(esta && ajustes.sem_imagem)) throw new Error(`Escolha uma foto em Fotos para a lâmina ${c.ordem}.`);
        if (template.estilo === "instagram" && !f) throw new Error(`A lâmina ${c.ordem} está sem imagem. O post do Instagram precisa de uma foto em cada lâmina.`);
        // No Instagram o texto é a legenda do post, a mesma em todas as lâminas do carrossel.
        const textoDoCard = esta || template.estilo === "instagram" ? template.texto : c.texto_exato || "";
        const cfg: TemplateProfile = { ...template, ...referenciaDaFonteProfile(f), texto: textoDoCard };
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
        const r = await chamarFuncao<{ trabalho: TrabalhoGravado }>("estudio-arte", { acao: "salvar_template", trabalho_id: trabalho.id, ordem: c.ordem, versao_esperada: versao, texto_base: c.texto_exato || "", pedido_id: pedidoId, png_base64: png, template: cfg });
        gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
        if (vivo.current && esta) setAjustes((a) => ({ ...a, ...referenciaDaFonteProfile(f), texto_base: template.estilo === "instagram" ? a.texto_base : cfg.texto }));
        feitas++;
      }
      if (vivo.current) toast.success(feitas === 1 ? "Template guardado como nova versão" : `${feitas} lâminas montadas`, { description: "Confira a peça na prancheta e continue em Entrega." });
    } catch (e) {
      if (vivo.current) setErro(`${feitas ? `${feitas} lâmina(s) já guardada(s). ` : ""}${textoDoErro(e)}`);
    } finally { onMudou(); if (vivo.current) { setOcupado(false); setAndamento(""); } }
  };

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
  const baixar = () => {
    if (!quadro || !pronto) return;
    try {
      const a = document.createElement("a");
      a.href = quadro.toDataURL("image/png"); a.download = `template-${ajustes.estilo === "twitter" ? "x" : ajustes.estilo}-lamina-${card.ordem}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch { setErro("O PNG não pôde ser baixado."); }
  };
  const ampliar = () => { try { setGrande(quadro?.toDataURL("image/png") || null); } catch { setErro("A prévia não pôde ser ampliada."); } };
  const outra = (passo: number) => { const c = cardsOrdenados[indice + passo]; if (c && onEscolherLamina) onEscolherLamina(c.ordem); };

  const previa = <div className="min-w-0 space-y-3" data-previa-do-template="">
    <div className="flex min-w-0 items-center">
      <p className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{cardsOrdenados.length > 1 ? `Lâmina ${indice + 1} de ${cardsOrdenados.length}` : "Prévia"} · {REDES.find((r) => r.valor === ajustes.estilo)?.rotulo}</p>
      {onEscolherLamina && cardsOrdenados.length > 1 && <>
        <button type="button" className={botao.icone} aria-label="Lâmina anterior" title="Lâmina anterior" disabled={indice <= 0 || ocupado} onClick={() => outra(-1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" className={botao.icone} aria-label="Próxima lâmina" title="Próxima lâmina" disabled={indice >= cardsOrdenados.length - 1 || ocupado} onClick={() => outra(1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </>}
      <button type="button" className={botao.icone} aria-label="Ver prévia grande" title="Ver prévia grande" disabled={!pronto} onClick={ampliar}><Expand className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" className={botao.icone} aria-label="Baixar PNG" title="Baixar PNG (1080 px, igual ao que será guardado)" disabled={!pronto} onClick={baixar}><Download className="h-4 w-4" aria-hidden="true" /></button>
    </div>
    {marcando && <p role="status" className={texto.auxiliar}>Clique no ponto exato da imagem na prévia.</p>}
    <div className="flex min-w-0 justify-center rounded-md bg-muted/50 p-2 sm:p-3">
      <canvas ref={setQuadro} aria-label="Prévia do template Profile" className={juntar("block h-auto max-h-[640px] w-auto max-w-full rounded-md", marcando && "cursor-crosshair", !pronto && "hidden")} onClick={(e) => {
        if (!marcando || ocupado || bloqueado || !pronto || !rotuloValido || fonteMudou) return;
        const q = e.currentTarget, limites = q.getBoundingClientRect(), estilo = getComputedStyle(q);
        const esquerda = Number.parseFloat(estilo.borderLeftWidth) || 0, direita = Number.parseFloat(estilo.borderRightWidth) || 0;
        const topo = Number.parseFloat(estilo.borderTopWidth) || 0, baixo = Number.parseFloat(estilo.borderBottomWidth) || 0;
        const largura = limites.width - esquerda - direita, altura = limites.height - topo - baixo;
        const ponto = largura > 0 && altura > 0 ? pontoNaImagemProfile((e.clientX - limites.left - esquerda) * q.width / largura, (e.clientY - limites.top - topo) * q.height / altura, imagemNaPrevia.current) : null;
        if (!ponto) { setErro("Clique dentro da imagem real, fora das margens do template."); return; }
        setAjustes((a) => ({ ...a, ...referenciaDaFonteProfile(fonte), destaque: { ...ponto, rotulo: rotulo.trim() } })); setMarcando(false);
      }} />
      {!pronto && <p role="status" className={juntar(texto.auxiliar, "py-16 text-center")}>{fotosPendentes ? "Carregando fotos…" : erro || erroDasFontes ? "Prévia indisponível" : "Preencha nome, @ e texto para ver a prévia."}</p>}
    </div>
    {(erro || erroDasFontes) && <p role="alert" className="text-[12px] text-destructive">{erro || "Não foi possível ler as fotos selecionadas. Confira a ferramenta Fotos."}</p>}
    {conflitoDeTexto && <div role="status" className="space-y-2 text-[12px]"><p>O texto da lâmina mudou desde que você abriu este rascunho.</p><div className="flex flex-wrap"><Button size="sm" variant="outline" className="mb-1 mr-2" onClick={() => setAjustes((a) => ({ ...a, texto: textoDaLamina, texto_base: textoDaLamina }))}>Usar texto atual da lâmina</Button><Button size="sm" variant="ghost" className="mb-1" onClick={() => setAjustes((a) => ({ ...a, texto_base: textoDaLamina }))}>Manter minha edição</Button></div></div>}
    {fonteMudou && <div role="status" className={texto.auxiliar}>A imagem guardada saiu desta lâmina. <Button size="sm" variant="outline" onClick={() => escolherFonte(fonte || fontes[0])}>Usar imagem atual</Button></div>}
    {faltaImagemDoIG && <p role="status" className={texto.auxiliar}>O post do Instagram precisa de uma foto: escolha na etapa Imagem.</p>}
    <div className="flex flex-wrap items-center">
      <Button size="sm" className="mb-1 mr-2" disabled={!pronto || travado || conflitoDeTexto || fonteMudou || faltaImagemDoIG} onClick={() => void salvar(false)}>{ocupado && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Guardar nova versão</Button>
      {andamento && <span role="status" className={juntar(texto.auxiliar, "mb-1")}>{andamento}</span>}
    </div>
  </div>;

  const conteudoDaRede = <div className="space-y-4">
    <Segmentado rotulo="Rede do template" opcoes={REDES} valor={ajustes.estilo} onEscolher={trocarRede} desativado={travado} />
    {!livre && (perfil.data?.contas.length || 0) > 1 && <label className={juntar("block", texto.rotulo)}>Conta do Instagram<select aria-label="Conta do Instagram do template" value={contaId || perfil.data?.conta_id || ""} disabled={travado} onChange={(e) => { setContaId(e.target.value); setAjustes((a) => ({ ...a, nome: null, username: null, foto_caminho: undefined, verificado: false })); }} className={juntar(campo, "mt-1")}>{perfil.data?.contas.map((c) => <option key={c.id} value={c.id}>@{c.username}</option>)}</select></label>}
    {!livre && perfil.isPending && <p role="status" className={texto.auxiliar}>Lendo o perfil de Redes…</p>}
    {!livre && (perfil.isError || perfil.data?.perfil.aviso) && <p role="status" className={texto.auxiliar}>{perfil.isError ? "Perfil indisponível: preencha os campos ou confira Redes." : perfil.data?.perfil.aviso}</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className={juntar("block min-w-0", texto.rotulo)}>Nome de exibição<Input aria-label="Nome de exibição do template" value={nome} maxLength={120} disabled={travado} onChange={(e) => mudar("nome", e.target.value)} className="mt-1" /></label>
      <label className={juntar("block min-w-0", texto.rotulo)}>@ do perfil<Input aria-label="Perfil do Instagram do template" value={username} maxLength={31} disabled={travado} onChange={(e) => mudar("username", e.target.value)} className="mt-1" placeholder="nomedocliente" /></label>
    </div>
    {!livre && perfil.data?.perfil.username && <p className={texto.auxiliar}>Redes: @{perfil.data.perfil.username}{perfil.data.perfil.lido_em ? ` · lido em ${new Date(perfil.data.perfil.lido_em).toLocaleDateString("pt-BR")}` : ""}</p>}
    <input ref={upload} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Foto do perfil do template" onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarAvatar(f); e.target.value = ""; }} />
    <div className="flex flex-wrap items-center">
      <Button size="sm" variant="outline" className="mb-1 mr-2" disabled={travado} onClick={() => upload.current?.click()}><Upload className="mr-1 h-3.5 w-3.5" />Foto do perfil</Button>
      {ajustes.foto_caminho && <Button size="sm" variant="ghost" className="mb-1 mr-2" disabled={travado} onClick={() => setAjustes((a) => ({ ...a, foto_caminho: undefined }))}>{livre ? "Usar iniciais" : "Usar foto de Redes"}</Button>}
      <label className="mb-1 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={ajustes.verificado} disabled={travado} onChange={(e) => mudar("verificado", e.target.checked)} />Exibir selo no layout</label>
      <AjudaRecolhida className="mb-1 ml-1" rotulo="Quando usar o selo">Marque só quando o perfil do cliente tem verificação de verdade. O selo é desenho do template, não confirmação da rede.</AjudaRecolhida>
    </div>
    <div className="space-y-1">
      <label className={juntar("block", texto.rotulo)}>{ehInstagram ? "Legenda do post" : ajustes.estilo === "story" ? "Texto do Story" : "Texto do post"}<Textarea aria-label="Texto do template" value={ajustes.texto} maxLength={2200} rows={ehInstagram ? 7 : 5} disabled={travado} onChange={(e) => mudar("texto", e.target.value)} className="mt-1" /></label>
      <p className={juntar(texto.auxiliar, limite.passou && "text-destructive")} role={limite.passou ? "alert" : undefined} data-limite-do-texto="">{limite.texto}</p>
    </div>
    <div className="border-t border-border pt-3">
      <button type="button" aria-expanded={gerarAberto} onClick={() => setGerarAberto((v) => !v)} className={juntar(botao.discreto, "-ml-3.5")}><Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden="true" />Gerar conteúdo com IA</button>
      {gerarAberto && <div className="mt-2 space-y-3">
        <label className={juntar("block", texto.rotulo)}>Tema (opcional)<Input aria-label="Tema do conteúdo" value={tema} maxLength={600} disabled={travado} onChange={(e) => setTema(e.target.value)} placeholder="Sem tema, vale a pauta da lâmina" className="mt-1" /></label>
        {ajustes.estilo !== "instagram" && cardsOrdenados.length > 1 && <label className="flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={todas} disabled={travado} onChange={(e) => setTodas(e.target.checked)} />{ajustes.estilo === "twitter" ? `Fio: um post por lâmina (${cardsOrdenados.length})` : `Todas as telas (${cardsOrdenados.length})`}</label>}
        {ajustes.estilo !== "story" && <label className="flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={gravarLegenda} disabled={travado} onChange={(e) => setGravarLegenda(e.target.checked)} />Gravar também a legenda do post</label>}
        <div className="flex flex-wrap items-center">
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />{ajustes.estilo === "instagram" ? "Gerar a legenda" : quantasNoFio > 1 ? `Gerar ${quantasNoFio} ${ajustes.estilo === "story" ? "telas" : "posts"}` : "Gerar o texto"}</>}
            titulo="Gerar conteúdo do template"
            descricao="O redator do Estúdio escreve o texto no limite da rede, com a voz da marca."
            partes={() => partesDoTextoDoTemplate(diretor?.id)}
            executar={gerarConteudo}
            sempreConfirmar
            disabled={travado}
          />
          <AjudaRecolhida className="ml-1.5" rotulo="Como funciona o gerar">X: um post ou o fio inteiro, um post por lâmina, até 280 caracteres. Instagram: a legenda com gancho nos 125 primeiros caracteres, corpo, CTA e hashtags. Story: um texto curto por tela. O texto entra nas lâminas e você revisa antes de guardar. O custo aparece no botão e é confirmado no segundo clique.</AjudaRecolhida>
        </div>
        {avisosDoGerar.map((a) => <p key={a} role="status" className={juntar(texto.auxiliar, "text-warning")}>{a}</p>)}
      </div>}
    </div>
  </div>;

  const grupos: GrupoDaFonte[] = ["gerada", "internet", "cliente"];
  const conteudoDaImagem = <div className="space-y-4">
    <div className="space-y-2">
      <label className={juntar("block", texto.rotulo)}>Imagem da lâmina
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
          {laminasSemImagem.length > 0 && <span className="mb-1"><BotaoComCusto variant="outline" rotulo={`Gerar para as ${laminasSemImagem.length} lâminas sem imagem`} titulo="Gerar as fotos das lâminas" descricao="Uma foto por lâmina sem imagem, a partir da pauta de cada uma." partes={() => partesDaFotoDoTemplate(trabalho.modelo_imagem_id, trabalho.qualidade, laminasSemImagem.length)} executar={() => gerarFoto(laminasSemImagem.map((c) => c.ordem))} sempreConfirmar disabled={travado} /></span>}
        </div>}
      </div>}
      {origem === "internet" && <div className="mt-2"><ImagensReaisDoDiretor embutido trabalho={trabalho} ordem={card.ordem} bloqueado={travado} onAtualizar={onMudou} onAplicada={(f) => { if (f.caminho) { const caminho = f.caminho; setAjustes((a) => ({ ...a, imagem_caminho: caminho, imagem_acervo_id: undefined, destaque: undefined, sem_imagem: false })); } }} /></div>}
      {origem === "cliente" && <div className="mt-2 space-y-2">
        <p className={texto.auxiliar}>{fontes.filter((f) => f.grupo === "cliente").length ? `${fontes.filter((f) => f.grupo === "cliente").length} foto(s) do cliente nesta lâmina, na lista acima` : "Nenhuma foto do cliente nesta lâmina ainda"}</p>
        <Button size="sm" variant="outline" disabled={travado} onClick={onAbrirFotos}>Escolher em Fotos ou no acervo</Button>
      </div>}
    </div>
    {fonte && <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center"><span className={texto.rotulo}>Indicar botão ou ponto</span><AjudaRecolhida className="ml-1.5" rotulo="Como marcar um ponto na imagem">Escreva um rótulo e ative a marcação. Clique no botão ou ponto da imagem real na prévia. O marcador usa essa posição no PNG; trocar de imagem remove a marcação.</AjudaRecolhida></div>
      <Input aria-label="Rótulo do ponto na imagem" placeholder="Ex.: Clique em Configurações" maxLength={60} value={rotulo} disabled={travado} onChange={(e) => { const valor = e.target.value; setRotulo(valor); if (ajustes.destaque) setAjustes((a) => ({ ...a, destaque: a.destaque ? { ...a.destaque, rotulo: valor } : undefined })); }} />
      <div className="flex flex-wrap"><Button size="sm" variant="outline" className="mb-1 mr-2" disabled={!pronto || !rotuloValido || fonteMudou || travado} aria-pressed={marcando} onClick={() => setMarcando((v) => !v)}>{marcando ? "Cancelar marcação" : "Marcar ponto na imagem"}</Button>{ajustes.destaque && <Button size="sm" variant="ghost" className="mb-1" disabled={travado} onClick={() => { setMarcando(false); setAjustes((a) => ({ ...a, destaque: undefined })); }}>Remover ponto</Button>}</div>
    </div>}
  </div>;

  const temas = ajustes.estilo === "twitter"
    ? [{ valor: "claro" as const, rotulo: "Claro" }, { valor: "dim" as const, rotulo: "Dim" }, { valor: "escuro" as const, rotulo: "Escuro" }]
    : [{ valor: "claro" as const, rotulo: "Claro" }, { valor: "escuro" as const, rotulo: "Escuro" }];
  const numeros = ajustes.numeros || {};
  const conteudoDaAparencia = <div className="space-y-4">
    {ajustes.estilo !== "story" && <Segmentado rotulo="Tema do post" opcoes={temas} valor={ajustes.tema === "dim" && ajustes.estilo !== "twitter" ? "escuro" : ajustes.tema} onEscolher={(t) => setAjustes((a) => ({ ...a, tema: t, cor_fundo: FUNDO_DO_TEMA[t] }))} desativado={travado} />}
    {ajustes.estilo !== "story" && <Segmentado rotulo="Proporção da mídia" opcoes={ajustes.estilo === "twitter" ? [{ valor: "16:9", rotulo: "16:9" }, { valor: "1:1", rotulo: "1:1" }] : [{ valor: "4:5", rotulo: "4:5" }, { valor: "1:1", rotulo: "1:1" }]} valor={ajustes.proporcao || (ajustes.estilo === "twitter" ? "16:9" : "4:5")} onEscolher={(p) => mudar("proporcao", p as TemplateProfile["proporcao"])} desativado={travado} />}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className={juntar("block min-w-0", texto.rotulo)}>Tempo<Input aria-label="Tempo do post" value={ajustes.tempo || ""} maxLength={24} disabled={travado} placeholder={TEMPO_PADRAO[ajustes.estilo]} onChange={(e) => mudar("tempo", e.target.value || undefined)} className="mt-1" /></label>
      {ehInstagram && <label className={juntar("block min-w-0", texto.rotulo)}>Local<Input aria-label="Local do post" value={ajustes.local || ""} maxLength={60} disabled={travado} placeholder="Opcional" onChange={(e) => mudar("local", e.target.value || undefined)} className="mt-1" /></label>}
      {ehInstagram && <label className={juntar("block min-w-0", texto.rotulo)}>Curtido por<Input aria-label="Curtido por" value={ajustes.curtido_por || ""} maxLength={31} disabled={travado} placeholder="@ opcional" onChange={(e) => mudar("curtido_por", e.target.value.replace(/^@/, "") || undefined)} className="mt-1" /></label>}
    </div>
    {ajustes.estilo === "twitter" && <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
      <NumeroOpcional rotulo="Respostas" valor={numeros.respostas} onMudar={(v) => mudarNumero("respostas", v)} desativado={travado} />
      <NumeroOpcional rotulo="Reposts" valor={numeros.reposts} onMudar={(v) => mudarNumero("reposts", v)} desativado={travado} />
      <NumeroOpcional rotulo="Curtidas" valor={numeros.curtidas} onMudar={(v) => mudarNumero("curtidas", v)} desativado={travado} />
      <NumeroOpcional rotulo="Visualizações" valor={numeros.visualizacoes} onMudar={(v) => mudarNumero("visualizacoes", v)} desativado={travado} />
    </div>}
    {ehInstagram && <div className="grid min-w-0 grid-cols-2 gap-3">
      <NumeroOpcional rotulo="Curtidas" valor={numeros.curtidas} onMudar={(v) => mudarNumero("curtidas", v)} desativado={travado} />
      <NumeroOpcional rotulo="Comentários" valor={numeros.comentarios} onMudar={(v) => mudarNumero("comentarios", v)} desativado={travado} />
    </div>}
    <div className="flex flex-wrap">
      {ajustes.estilo === "twitter" && cardsOrdenados.length > 1 && <label className="mb-1 mr-4 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={!!ajustes.fio} disabled={travado} onChange={(e) => mudar("fio", e.target.checked || undefined)} />Linha do fio entre os posts</label>}
      {ehInstagram && <label className="mb-1 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={!!ajustes.legenda_completa} disabled={travado} onChange={(e) => mudar("legenda_completa", e.target.checked || undefined)} />Legenda aberta (sem "mais")</label>}
    </div>
    <label className={juntar("flex items-center justify-between", texto.rotulo)}>Cor de fundo da arte<input aria-label="Cor de fundo do template" type="color" value={ajustes.cor_fundo} disabled={travado} onChange={(e) => mudar("cor_fundo", e.target.value)} /></label>
    {([{ campo: "tamanho_texto", rotulo: "Tamanho do texto", min: 24, max: 56 }, { campo: "tamanho_foto", rotulo: "Tamanho do perfil", min: 40, max: 120 }, { campo: "espacamento", rotulo: "Respiro em volta", min: 16, max: 96 }, { campo: "arredondamento", rotulo: "Cantos do post", min: 0, max: 48 }] as const).filter((c) => !(ajustes.estilo === "story" && c.campo === "tamanho_foto")).map((c) => <label key={c.campo} className={juntar("block", texto.rotulo)}>{c.rotulo} · {ajustes[c.campo]}<input aria-label={c.rotulo} type="range" min={c.min} max={c.max} value={ajustes[c.campo]} disabled={travado} onChange={(e) => mudar(c.campo, Number(e.target.value))} className="mt-2 w-full accent-primary" /></label>)}
  </div>;

  const checagens: Array<[boolean, string]> = [
    [!!nome.trim() && !!username, "Nome e @ do perfil"],
    [!!ajustes.texto.trim() && !limite.passou, limite.passou ? limite.texto : "Texto dentro do limite"],
    [!!fonte || !ehInstagram, fonte ? `Imagem: ${ROTULO_DO_GRUPO[fonte.grupo].toLowerCase()}` : ehInstagram ? "Falta a foto do post" : "Sem imagem"],
    [!conflitoDeTexto && !fonteMudou, "Rascunho em dia com a lâmina"],
  ];
  const conteudoDaPrevia = <div className="space-y-4">
    <ul className="space-y-1.5" aria-label="Antes de guardar">
      {checagens.map(([ok, rotuloDaChecagem]) => <li key={rotuloDaChecagem} className="flex items-center text-[12px]"><span aria-hidden="true" className={juntar("mr-2 inline-block h-2 w-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-warning")} />{rotuloDaChecagem}</li>)}
    </ul>
    <p className={texto.auxiliar}>PNG de 1080 × {({ feed_4x5: 1350, retrato_3x4: 1440, quadrado_1x1: 1080, stories_9x16: 1920 } as const)[formato]} px, o mesmo da prévia · sem custo de imagem</p>
    {cardsOrdenados.length > 1 && <Button size="sm" variant="outline" disabled={!pronto || travado || conflitoDeTexto || fonteMudou || faltaImagemDoIG} onClick={() => void salvar(true)}>Montar todas as lâminas</Button>}
  </div>;

  const etapas = [
    { valor: "conteudo", rotulo: "Conteúdo", icone: <Type className="h-4 w-4" />, ajuda: "Rede, perfil e texto. O Gerar escreve o post, o fio ou a legenda no limite da rede." },
    { valor: "imagem", rotulo: "Imagem", icone: <IconeDeImagem className="h-4 w-4" />, ajuda: "Foto gerada pela casa (sem texto), da internet com fonte e licença, ou do cliente. Entra inteira na mídia do post." },
    { valor: "aparencia", rotulo: "Aparência", icone: <Palette className="h-4 w-4" />, ajuda: "Tema, proporção, tempo, números e os ajustes de tamanho, cores, respiro e cantos." },
    { valor: "previa", rotulo: "Prévia e guardar", icone: <Eye className="h-4 w-4" />, ajuda: "Confira e guarde como nova versão da lâmina, ou monte todas de uma vez." },
  ];
  const controles = <div className="min-w-0 space-y-4">
    <Etapas soIcone itens={etapas} valor={etapa} onEscolher={(v) => setEtapa(v as Etapa)} rotulo="Etapas do template" />
    {etapa === "conteudo" ? conteudoDaRede : etapa === "imagem" ? conteudoDaImagem : etapa === "aparencia" ? conteudoDaAparencia : conteudoDaPrevia}
  </div>;
  const corpo = (lado: boolean): ReactNode => <div className={juntar("grid min-w-0 gap-6", lado && "lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]")} aria-label="Template Profile">
    <div className={juntar("min-w-0", lado ? "order-2 lg:order-1" : "order-2")}>{controles}</div>
    <div className={juntar("min-w-0", lado ? "order-1 lg:order-2 lg:sticky lg:top-0 lg:self-start" : "order-1")}>{previa}</div>
  </div>;
  const dialogoGrande = <JanelaCentral aberta={!!grande} onMudar={(v) => { if (!v) setGrande(null); }} titulo="Prévia do template" largura="xl" descricaoOculta="A peça como será guardada">{grande && <img src={grande} alt="Template antes de guardar" className="mx-auto max-h-[78vh] w-auto object-contain" />}</JanelaCentral>;

  if (largo) {
    return <div className="space-y-3">
      <div className="flex items-center"><span className={texto.auxiliar}>{REDES.find((r) => r.valor === ajustes.estilo)?.rotulo} · lâmina {card.ordem}</span><AjudaRecolhida className="ml-1.5" rotulo="Como funciona o Template">Monta o post como na rede (X, feed do Instagram ou Story), com a moldura desenhada e a foto inteira. Gerar o texto e a foto tem custo, mostrado antes. Guardar não gera imagem e não cobra.</AjudaRecolhida></div>
      {miniatura && <img src={miniatura} alt="Última prévia do template" className="w-full rounded-md bg-muted/50 object-contain" />}
      <Button size="sm" onClick={() => setJanela(true)}><LayoutTemplate className="mr-1.5 h-3.5 w-3.5" />Abrir o Template</Button>
      <JanelaCentral aberta={janela} onMudar={setJanela} titulo="Template" icone={<LayoutTemplate className="h-4 w-4" />} descricao={`${REDES.find((r) => r.valor === ajustes.estilo)?.rotulo} · lâmina ${card.ordem}${cardsOrdenados.length > 1 ? ` de ${cardsOrdenados.length}` : ""}`} ajuda="Conteúdo, imagem, aparência e prévia. A moldura do post é desenhada pelo Estúdio; a foto entra inteira, sem nada colado por cima. O PNG guardado é a prévia." largura="tela">
        {corpo(true)}
      </JanelaCentral>
      {dialogoGrande}
    </div>;
  }
  return <>{corpo(false)}{dialogoGrande}</>;
}
