import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Instagram, Loader2, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { extrairPaleta } from "@/lib/identidadeVisual";
import type { AlvoDoKit } from "@/lib/mesa/kitDaMarca";
import type { MarcaDoCliente } from "@/lib/mesa/marcas";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar, superficie, texto } from "@/components/sistema/estilos";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useAvisarErro } from "./Custo";
import { chavesDoKit, gravarNoKit } from "./kitDaMesa";
import { useInvalidarContexto, type CorDoKit, type KitDoContexto, type SugestaoDaMarcaMontada } from "./contextoDoCliente";
import { useMesa } from "./MesaContexto";

/**
 * Preencher o kit da marca sem trabalho (frente MC, 29/09). Dono: "no CME
 * aparece 'tem que procurar a logo' sabendo que a logo já está ali; eu posso
 * puxar do Instagram também".
 *
 * Mostra, numa linha só e recolhida no "?", o que o painel já achou para a
 * marca aberta: a logo nos arquivos (pasta com "logo" e o nome da marca, ou o
 * projeto dela), as cores lidas da própria logo (no navegador, sem custo), a
 * foto do Instagram ligado ao projeto dela e, se a equipe montou, o contexto
 * lido dos arquivos da marca. Nada é gravado sozinho: Confirmar grava na
 * linha da marca e Desfazer volta exatamente o que estava antes.
 */

export interface RespostaDaSugestaoDoKit {
  marca: { id: string; nome: string; principal: boolean };
  logo: {
    origem: "arquivo" | "workspace";
    id: string;
    nome: string;
    caminho: string;
    como: "unico" | "jev" | "nenhum";
    confianca: number | null;
    imagem: { bucket: string; caminho: string } | null;
  } | null;
  candidatos: { origem: "arquivo" | "workspace"; id: string; nome: string; caminho: string }[];
  instagram: { conta_id: string; username: string | null; foto_url: string | null } | null;
  tem_instagram: boolean;
}

const PAPEIS = ["principal", "secundaria", "destaque", "destaque", "destaque", "destaque"];

/** Cores da logo lidas no navegador (64 x 64 px basta), com papel na ordem da força. */
export async function coresDaImagem(blob: Blob, nomeDaMarca: string, quantas = 5): Promise<CorDoKit[]> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error("imagem"));
      i.src = url;
    });
    const lado = 64;
    const canvas = document.createElement("canvas");
    canvas.width = lado;
    canvas.height = lado;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, lado, lado);
    return extrairPaleta(ctx.getImageData(0, 0, lado, lado).data, quantas).map((c, i) => ({
      nome: `${nomeDaMarca} ${i + 1}`,
      hex: c.hex.toUpperCase(),
      papel: PAPEIS[i] || "destaque",
    }));
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** O que muda ao confirmar, guardado para o Desfazer (o valor exato de antes, campo a campo). */
type Antes = Record<string, unknown>;

export default function SugestaoDoKitDaMarca({
  marca,
  alvo,
  kit,
  montada,
  onDescartarMontada,
}: {
  marca: MarcaDoCliente;
  alvo: AlvoDoKit;
  kit: KitDoContexto | null | undefined;
  montada: SugestaoDaMarcaMontada | null;
  onDescartarMontada: () => void;
}) {
  const { clientId, userId } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const avisarErro = useAvisarErro();
  const [gravando, setGravando] = useState(false);
  const [antes, setAntes] = useState<Antes | null>(null);
  const [descartada, setDescartada] = useState<string | null>(null);

  const semLogo = !(kit && (kit.logo_path || kit.logo_file_id));
  const semPaleta = !(kit && Array.isArray(kit.paleta) && kit.paleta.length);
  const precisa = alvo.tabela === "cliente_marcas" && (semLogo || semPaleta);

  // Sem custo (o Jev só entra quando há mais de uma logo possível): o que já existe para a marca.
  const achado = useQuery({
    queryKey: ["mesa", "sugestao-do-kit", clientId, marca.id],
    enabled: precisa,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => chamarFuncao<RespostaDaSugestaoDoKit>("agente-contexto", { acao: "sugerir_kit_da_marca", client_id: clientId, marca_id: marca.id }),
  });

  const logo = achado.data && semLogo ? achado.data.logo : null;
  const imagemDaLogo = logo && logo.imagem ? logo.imagem : kit && kit.logo_path ? { bucket: "mesa", caminho: kit.logo_path } : null;

  // Cores lidas da logo (achada ou já gravada), no navegador e sem custo.
  const cores = useQuery({
    queryKey: ["mesa", "cores-da-logo", imagemDaLogo ? `${imagemDaLogo.bucket}:${imagemDaLogo.caminho}` : ""],
    enabled: !!imagemDaLogo && semPaleta,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(imagemDaLogo!.bucket).download(imagemDaLogo!.caminho);
      if (error || !data) return [] as CorDoKit[];
      return await coresDaImagem(data, marca.nome);
    },
  });
  const paletaSugerida = semPaleta ? (montada && montada.paleta.length ? montada.paleta : cores.data || []) : [];

  useEffect(() => {
    // Trocou de marca: o Desfazer da outra não vale aqui.
    setAntes(null);
  }, [marca.id]);

  const reler = () => {
    invalidar(clientId);
    for (const queryKey of chavesDoKit(clientId)) void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "sugestao-do-kit", clientId, marca.id] });
  };

  const confirmar = async () => {
    setGravando(true);
    // Foto do valor de antes, do jeito que está na linha da marca (não o efetivo).
    const guardado: Antes = {
      logo_path: marca.logo_path,
      logo_file_id: marca.logo_file_id,
      logo_tom: marca.logo_tom,
      paleta: marca.paleta,
      estilo: marca.estilo,
      regras: marca.regras,
      tom: marca.tom,
      contexto: marca.contexto,
    };
    try {
      if (logo) {
        await chamarFuncao("agente-contexto", { acao: "definir_logo", client_id: clientId, origem: logo.origem, id: logo.id, alternativa: false, marca_id: marca.id });
      }
      const campos: Record<string, unknown> = {};
      if (paletaSugerida.length) campos.paleta = paletaSugerida;
      if (montada) {
        campos.contexto = { ...(marca.contexto || {}), ...montada.contexto };
        if (montada.estilo && !marca.estilo) campos.estilo = montada.estilo;
        if (montada.regras && !marca.regras) campos.regras = montada.regras;
        if (montada.tom && !marca.tom) campos.tom = montada.tom;
      }
      if (Object.keys(campos).length) await gravarNoKit(alvo, campos, userId);
      setAntes(guardado);
      if (montada) onDescartarMontada();
      toast.success(`Kit da ${marca.nome} preenchido`, { description: "Confira na parte Marca. Desfazer volta o que estava." });
      reler();
    } catch (e) {
      avisarErro(e, `Kit da ${marca.nome} não preenchido`);
    } finally {
      setGravando(false);
    }
  };

  const desfazer = async () => {
    if (!antes) return;
    setGravando(true);
    try {
      await gravarNoKit(alvo, antes, userId);
      setAntes(null);
      toast.success("Desfeito", { description: `O kit da ${marca.nome} voltou ao que estava.` });
      reler();
    } catch (e) {
      avisarErro(e, "Não foi possível desfazer");
    } finally {
      setGravando(false);
    }
  };

  if (alvo.tabela !== "cliente_marcas") return null;

  if (antes) {
    return (
      <div className="flex min-w-0 items-center text-[13px]" data-sugestao-da-marca="feita">
        <p className="min-w-0 flex-1 truncate text-muted-foreground">Kit da {marca.nome} preenchido com o que já existia</p>
        <button type="button" className={juntar(botao.discreto, "h-8 px-2.5 text-[12px]")} onClick={() => void desfazer()} disabled={gravando}>
          {gravando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1 h-3.5 w-3.5" />}
          Desfazer
        </button>
      </div>
    );
  }

  const temAlgo = !!logo || paletaSugerida.length > 0 || !!montada;
  const chave = `${marca.id}:${logo ? logo.id : ""}:${paletaSugerida.map((c) => c.hex).join(",")}:${montada ? "m" : ""}`;
  if (!precisa && !montada) return null;
  if (descartada === chave) return null;

  if (achado.isLoading && !montada) {
    return (
      <p className="flex items-center text-[12px] text-muted-foreground">
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        Procurando a logo e as cores da {marca.nome} no que já existe...
      </p>
    );
  }

  const instagram = achado.data ? achado.data.instagram : null;
  const semInstagram = achado.data ? !achado.data.tem_instagram : false;

  if (!temAlgo) {
    return (
      <div className="flex min-w-0 items-center text-[12px] text-muted-foreground" data-sugestao-da-marca="vazia">
        <p className="min-w-0 truncate">
          {semLogo ? `Nenhuma logo da ${marca.nome} nos arquivos` : `Sem cores da ${marca.nome}`}
          {semInstagram ? ` e sem Instagram ligado ao projeto dela` : ""}
        </p>
        <AjudaRecolhida className="ml-1" rotulo="Como preencher o kit da marca">
          Procuro imagens com "logo" no caminho que citam a {marca.nome} ou estão no projeto dela. Envie a logo na parte Marca, puxe do Instagram
          dela pelo botão ao lado da logo, ou ligue a conta ao projeto da {marca.nome} em{" "}
          <Link to="/config" className="text-primary hover:underline">
            Integrações
          </Link>
          .
        </AjudaRecolhida>
      </div>
    );
  }

  return (
    <div className={juntar(superficie.poco, "min-w-0 p-2.5")} data-sugestao-da-marca={marca.id}>
      <div className="flex min-w-0 items-center">
        <Wand2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <p className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>Kit da {marca.nome} achado no que já existe</p>
        <AjudaRecolhida className="ml-1" rotulo="De onde veio">
          {logo ? `Logo: ${logo.caminho}${logo.como === "jev" ? " (escolhida pelo Jev entre os arquivos com logo)" : ""}. ` : ""}
          {paletaSugerida.length ? (montada && montada.paleta.length ? "Cores lidas dos arquivos da marca. " : "Cores lidas dos pixels da logo. ") : ""}
          {montada ? "Contexto, estilo, regras e tom lidos só dos arquivos e do dossiê da marca. " : ""}
          Nada da outra marca entra. Confirmar grava só na {marca.nome}; Desfazer volta o que estava.
        </AjudaRecolhida>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center">
        {logo && logo.imagem && (
          <div className="mb-1 mr-2 h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-card p-0.5">
            <MiniaturaDoStorage bucket={logo.imagem.bucket} caminho={logo.imagem.caminho} alt={`Logo da ${marca.nome}`} largura={160} ajuste="contain" className="h-full w-full" />
          </div>
        )}
        {paletaSugerida.length > 0 && (
          <div className="mb-1 mr-2 flex shrink-0 items-center" aria-label="Cores sugeridas">
            {paletaSugerida.slice(0, 6).map((c) => (
              <span key={c.hex} title={c.hex} className="mr-0.5 h-5 w-5 rounded-full border border-border" style={{ backgroundColor: c.hex }} />
            ))}
          </div>
        )}
        {montada && <span className={juntar(texto.auxiliar, "mb-1 mr-2")}>+ contexto, estilo, regras e tom</span>}
        {instagram && instagram.username && (
          <span className={juntar(texto.auxiliar, "mb-1 mr-2 flex items-center")}>
            <Instagram className="mr-1 h-3 w-3" aria-hidden="true" />@{instagram.username}
          </span>
        )}
        <div className="mb-1 ml-auto flex shrink-0 items-center">
          <button type="button" className={juntar(botao.discreto, "mr-1 h-8 px-2.5 text-[12px]")} onClick={() => { setDescartada(chave); if (montada) onDescartarMontada(); }} disabled={gravando}>
            Agora não
          </button>
          <button type="button" className={juntar(botao.primario, "h-8 px-3 text-[12px]")} onClick={() => void confirmar()} disabled={gravando || cores.isLoading}>
            {gravando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
