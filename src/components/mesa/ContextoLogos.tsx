import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Instagram, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { gravarCopiasSemEsperar } from "@/lib/miniaturas";
import { Button } from "@/components/ui/button";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { useAvisarErro } from "./Custo";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { alvoDoKit, type AlvoDoKit } from "@/lib/mesa/kitDaMarca";
import type { MarcaDoCliente } from "@/lib/mesa/marcas";
import { contasDaMarcaAberta } from "../../../supabase/functions/_shared/heranca-da-marca";
import { chavesDoKit, gravarNoKit } from "./kitDaMesa";
import NavegadorDePastas, { type ImagemEscolhida } from "./NavegadorDePastas";
import { useInvalidarContexto, type CandidatoALogo, type KitDoContexto } from "./contextoDoCliente";
import { useConferenciaDaLogo } from "./ConferenciaDaLogo";
import { estiloDoFundoDaLogo, fundoDeConferencia, tomGravado, useTomDaLogo, type FundoDaLogo, type TomDaLogo } from "./logoAnalise";
import { escolherIdentidadePrincipal } from "@/lib/identidadePrincipal";

/**
 * Logo principal e alternativa lado a lado: miniatura que abre maior, e
 * "Trocar" abre o navegador de pastas (Workspace, Arquivos ou acervo). A
 * escolha vai para a marca do cliente pelo agente de contexto (definir_logo,
 * sem custo). Usado no cartão Marca e no editor de Marca.
 *
 * Frente IG (28/09, pedido do dono): quando não há logo ou ela não é a certa,
 * "Instagram" puxa a foto do perfil do cliente direto (mesa-instagram,
 * foto_do_perfil, sem custo), passa pela mesma conferência de fundo e vira a
 * logo. A foto de perfil é pequena (cerca de 320 px): serve até chegar o
 * arquivo original.
 */

/**
 * Foto do perfil do Instagram da marca aberta (a conta que representa a
 * marca), guardada pelo robô de métricas. Com marcas (frente MC, 29/09): só
 * as contas ligadas ao projeto da marca (regra única de heranca-da-marca);
 * a CME nunca recebe a foto do @ da Acerbi. Sem conta da marca: null.
 */
export function useFotoDoInstagram(clientId: string, nomeDoCliente: string, marca: MarcaDoCliente | null = null, marcas: MarcaDoCliente[] = []) {
  return useQuery({
    queryKey: ["mesa", "foto-instagram", clientId, marca ? marca.id : ""],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ url: string | null; username: string | null; contaId: string | null } | null> => {
      const { data, error } = await (supabase as any)
        .from("social_client_identity")
        .select("client_id, external_account_id, username, profile_picture_url, captured_at")
        .eq("client_id", clientId);
      if (error || !data || !data.length) return null;
      let lista = data as any[];
      if (marca) {
        const lig = await (supabase as any).from("project_external_accounts").select("project_id, external_account_id").eq("client_id", clientId);
        const ligacoes = (lig.data || []) as { project_id: string; external_account_id: string }[];
        lista = contasDaMarcaAberta(
          lista.map((i) => ({ ...i, id: String(i.external_account_id) })),
          ligacoes,
          marca,
          marcas,
        );
        if (!lista.length) return null;
      }
      const escolhida = escolherIdentidadePrincipal(lista, marca && !marca.principal ? marca.nome : nomeDoCliente) as any;
      if (!escolhida) return null;
      return { url: escolhida.profile_picture_url || null, username: escolhida.username || null, contaId: escolhida.external_account_id || null };
    },
  });
}

export interface ArquivoDoPainel {
  id: string;
  file_name: string;
  file_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

export function useArquivoDoPainel(fileId: string | null | undefined) {
  return useQuery({
    queryKey: ["mesa", "arquivo", fileId],
    enabled: !!fileId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ArquivoDoPainel | null> => {
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, file_url, storage_bucket, storage_path")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      return (data as ArquivoDoPainel) || null;
    },
  });
}

/** Onde está a imagem de um arquivo do painel (bucket e caminho). */
export function imagemDoArquivo(a: ArquivoDoPainel | null | undefined): { bucket: string; caminho: string } | null {
  if (!a) return null;
  if (a.storage_bucket && a.storage_path) return { bucket: a.storage_bucket, caminho: a.storage_path };
  if (a.file_url && a.file_url.indexOf("://") > 0) return { bucket: "files", caminho: a.file_url };
  return null;
}

type QualLogo = "logo" | "alt";

/** Abre a imagem para desenhar no canvas; Safari 11 não tem createImageBitmap, então cai no <img>. */
async function abrirImagem(blob: Blob): Promise<{ width: number; height: number } & CanvasImageSource> {
  if (typeof createImageBitmap === "function") return await createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolver, rejeitar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rejeitar(new Error("O navegador não conseguiu abrir a logo."));
      img.src = url;
    });
  } finally {
    // Revoga depois do próximo quadro: o <img> já decodificou.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Lado máximo da logo reduzida no navegador (o Estúdio abre sem estourar a memória). */
export const LADO_MAXIMO_DA_LOGO = 2048;

/** Arquivo de logo pronto para subir: se passar de 2048 px, vira PNG reduzido; senão, vai como veio. */
export async function reduzirArquivoDeLogo(arquivo: Blob): Promise<{ blob: Blob; reduziu: boolean }> {
  const img = await abrirImagem(arquivo);
  const escala = LADO_MAXIMO_DA_LOGO / Math.max(img.width, img.height);
  if (escala >= 1) return { blob: arquivo, reduziu: false };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * escala));
  canvas.height = Math.max(1, Math.round(img.height * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: arquivo, reduziu: false };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png: Blob | null = await new Promise((resolver) => canvas.toBlob(resolver, "image/png"));
  return png ? { blob: png, reduziu: true } : { blob: arquivo, reduziu: false };
}

/**
 * Baixa a imagem escolhida, reduz para no máximo 2048 px (PNG, mantém a
 * transparência), grava em mesa/<cliente>/marca/ e aponta o kit do cliente
 * para ela. Usado quando o servidor recusa a logo por ser grande demais.
 */
export async function gravarLogoReduzida(clientId: string, userId: string | null | undefined, alternativa: boolean, bucket: string, caminho: string, alvo: AlvoDoKit = alvoDoKit(clientId, null)) {
  if (!bucket || !caminho) throw new Error("Não foi possível achar a imagem da logo para reduzir.");
  const { data, error } = await supabase.storage.from(bucket).download(caminho);
  if (error || !data) throw error || new Error("Não foi possível baixar a logo para reduzir.");
  const bitmap = await abrirImagem(data);
  const escala = Math.min(1, LADO_MAXIMO_DA_LOGO / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não conseguiu reduzir a logo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const png: Blob | null = await new Promise((resolver) => canvas.toBlob(resolver, "image/png"));
  if (!png) throw new Error("O navegador não conseguiu reduzir a logo.");
  const destino = `${pastaDaLogo(alvo)}/${alternativa ? "logo-alternativa" : "logo"}-${Date.now()}-reduzida.png`;
  const envio = await supabase.storage.from("mesa").upload(destino, png, { contentType: "image/png", upsert: true });
  if (envio.error) throw envio.error;
  gravarCopiasSemEsperar("mesa", destino, png, { mime: "image/png" });
  const campos = alternativa ? { logo_alt_path: destino, logo_alt_file_id: null } : { logo_path: destino, logo_file_id: null };
  await gravarNoKit(alvo, campos, userId);
}

/** Pasta da logo no bucket mesa: a do cliente (kit) ou a da marca (mesmo caminho de ContextoKitDaMarca). */
export function pastaDaLogo(alvo: AlvoDoKit): string {
  return alvo.tabela === "cliente_marcas" ? `${alvo.clientId}/marcas/${alvo.marcaId}` : `${alvo.clientId}/marca`;
}

/** Grava uma logo já pronta no navegador (PNG sem fundo ou reduzida) em mesa/<cliente>/marca/ e aponta o kit para ela. */
export async function gravarBlobDaLogo(clientId: string, userId: string | null | undefined, alternativa: boolean, png: Blob, sufixo: string, alvo: AlvoDoKit = alvoDoKit(clientId, null)) {
  const destino = `${pastaDaLogo(alvo)}/${alternativa ? "logo-alternativa" : "logo"}-${Date.now()}-${sufixo}.png`;
  const envio = await supabase.storage.from("mesa").upload(destino, png, { contentType: "image/png", upsert: true });
  if (envio.error) throw envio.error;
  gravarCopiasSemEsperar("mesa", destino, png, { mime: "image/png" });
  const campos = alternativa ? { logo_alt_path: destino, logo_alt_file_id: null } : { logo_path: destino, logo_file_id: null };
  await gravarNoKit(alvo, campos, userId);
}

/** Tom da logo no lugar do alvo (kit do cliente ou linha da marca). */
export function gravarTomNoAlvo(alvo: AlvoDoKit, alternativa: boolean, tom: TomDaLogo | null) {
  return alvo.tabela === "cliente_marcas"
    ? gravarTomDaLogo("cliente_marcas", { client_id: alvo.clientId, id: alvo.marcaId }, alternativa, tom)
    : gravarTomDaLogo("cliente_kit_marca", { client_id: alvo.clientId }, alternativa, tom);
}

/**
 * Guarda no kit se a logo é clara ou escura (logo_tom, logo_alt_tom), para as
 * mesas saberem sem ler a imagem de novo. Em separado e sem travar: sem a
 * coluna no banco (T-logo-tom.sql ainda não aplicado), só não guarda.
 */
export async function gravarTomDaLogo(tabela: "cliente_kit_marca" | "cliente_marcas", filtro: { client_id: string; id?: string }, alternativa: boolean, tom: TomDaLogo | null) {
  try {
    let q = (supabase as any).from(tabela).update({ [alternativa ? "logo_alt_tom" : "logo_tom"]: tom }).eq("client_id", filtro.client_id);
    if (filtro.id) q = q.eq("id", filtro.id);
    await q;
  } catch {
    /* coluna ainda não existe: a tela lê a imagem */
  }
}

/** Tons já guardados no kit do cliente; vazio quando a coluna ainda não existe. */
function useTonsGravados(clientId: string) {
  return useQuery({
    queryKey: ["mesa", "kit-tons", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<{ logo: TomDaLogo | null; alt: TomDaLogo | null } | null> => {
      const { data, error } = await (supabase as any).from("cliente_kit_marca").select("logo_tom, logo_alt_tom").eq("client_id", clientId).maybeSingle();
      if (error) return null;
      return { logo: tomGravado(data && data.logo_tom), alt: tomGravado(data && data.logo_alt_tom) };
    },
  });
}

/** Onde está, no Storage, a imagem escolhida no navegador de pastas (para ler antes de gravar). */
async function baixarEscolhida(clientId: string, origem: string, id: string): Promise<Blob | null> {
  const db = supabase as any;
  let onde: { bucket: string; caminho: string } | null = null;
  if (origem === "arquivo") {
    const { data } = await db.from("files").select("id, file_name, file_url, storage_bucket, storage_path, client_id").eq("id", id).maybeSingle();
    if (data && data.client_id === clientId) onde = imagemDoArquivo(data as ArquivoDoPainel);
  } else if (origem === "workspace") {
    const { data } = await db.from("workspace_nodes").select("client_id, storage_path").eq("id", id).maybeSingle();
    if (data && data.client_id === clientId && data.storage_path) onde = { bucket: "workspace", caminho: String(data.storage_path) };
  } else if (origem === "acervo") {
    const { data } = await db.from("cliente_imagens").select("client_id, storage_bucket, storage_path").eq("id", id).maybeSingle();
    if (data && data.client_id === clientId && data.storage_path) onde = { bucket: String(data.storage_bucket || "mesa"), caminho: String(data.storage_path) };
  }
  if (!onde) return null;
  const { data, error } = await supabase.storage.from(onde.bucket).download(onde.caminho);
  return error || !data ? null : data;
}

export type { FundoDaLogo };
const PROXIMO_FUNDO: Record<FundoDaLogo, FundoDaLogo> = { xadrez: "claro", claro: "escuro", escuro: "xadrez" };
const NOME_DO_FUNDO: Record<FundoDaLogo, string> = { xadrez: "xadrez", claro: "claro", escuro: "escuro" };
const estiloDoFundo = estiloDoFundoDaLogo;

function QuadroDaLogo({
  imagem,
  rotulo,
  carregando,
  onAmpliar,
  compacto,
  fundo,
}: {
  imagem: { bucket: string; caminho: string } | null;
  rotulo: string;
  carregando: boolean;
  onAmpliar: () => void;
  compacto: boolean;
  fundo: FundoDaLogo;
}) {
  const altura = compacto ? "h-24 sm:h-28" : "h-32";
  if (!imagem) {
    return (
      <div className={`flex ${altura} w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted text-[11.5px] text-muted-foreground`}>
        {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sem logo"}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onAmpliar}
      aria-label={`Ver ${rotulo.toLowerCase()} maior`}
      title="Ver maior"
      style={estiloDoFundo(fundo)}
      className={`group relative flex ${altura} w-full items-center justify-center overflow-hidden rounded-lg border border-border p-3 transition-colors hover:border-primary/60`}
    >
      <MiniaturaDoStorage bucket={imagem.bucket} caminho={imagem.caminho} alt={rotulo} largura={480} ajuste="contain" className="h-full w-full" />
      <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Maximize2 className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

export default function LogosDaMarca({
  kit,
  candidatos = [],
  compacto = false,
}: {
  kit: KitDoContexto | null | undefined;
  /** Arquivos com "logo" no nome, sugeridos pela leitura quando falta a logo. */
  candidatos?: CandidatoALogo[];
  compacto?: boolean;
}) {
  const { clientId, userId, clientName } = useMesa();
  const { marca, marcas } = useMarcaDaMesa();
  // Frente MC: com outra marca aberta (CME), tudo aqui grava na linha dela, nunca no kit do cliente.
  const alvo = alvoDoKit(clientId, marca);
  const daMarca = alvo.tabela === "cliente_marcas";
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const fotoIg = useFotoDoInstagram(clientId, clientName, marca, marcas);
  const reler = () => {
    invalidar(clientId);
    for (const queryKey of chavesDoKit(clientId)) void queryClient.invalidateQueries({ queryKey });
  };
  const [puxandoIg, setPuxandoIg] = useState<QualLogo | null>(null);
  const avisarErro = useAvisarErro();
  const [escolhendo, setEscolhendo] = useState<QualLogo | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);
  const [tirando, setTirando] = useState<QualLogo | null>(null);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  // Fundo de cada miniatura: null é automático (contraste com a logo); o botão ao lado troca à mão.
  const [fundos, setFundos] = useState<Record<QualLogo, FundoDaLogo | null>>({ logo: null, alt: null });
  const { conferir, dialogo: conferencia } = useConferenciaDaLogo();

  const principalPath = kit?.logo_path || null;
  const altPath = kit?.logo_alt_path || null;
  const principalArquivo = useArquivoDoPainel(principalPath ? null : kit?.logo_file_id || null);
  const altArquivo = useArquivoDoPainel(altPath ? null : kit?.logo_alt_file_id || null);

  const principal = principalPath ? { bucket: "mesa", caminho: principalPath } : imagemDoArquivo(principalArquivo.data);
  const alternativa = altPath ? { bucket: "mesa", caminho: altPath } : imagemDoArquivo(altArquivo.data);

  // Clara ou escura: o que está guardado no kit; sem isso, lido da própria imagem no navegador.
  const tons = useTonsGravados(daMarca ? "" : clientId);
  const tomPrincipalGravado = daMarca ? (principal ? tomGravado(kit && kit.logo_tom) : null) : principal && tons.data ? tons.data.logo : null;
  const tomAltGravado = daMarca ? (alternativa ? tomGravado(kit && kit.logo_alt_tom) : null) : alternativa && tons.data ? tons.data.alt : null;
  const esperandoTons = !daMarca && tons.isLoading;
  const lidaPrincipal = useTomDaLogo(esperandoTons ? null : principal, tomPrincipalGravado);
  const lidaAlt = useTomDaLogo(esperandoTons ? null : alternativa, tomAltGravado);
  const tomDe: Record<QualLogo, TomDaLogo | null> = {
    logo: tomPrincipalGravado || (lidaPrincipal.data ? lidaPrincipal.data.tom : null),
    alt: tomAltGravado || (lidaAlt.data ? lidaAlt.data.tom : null),
  };
  const fundoDe = (q: QualLogo): FundoDaLogo => fundos[q] || fundoDeConferencia(tomDe[q]);

  const ampliaveis: ImagemAmpliavel[] = [];
  if (principal) ampliaveis.push({ caminho: principal.caminho, bucket: principal.bucket, titulo: "Logo principal" });
  if (alternativa) ampliaveis.push({ caminho: alternativa.caminho, bucket: alternativa.bucket, titulo: "Logo alternativa" });

  const definir = async (qual: QualLogo, origem: string, id: string, nome?: string) => {
    const alternativaFlag = qual === "alt";
    setGravando(id);
    try {
      // Antes de gravar, a logo é lida aqui: fundo liso vira pergunta (tirar o fundo?)
      // e letra branca sobre branco pede a versão certa. Sem conseguir ler, grava como antes.
      const original = await baixarEscolhida(clientId, origem, id).catch(() => null);
      let tom: TomDaLogo | null = null;
      if (original) {
        const r = await conferir(original, nome);
        if (r.acao === "cancelar") return;
        if (r.acao === "outra") {
          toast.message("Escolha a logo em PNG transparente ou a versão para fundo escuro.");
          return;
        }
        tom = r.tom;
        if (r.semFundo) {
          await gravarBlobDaLogo(clientId, userId, alternativaFlag, r.blob, "sem-fundo", alvo);
          await gravarTomNoAlvo(alvo, alternativaFlag, tom);
          toast.success(alternativaFlag ? "Logo alternativa definida sem o fundo" : "Logo definida sem o fundo", nome ? { description: nome } : undefined);
          setEscolhendo(null);
          reler();
          return;
        }
      }
      try {
        await chamarFuncao("agente-contexto", {
          acao: "definir_logo",
          client_id: clientId,
          origem,
          id,
          alternativa: alternativaFlag,
          ...(alvo.tabela === "cliente_marcas" ? { marca_id: alvo.marcaId } : {}),
        });
      } catch (e) {
        // Logo gigante (26/09: 7813 x 7813 px derrubou o Estúdio): reduz aqui e grava a versão menor.
        const erro = e as { codigo?: string; detalhes?: Record<string, unknown> };
        if (erro && erro.codigo === "logo_grande_demais" && erro.detalhes) {
          await gravarLogoReduzida(clientId, userId, alternativaFlag, String(erro.detalhes.bucket || ""), String(erro.detalhes.caminho || ""), alvo);
          toast.message("A logo era grande demais e foi reduzida para 2048 px.");
        } else {
          throw e;
        }
      }
      await gravarTomNoAlvo(alvo, alternativaFlag, tom);
      toast.success(alternativaFlag ? "Logo alternativa definida" : "Logo definida", nome ? { description: nome } : undefined);
      setEscolhendo(null);
      reler();
    } catch (e) {
      avisarErro(e, "Logo não definida");
    } finally {
      setGravando(null);
    }
  };

  /** Puxa a foto do perfil do Instagram, confere o fundo e aponta o kit para ela. */
  const usarFotoDoInstagram = async (qual: QualLogo) => {
    const alternativaFlag = qual === "alt";
    setPuxandoIg(qual);
    try {
      if (marca && !(fotoIg.data && fotoIg.data.contaId)) {
        toast.message(`A ${marca.nome} não tem Instagram ligado ao projeto dela.`, {
          description: "Ligue a conta ao projeto da marca em Integrações. A foto de outra marca nunca entra aqui.",
        });
        return;
      }
      const r = await chamarFuncao<{ bucket: string; caminho: string; username?: string }>("mesa-instagram", {
        acao: "foto_do_perfil",
        client_id: clientId,
        ...(marca ? { marca_id: marca.id } : {}),
        ...(fotoIg.data && fotoIg.data.contaId ? { conta_id: fotoIg.data.contaId } : {}),
      });
      const nome = r.username ? `Foto do Instagram @${r.username}` : "Foto do Instagram";
      const { data: blob, error } = await supabase.storage.from(r.bucket).download(r.caminho);
      let tom: TomDaLogo | null = null;
      if (!error && blob) {
        const c = await conferir(blob, nome);
        if (c.acao === "cancelar") return;
        if (c.acao === "outra") {
          toast.message("A foto do perfil não serve como logo. Escolha a logo em PNG transparente.");
          return;
        }
        tom = c.tom;
        if (c.semFundo) {
          await gravarBlobDaLogo(clientId, userId, alternativaFlag, c.blob, "instagram-sem-fundo", alvo);
          await gravarTomNoAlvo(alvo, alternativaFlag, tom);
          toast.success("Logo puxada do Instagram, sem o fundo", { description: "A foto de perfil é pequena: troque pelo arquivo original quando tiver." });
          reler();
          return;
        }
      }
      const campos = alternativaFlag ? { logo_alt_path: r.caminho, logo_alt_file_id: null } : { logo_path: r.caminho, logo_file_id: null };
      await gravarNoKit(alvo, campos, userId);
      await gravarTomNoAlvo(alvo, alternativaFlag, tom);
      toast.success(alternativaFlag ? "Logo alternativa puxada do Instagram" : "Logo puxada do Instagram", { description: "A foto de perfil é pequena: troque pelo arquivo original quando tiver." });
      reler();
    } catch (e) {
      avisarErro(e, "Foto do Instagram não puxada");
    } finally {
      setPuxandoIg(null);
    }
  };

  const tirar = async (qual: QualLogo) => {
    setTirando(qual);
    try {
      const patch = qual === "logo" ? { logo_path: null, logo_file_id: null } : { logo_alt_path: null, logo_alt_file_id: null };
      await gravarNoKit(alvo, patch, userId);
      await gravarTomNoAlvo(alvo, qual === "alt", null);
      reler();
    } catch (e) {
      toast.error("Não foi possível tirar a logo", { description: textoDoErro(e) });
    } finally {
      setTirando(null);
    }
  };

  const tiles: { qual: QualLogo; rotulo: string; imagem: { bucket: string; caminho: string } | null; carregando: boolean }[] = [
    { qual: "logo", rotulo: "Principal", imagem: principal, carregando: principalArquivo.isLoading },
    { qual: "alt", rotulo: "Alternativa", imagem: alternativa, carregando: altArquivo.isLoading },
  ];

  return (
    <div className="min-w-0 space-y-2">
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        {tiles.map((t) => {
          const indice = t.imagem ? ampliaveis.findIndex((a) => a.caminho === t.imagem!.caminho) : -1;
          return (
            <div key={t.qual} className="min-w-0">
              <QuadroDaLogo
                imagem={t.imagem}
                rotulo={`Logo ${t.rotulo.toLowerCase()}`}
                carregando={t.carregando}
                onAmpliar={() => setAmpliada(indice >= 0 ? indice : 0)}
                compacto={compacto}
                fundo={fundoDe(t.qual)}
              />
              <div className="mt-1.5 flex min-w-0 items-center justify-between">
                <span className="min-w-0 truncate text-[12px] font-medium text-foreground">{t.rotulo}</span>
                <div className="ml-1 flex shrink-0 items-center">
                  {t.imagem && (
                    <button
                      type="button"
                      onClick={() => setFundos((f) => ({ ...f, [t.qual]: PROXIMO_FUNDO[f[t.qual] || fundoDe(t.qual)] }))}
                      title={`Fundo ${NOME_DO_FUNDO[fundoDe(t.qual)]}${fundos[t.qual] ? "" : " (automático, pela cor da logo)"}: trocar para ${NOME_DO_FUNDO[PROXIMO_FUNDO[fundoDe(t.qual)]]}`}
                      aria-label={`Conferir a ${t.rotulo.toLowerCase()} em fundo ${NOME_DO_FUNDO[PROXIMO_FUNDO[fundoDe(t.qual)]]}`}
                      className="mr-0.5 flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-border"
                        style={fundoDe(t.qual) === "xadrez" ? { backgroundImage: "linear-gradient(90deg, #ffffff 50%, #141414 50%)" } : estiloDoFundo(fundoDe(t.qual))}
                      />
                    </button>
                  )}
                  {!compacto && t.imagem && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11.5px]"
                      onClick={() => void tirar(t.qual)}
                      disabled={tirando === t.qual}
                    >
                      {tirando === t.qual && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Tirar
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11.5px]"
                    onClick={() => void usarFotoDoInstagram(t.qual)}
                    disabled={!!puxandoIg || !!gravando}
                    title={marca ? `Usar a foto do perfil do Instagram da ${marca.nome}` : "Usar a foto do perfil do Instagram do cliente"}
                    aria-label={`Usar a foto do Instagram como logo ${t.rotulo.toLowerCase()}`}
                  >
                    {puxandoIg === t.qual ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Instagram className="h-3.5 w-3.5" />}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => setEscolhendo(t.qual)}>
                    <FolderOpen className="mr-1 h-3.5 w-3.5" />
                    {t.imagem ? "Trocar" : "Escolher"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!principal && !principalArquivo.isLoading && fotoIg.data && fotoIg.data.url && (
        <div className="flex min-w-0 items-center rounded-lg border border-primary/30 bg-primary/5 p-2" data-logo-do-instagram="">
          <img src={fotoIg.data.url} alt="Foto do perfil do Instagram" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full border border-border object-cover" />
          <p className="mx-2 min-w-0 flex-1 text-[12px] leading-4 text-foreground">
            Sem logo? Use a foto do perfil do Instagram{fotoIg.data.username ? ` (@${fotoIg.data.username})` : ""}.
          </p>
          <Button type="button" size="sm" className="h-8 shrink-0 px-2.5 text-[12px]" onClick={() => void usarFotoDoInstagram("logo")} disabled={!!puxandoIg}>
            {puxandoIg === "logo" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Instagram className="mr-1 h-3.5 w-3.5" />}
            Usar como logo
          </Button>
        </div>
      )}

      {!principal && !principalArquivo.isLoading && candidatos.length > 0 && (
        <div className="min-w-0 rounded-lg border border-border bg-muted/60 p-2">
          <p className="mb-1.5 text-[11px] text-muted-foreground">Arquivos com "logo" no nome. Clique para usar como principal:</p>
          <div className="flex min-w-0 flex-wrap">
            {candidatos.slice(0, 6).map((c) => (
              <button
                key={`${c.origem}-${c.id}`}
                type="button"
                onClick={() => void definir("logo", c.origem, c.id, c.nome)}
                disabled={!!gravando}
                title={c.nome}
                className="mb-1 mr-1 flex max-w-full min-w-0 items-center rounded-full border border-border bg-card py-0.5 pl-2 pr-2.5 text-[11px] hover:border-primary/60 disabled:opacity-60"
              >
                {gravando === c.id && <Loader2 className="mr-1 h-3 w-3 shrink-0 animate-spin" />}
                <span className="min-w-0 truncate">{c.nome}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <NavegadorDePastas
        aberto={!!escolhendo}
        onOpenChange={(v) => {
          if (!v && !gravando) setEscolhendo(null);
        }}
        titulo={escolhendo === "alt" ? "Escolher a logo alternativa" : "Escolher a logo principal"}
        descricao={daMarca && marca ? `Só aparecem imagens. Ao clicar, a imagem vira a logo da ${marca.nome} (só dela) e passa a valer para os agentes.` : "Só aparecem imagens. Ao clicar, a imagem é copiada para a marca do cliente e passa a valer para os agentes."}
        onEscolher={(e: ImagemEscolhida) => {
          if (escolhendo) void definir(escolhendo, e.origem, e.id, e.nome);
        }}
        ocupado={!!gravando}
      />
      <Ampliar imagens={ampliaveis} indice={ampliada} onFechar={() => setAmpliada(null)} />
      {conferencia}
    </div>
  );
}
