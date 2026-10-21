import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Expand, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { useMarcaDaMesa, useMesa, useUrlDaMesa } from "../MesaContexto";
import { chamarInstagram, normalizarPainel } from "../instagram/instagramApi";
import { useAcervo } from "../SeletorDoAcervo";
import { formatoDoTrabalho, gravarTrabalhoNoCache, useEstadoGuardado, type TrabalhoGravado } from "../estudioUtil";
import type { CardDaDirecao, CardGerado, Trabalho } from "../useItensDoMes";
import { carregarImagemProfile, desenharProfile, type FormatoProfile } from "./renderProfile";
import { fonteDoProfile } from "./fontesDoProfile";
import type { TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";

const ultimaVersao = (trabalho: Trabalho, ordem: number): CardGerado | undefined => trabalho.cards.filter((v) => v.ordem === ordem).sort((a, b) => b.versao - a.versao)[0];
const metadados = (versao: CardGerado | undefined): TemplateProfile | undefined => versao?.template_profile;
const PADRAO: Omit<TemplateProfile, "nome" | "username" | "texto"> = {
  versao: 1, estilo: "twitter", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 36, tamanho_foto: 76, espacamento: 30, arredondamento: 16,
};

/** O painel remonta por cliente/marca/trabalho: consultas pendentes nunca mostram o perfil anterior. */
export default function TemplateProfileEditor({ trabalho, card, bloqueado, onMudou, onAbrirFotos }: {
  trabalho: Trabalho; card: CardDaDirecao; bloqueado: boolean; onMudou: () => void; onAbrirFotos: () => void;
}) {
  const mesa = useMesa(), { marca } = useMarcaDaMesa(), cache = useQueryClient();
  bloqueado = bloqueado || ["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"].includes(trabalho.entrega_status || "");
  const livre = mesa.carteira === "laboratorio";
  const salvo = metadados(ultimaVersao(trabalho, card.ordem));
  const chave = `mesa:profile:v1:${mesa.clientId}:${marca?.id || "-"}:${trabalho.id}:${card.ordem}`;
  const [ajustes, setAjustes] = useEstadoGuardado(chave, { ...PADRAO, ...salvo, nome: salvo?.nome ?? null, username: salvo?.username ?? null, texto: salvo?.texto ?? card.texto_exato ?? "", texto_base: card.texto_exato || "" });
  const [contaId, setContaId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false), [pronto, setPronto] = useState(false), [erro, setErro] = useState("");
  const [andamento, setAndamento] = useState(""), [grande, setGrande] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), vivo = useRef(true), upload = useRef<HTMLInputElement>(null);
  const tentativas = useRef(new Map<string, string>());
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const perfil = useQuery({
    queryKey: ["mesa", "profile-template", mesa.clientId, marca?.id || "-", contaId],
    enabled: !!mesa.clientId && !livre, staleTime: 120_000, retry: 1,
    queryFn: async () => normalizarPainel(await chamarInstagram("painel", mesa.clientId, contaId ? { conta_id: contaId } : {})),
  });
  // IDs anexados pela equipe são escolhas explícitas, também no Livre. Isso não importa identidade.
  const acervo = useAcervo(!!trabalho.direcao.cards?.some((c) => c.imagens_ids?.length));
  const fonte = fonteDoProfile(card, acervo.data || []);
  const foto = useUrlDaMesa(fonte?.caminho, fonte?.bucket);
  const avatarGuardado = useUrlDaMesa(ajustes.foto_caminho);
  const nome = ajustes.nome ?? (!livre ? perfil.data?.perfil.nome : "") ?? "";
  const textoDesatualizado = ajustes.texto_base !== (card.texto_exato || "");
  const username = (ajustes.username ?? (!livre ? perfil.data?.perfil.username : "") ?? "").replace(/^@/, "");
  const perfilConfere = !!username && perfil.data?.perfil.username.toLowerCase() === username.toLowerCase();
  const avatarUrl = ajustes.foto_caminho ? avatarGuardado.data : !livre && perfilConfere ? perfil.data?.perfil.foto_url : null;
  const contaSalvaId = perfil.data?.contas.find((c) => c.username.toLowerCase() === username.toLowerCase())?.id;
  useEffect(() => {
    // O @ salvo pode pertencer à segunda conta: nunca combinar esse nome com o avatar da principal.
    if (!contaId && contaSalvaId && contaSalvaId !== perfil.data?.conta_id) setContaId(contaSalvaId);
  }, [contaId, contaSalvaId, perfil.data?.conta_id]);
  const formato = formatoDoTrabalho(trabalho.direcao as { formato?: unknown }) as FormatoProfile;
  const template: TemplateProfile = { ...ajustes, nome, username, ...(fonte?.bucket === "mesa" ? { imagem_caminho: fonte.caminho } : {}) };
  const assinatura = JSON.stringify(template);
  const fotosPendentes = (!!fonte && !foto.data) || (!!ajustes.foto_caminho && !avatarGuardado.data) || (!!card.imagens_ids?.length && acervo.isPending);
  const erroDasFontes = foto.isError || avatarGuardado.isError || acervo.isError;

  useEffect(() => {
    let atual = true; setPronto(false); setErro("");
    if (fotosPendentes || erroDasFontes) return;
    const dados = JSON.parse(assinatura) as TemplateProfile;
    if (!dados.nome.trim() || !/^[a-zA-Z0-9_.]{1,30}$/.test(dados.username) || !dados.texto.trim()) return;
    void Promise.all([avatarUrl ? carregarImagemProfile(avatarUrl) : null, foto.data ? carregarImagemProfile(foto.data) : null]).then(([avatar, imagem]) => {
      if (!atual || !canvas.current) return;
      desenharProfile(canvas.current, dados, formato, { avatar, imagem });
      // Também verifica CORS na prévia: nunca habilita Guardar para um canvas contaminado.
      canvas.current.toDataURL("image/png"); setPronto(true);
    }).catch((e: unknown) => { if (atual) setErro(textoDoErro(e)); });
    return () => { atual = false; };
  }, [assinatura, formato, avatarUrl, foto.data, fotosPendentes, erroDasFontes]);

  const mudar = (campo: keyof typeof ajustes, valor: string | number | boolean) => setAjustes((a) => ({ ...a, [campo]: valor }));
  const salvar = async (todas: boolean) => {
    if (!pronto || ocupado || bloqueado || textoDesatualizado) return;
    setOcupado(true); setErro(""); let feitas = 0;
    try {
      const ordens = todas ? trabalho.direcao.cards || [card] : [card];
      for (const c of ordens) {
        if (!vivo.current) break;
        setAndamento(`Montando ${feitas + 1} de ${ordens.length}`);
        const f = fonteDoProfile(c, acervo.data || []);
        if (c.imagens_ids?.length && !f && !c.fotos_livres?.length) throw new Error(`Escolha uma foto em Fotos para a lâmina ${c.ordem}.`);
        const cfg: TemplateProfile = { ...template, texto: c.ordem === card.ordem ? template.texto : c.texto_exato || "" };
        delete cfg.imagem_caminho;
        if (f?.bucket === "mesa") cfg.imagem_caminho = f.caminho;
        const imagemUrl = f ? await supabase.storage.from(f.bucket).createSignedUrl(f.caminho, 3600) : null;
        if (imagemUrl?.error) throw imagemUrl.error;
        const [avatar, imagem] = await Promise.all([avatarUrl ? carregarImagemProfile(avatarUrl) : null, imagemUrl?.data?.signedUrl ? carregarImagemProfile(imagemUrl.data.signedUrl) : null]);
        const quadro = document.createElement("canvas"); desenharProfile(quadro, cfg, formato, { avatar, imagem });
        const png = quadro.toDataURL("image/png").split(",")[1];
        const versao = ultimaVersao(trabalho, c.ordem)?.versao || 0;
        // A mesma tentativa após falha de rede usa o mesmo identificador; metadados mudados iniciam outra.
        const chaveDoPedido = JSON.stringify([c.ordem, versao, c.texto_exato || "", cfg, formato]);
        let pedidoId = tentativas.current.get(chaveDoPedido);
        if (!pedidoId) { pedidoId = crypto.randomUUID(); tentativas.current.set(chaveDoPedido, pedidoId); }
        const r = await chamarFuncao<{ trabalho: TrabalhoGravado }>("estudio-arte", { acao: "salvar_template", trabalho_id: trabalho.id, ordem: c.ordem, versao_esperada: versao, texto_base: c.texto_exato || "", pedido_id: pedidoId, png_base64: png, template: cfg });
        gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
        if (vivo.current && c.ordem === card.ordem) setAjustes((a) => ({ ...a, texto_base: cfg.texto }));
        feitas++;
      }
      if (vivo.current) toast.success(`${feitas === 1 ? "Template guardado como nova versão" : `${feitas} lâminas montadas`}`, { description: "Confira a peça na prancheta e continue em Entrega." });
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

  return <div className="space-y-4" aria-label="Template Profile">
    <p className="text-[12px] text-muted-foreground">Use o texto preparado pela IA e as fotos reais. A montagem do template não consome geração de imagem.</p>
    <fieldset disabled={ocupado || bloqueado} className="space-y-3 disabled:opacity-70">
      <label className="block text-[12px] font-medium">Template<select aria-label="Estilo do template" value={ajustes.estilo} onChange={(e) => mudar("estilo", e.target.value)} className="mt-1 w-full rounded-md border bg-background p-2 text-[13px]"><option value="twitter">Profile · Twitter</option><option value="instagram">Profile · Publicação Instagram</option></select></label>
      {!livre && (perfil.data?.contas.length || 0) > 1 && <label className="block text-[12px]">Conta do Instagram<select aria-label="Conta do Instagram do template" value={contaId || perfil.data?.conta_id || ""} onChange={(e) => { setContaId(e.target.value); setAjustes((a) => ({ ...a, nome: null, username: null, foto_caminho: undefined, verificado: false })); }} className="mt-1 w-full rounded-md border bg-background p-2">{perfil.data?.contas.map((c) => <option key={c.id} value={c.id}>@{c.username}</option>)}</select></label>}
      {!livre && perfil.isPending && <p role="status" className="text-[12px]">Lendo o perfil de Redes…</p>}
      {!livre && perfil.data?.perfil.username && <p className="text-[11px] text-muted-foreground">Perfil de Redes: @{perfil.data.perfil.username}{perfil.data.perfil.lido_em ? ` · leitura ${new Date(perfil.data.perfil.lido_em).toLocaleDateString("pt-BR")}` : ""}</p>}
      {!livre && (perfil.isError || perfil.data?.perfil.aviso) && <p role="status" className="text-[12px] text-muted-foreground">{perfil.isError ? "Perfil indisponível. Você pode preencher os campos ou conferir a aba Redes." : perfil.data?.perfil.aviso}</p>}
      <label className="block text-[12px]">Nome de exibição<Input aria-label="Nome de exibição do template" value={nome} maxLength={120} onChange={(e) => mudar("nome", e.target.value)} className="mt-1" /></label>
      <label className="block text-[12px]">@perfil do Instagram<Input aria-label="Perfil do Instagram do template" value={username} maxLength={31} onChange={(e) => mudar("username", e.target.value)} className="mt-1" placeholder="nomedocliente" /></label>
      <input ref={upload} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Foto do perfil do template" onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarAvatar(f); e.target.value = ""; }} />
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => upload.current?.click()}><Upload className="mr-1 h-3.5 w-3.5" />Foto do perfil</Button>{ajustes.foto_caminho && <Button size="sm" variant="ghost" onClick={() => setAjustes((a) => ({ ...a, foto_caminho: undefined }))}>{livre ? "Usar iniciais" : "Usar foto de Redes"}</Button>}</div>
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={ajustes.verificado} onChange={(e) => mudar("verificado", e.target.checked)} />Exibir selo no layout</label>
      <p className="text-[11px] text-muted-foreground">Marque o selo quando o perfil do cliente tiver verificação.</p>
      <label className="block text-[12px]">Texto da lâmina<Textarea aria-label="Texto do template" value={ajustes.texto} maxLength={1200} onChange={(e) => mudar("texto", e.target.value)} rows={5} className="mt-1" /></label>
      {textoDesatualizado && <div role="status" className="space-y-2 rounded-md border p-2 text-[12px]"><p>O texto da lâmina mudou desde que você abriu este rascunho.</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setAjustes((a) => ({ ...a, texto: card.texto_exato || "", texto_base: card.texto_exato || "" }))}>Usar texto atual da lâmina</Button><Button size="sm" variant="ghost" onClick={() => setAjustes((a) => ({ ...a, texto_base: card.texto_exato || "" }))}>Manter minha edição</Button></div></div>}
      <div className="flex items-center justify-between gap-2 text-[12px]"><span>{fonte ? "Foto real da lâmina" : "Template sem imagem"}</span><Button size="sm" variant="outline" onClick={onAbrirFotos}>Escolher em Fotos</Button></div>
      <label className="block text-[12px]">Tema<select aria-label="Tema do template" value={ajustes.tema} onChange={(e) => setAjustes((a) => ({ ...a, tema: e.target.value as "claro" | "escuro", cor_fundo: e.target.value === "escuro" ? "#0b0d11" : "#ffffff" }))} className="ml-2 rounded-md border bg-background p-1.5"><option value="claro">Claro</option><option value="escuro">Escuro</option></select></label>
      <label className="flex items-center justify-between text-[12px]">Cor de fundo<input aria-label="Cor de fundo do template" type="color" value={ajustes.cor_fundo} onChange={(e) => mudar("cor_fundo", e.target.value)} /></label>
      {([{ campo: "tamanho_texto", rotulo: "Tamanho do texto", min: 24, max: 56 }, { campo: "tamanho_foto", rotulo: "Tamanho do perfil", min: 40, max: 120 }, { campo: "espacamento", rotulo: "Espaçamento", min: 16, max: 96 }, { campo: "arredondamento", rotulo: "Cantos da imagem", min: 0, max: 48 }] as const).map((c) => <label key={c.campo} className="block text-[12px]">{c.rotulo} · {ajustes[c.campo]}<input aria-label={c.rotulo} type="range" min={c.min} max={c.max} value={ajustes[c.campo]} onChange={(e) => mudar(c.campo, Number(e.target.value))} className="mt-2 w-full accent-primary" /></label>)}
    </fieldset>
    <canvas ref={canvas} aria-label="Prévia do template Profile" className={`w-full rounded-lg border object-contain ${pronto ? "" : "hidden"}`} />
    {pronto && <Button size="sm" variant="ghost" onClick={() => { try { setGrande(canvas.current?.toDataURL("image/png") || null); } catch { setErro("A prévia não pôde ser ampliada."); } }}><Expand className="mr-1 h-3.5 w-3.5" />Ver prévia grande</Button>}
    {!pronto && !erro && !fotosPendentes && !erroDasFontes && <p role="status" className="text-[12px] text-muted-foreground">Preencha nome, @perfil e texto para ver a prévia.</p>}
    {fotosPendentes && <p role="status" className="text-[12px]">Carregando fotos…</p>}
    {(erro || erroDasFontes) && <p role="alert" className="text-[12px] text-destructive">{erro || "Não foi possível ler as fotos selecionadas. Confira a ferramenta Fotos."}</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!pronto || ocupado || bloqueado || textoDesatualizado} onClick={() => void salvar(false)}>{ocupado && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Guardar nova versão</Button>{(trabalho.direcao.cards?.length || 0) > 1 && <Button size="sm" variant="outline" disabled={!pronto || ocupado || bloqueado || textoDesatualizado} onClick={() => void salvar(true)}>Montar todas as lâminas</Button>}</div>
    {andamento && <p role="status" className="text-[12px]">{andamento}</p>}
    <Dialog open={!!grande} onOpenChange={(v) => !v && setGrande(null)}><DialogContent className="max-h-[95vh] max-w-4xl overflow-y-auto"><DialogTitle>Prévia do template</DialogTitle>{grande && <img src={grande} alt="Template Profile antes de guardar" className="mx-auto max-h-[82vh] w-auto object-contain" />}</DialogContent></Dialog>
  </div>;
}
