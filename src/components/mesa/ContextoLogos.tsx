import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { useAvisarErro } from "./Custo";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import NavegadorDePastas, { type ImagemEscolhida } from "./NavegadorDePastas";
import { useInvalidarContexto, type CandidatoALogo, type KitDoContexto } from "./contextoDoCliente";

/**
 * Logo principal e alternativa lado a lado: miniatura que abre maior, e
 * "Trocar" abre o navegador de pastas (Workspace, Arquivos ou acervo). A
 * escolha vai para a marca do cliente pelo agente de contexto (definir_logo,
 * sem custo). Usado no cartão Marca e no editor de Marca.
 */

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

/** Fundo de conferência da logo: xadrez (transparência), claro ou escuro. */
export type FundoDaLogo = "xadrez" | "claro" | "escuro";
const PROXIMO_FUNDO: Record<FundoDaLogo, FundoDaLogo> = { xadrez: "claro", claro: "escuro", escuro: "xadrez" };
const NOME_DO_FUNDO: Record<FundoDaLogo, string> = { xadrez: "xadrez", claro: "claro", escuro: "escuro" };

const XADREZ = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #ececec 25%, transparent 25%), linear-gradient(-45deg, #ececec 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ececec 75%), linear-gradient(-45deg, transparent 75%, #ececec 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
};

function estiloDoFundo(fundo: FundoDaLogo) {
  if (fundo === "claro") return { backgroundColor: "#ffffff" };
  if (fundo === "escuro") return { backgroundColor: "#141414" };
  return XADREZ;
}

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
      className={`group relative flex ${altura} w-full items-center justify-center overflow-hidden rounded-xl border border-border p-3 transition-shadow hover:shadow-md`}
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
  const { clientId, userId } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const avisarErro = useAvisarErro();
  const [escolhendo, setEscolhendo] = useState<QualLogo | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);
  const [tirando, setTirando] = useState<QualLogo | null>(null);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [fundos, setFundos] = useState<Record<QualLogo, FundoDaLogo>>({ logo: "xadrez", alt: "xadrez" });

  const principalPath = kit?.logo_path || null;
  const altPath = kit?.logo_alt_path || null;
  const principalArquivo = useArquivoDoPainel(principalPath ? null : kit?.logo_file_id || null);
  const altArquivo = useArquivoDoPainel(altPath ? null : kit?.logo_alt_file_id || null);

  const principal = principalPath ? { bucket: "mesa", caminho: principalPath } : imagemDoArquivo(principalArquivo.data);
  const alternativa = altPath ? { bucket: "mesa", caminho: altPath } : imagemDoArquivo(altArquivo.data);

  const ampliaveis: ImagemAmpliavel[] = [];
  if (principal) ampliaveis.push({ caminho: principal.caminho, bucket: principal.bucket, titulo: "Logo principal" });
  if (alternativa) ampliaveis.push({ caminho: alternativa.caminho, bucket: alternativa.bucket, titulo: "Logo alternativa" });

  const definir = async (qual: QualLogo, origem: string, id: string, nome?: string) => {
    const alternativaFlag = qual === "alt";
    setGravando(id);
    try {
      await chamarFuncao("agente-contexto", { acao: "definir_logo", client_id: clientId, origem, id, alternativa: alternativaFlag });
      toast.success(alternativaFlag ? "Logo alternativa definida" : "Logo definida", nome ? { description: nome } : undefined);
      setEscolhendo(null);
      invalidar(clientId);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "kit", clientId] });
    } catch (e) {
      avisarErro(e, "Logo não definida");
    } finally {
      setGravando(null);
    }
  };

  const tirar = async (qual: QualLogo) => {
    setTirando(qual);
    try {
      const patch = qual === "logo" ? { logo_path: null, logo_file_id: null } : { logo_alt_path: null, logo_alt_file_id: null };
      const { error } = await (supabase as any)
        .from("cliente_kit_marca")
        .upsert({ client_id: clientId, ...patch, atualizado_por: userId }, { onConflict: "client_id" });
      if (error) throw error;
      invalidar(clientId);
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
                fundo={fundos[t.qual]}
              />
              <div className="mt-1.5 flex min-w-0 items-center justify-between">
                <span className="min-w-0 truncate text-[12px] font-medium text-foreground">{t.rotulo}</span>
                <div className="ml-1 flex shrink-0 items-center">
                  {t.imagem && (
                    <button
                      type="button"
                      onClick={() => setFundos((f) => ({ ...f, [t.qual]: PROXIMO_FUNDO[f[t.qual]] }))}
                      title={`Fundo ${NOME_DO_FUNDO[fundos[t.qual]]}: trocar para ${NOME_DO_FUNDO[PROXIMO_FUNDO[fundos[t.qual]]]}`}
                      aria-label={`Conferir a ${t.rotulo.toLowerCase()} em fundo ${NOME_DO_FUNDO[PROXIMO_FUNDO[fundos[t.qual]]]}`}
                      className="mr-0.5 flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-border"
                        style={fundos[t.qual] === "escuro" ? { backgroundColor: "#141414" } : fundos[t.qual] === "claro" ? { backgroundColor: "#ffffff" } : { backgroundImage: "linear-gradient(90deg, #ffffff 50%, #141414 50%)" }}
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
        descricao="Só aparecem imagens. Ao clicar, a imagem é copiada para a marca do cliente e passa a valer para os agentes."
        onEscolher={(e: ImagemEscolhida) => {
          if (escolhendo) void definir(escolhendo, e.origem, e.id, e.nome);
        }}
        ocupado={!!gravando}
      />
      <Ampliar imagens={ampliaveis} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </div>
  );
}
