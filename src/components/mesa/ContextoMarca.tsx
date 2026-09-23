import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useResolvedFileUrl } from "@/lib/fileUrls";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { useAvisarErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import NavegadorDePastas, { Quadrado, type ImagemEscolhida } from "./NavegadorDePastas";
import { Campo, TituloDeSecao } from "./Seletores";
import { useInvalidarContexto } from "./contextoDoCliente";

interface Cor {
  nome: string;
  hex: string;
  papel: string;
}

const PAPEIS_DA_COR = [
  { valor: "principal", rotulo: "Principal" },
  { valor: "secundaria", rotulo: "Secundária" },
  { valor: "destaque", rotulo: "Destaque" },
  { valor: "fundo", rotulo: "Fundo" },
  { valor: "texto", rotulo: "Texto" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

interface ArquivoDeImagem {
  id: string;
  file_name: string;
  file_url: string;
  storage_bucket: string | null;
  storage_path: string | null;
}

function Miniatura({ arquivo, className = "" }: { arquivo: ArquivoDeImagem; className?: string }) {
  const { url } = useResolvedFileUrl({
    fileUrl: arquivo.file_url,
    storageBucket: arquivo.storage_bucket,
    storagePath: arquivo.storage_path,
    transform: { width: 240, height: 240, resize: "contain" },
  });
  if (!url) return <div className={`animate-pulse bg-muted ${className}`} />;
  return <img src={url} alt={arquivo.file_name} loading="lazy" className={`object-contain ${className}`} />;
}

/** Logo antiga, escolhida por id de Arquivos antes da logo de qualquer pasta. */
function LogoAntiga({ fileId }: { fileId: string }) {
  const arquivo = useQuery({
    queryKey: ["mesa", "arquivo", fileId],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ArquivoDeImagem | null> => {
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, file_url, storage_bucket, storage_path")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      return (data as ArquivoDeImagem) || null;
    },
  });
  if (!arquivo.data) return <div className={`h-full w-full bg-muted ${arquivo.isLoading ? "animate-pulse" : ""}`} />;
  return <Miniatura arquivo={arquivo.data} className="h-full w-full p-1.5" />;
}

type QualLogo = "logo" | "alt";

function CartaoDaLogo({
  rotulo,
  dica,
  caminho,
  fileIdAntigo,
  onEscolher,
  onTirar,
  tirando,
}: {
  rotulo: string;
  dica: string;
  caminho: string | null;
  fileIdAntigo: string | null;
  onEscolher: () => void;
  onTirar: () => void;
  tirando: boolean;
}) {
  const tem = !!caminho || !!fileIdAntigo;
  return (
    <div className="flex min-w-0 items-center rounded-xl border border-border bg-card p-3">
      <div className="mr-3 w-20 shrink-0">
        <Quadrado className="border border-border">
          {caminho ? (
            <ImagemDaMesa caminho={caminho} alt={rotulo} className="h-full w-full !object-contain p-1.5" />
          ) : fileIdAntigo ? (
            <LogoAntiga fileId={fileIdAntigo} />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[10.5px] text-muted-foreground">vazio</span>
          )}
        </Quadrado>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium">{rotulo}</p>
        <p className="text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{tem ? "Definida. Os agentes usam esta imagem." : dica}</p>
        <div className="mt-2 flex flex-wrap">
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8 text-[12px]" onClick={onEscolher}>
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" /> {tem ? "Trocar" : "Escolher"}
          </Button>
          {tem && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" onClick={onTirar} disabled={tirando}>
              {tirando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Tirar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ContextoMarca() {
  const { clientId, userId } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const avisarErro = useAvisarErro();
  const [paleta, setPaleta] = useState<Cor[]>([]);
  const [estilo, setEstilo] = useState("");
  const [regras, setRegras] = useState("");
  const [escolhendo, setEscolhendo] = useState<QualLogo | null>(null);
  const [gravandoLogo, setGravandoLogo] = useState(false);
  const [tirando, setTirando] = useState<QualLogo | null>(null);
  const [salvando, setSalvando] = useState(false);

  const kit = useQuery({
    queryKey: ["mesa", "kit", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cliente_kit_marca").select("*").eq("client_id", clientId).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    const k = kit.data;
    setPaleta(Array.isArray(k?.paleta) ? k.paleta : []);
    setEstilo(k?.estilo || "");
    setRegras(k?.regras || "");
  }, [kit.data]);

  const mudarCor = (i: number, campo: keyof Cor, valor: string) =>
    setPaleta((p) => p.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)));

  // A logo é gravada na hora pelo agente de contexto (definir_logo): o salvar
  // abaixo cuida só de paleta, estilo e regras e não mexe na logo.
  const salvar = async () => {
    const invalida = paleta.find((c) => !HEX.test(c.hex));
    if (invalida) {
      toast.error(`A cor "${invalida.nome || invalida.hex}" precisa estar no formato #RRGGBB.`);
      return;
    }
    setSalvando(true);
    try {
      const { error } = await (supabase as any).from("cliente_kit_marca").upsert(
        {
          client_id: clientId,
          paleta: paleta.map((c) => ({ nome: c.nome.trim(), hex: c.hex.toUpperCase(), papel: c.papel })),
          estilo: estilo.trim() || null,
          regras: regras.trim() || null,
          atualizado_por: userId,
        },
        { onConflict: "client_id" },
      );
      if (error) throw error;
      toast.success("Kit de marca salvo");
      invalidar(clientId);
    } catch (e) {
      toast.error("Kit não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const escolherLogo = async (escolha: ImagemEscolhida) => {
    if (!escolhendo) return;
    const alternativa = escolhendo === "alt";
    setGravandoLogo(true);
    try {
      await chamarFuncao("agente-contexto", { acao: "definir_logo", client_id: clientId, origem: escolha.origem, id: escolha.id, alternativa });
      toast.success(alternativa ? "Logo alternativa definida" : "Logo definida", { description: escolha.nome });
      setEscolhendo(null);
      invalidar(clientId);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "kit", clientId] });
    } catch (e) {
      avisarErro(e, "Logo não definida");
    } finally {
      setGravandoLogo(false);
    }
  };

  const tirarLogo = async (qual: QualLogo) => {
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

  const k = kit.data || {};

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <TituloDeSecao
          acao={
            <Button type="button" size="sm" variant="ghost" onClick={() => setPaleta((p) => p.concat([{ nome: "", hex: "#00C853", papel: "principal" }]))}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Cor
            </Button>
          }
        >
          Paleta
        </TituloDeSecao>
        {paleta.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nenhuma cor ainda. Comece pela cor principal da marca.</p>}
        <ul className="space-y-2">
          {paleta.map((cor, i) => (
            <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-card p-2 sm:grid-cols-[40px_minmax(0,1fr)_120px_140px_auto]">
              <input
                type="color"
                value={HEX.test(cor.hex) ? cor.hex : "#000000"}
                onChange={(e) => mudarCor(i, "hex", e.target.value.toUpperCase())}
                className="h-9 w-10 cursor-pointer rounded border border-border bg-card p-0.5"
                aria-label="Cor"
              />
              <Input value={cor.nome} onChange={(e) => mudarCor(i, "nome", e.target.value)} placeholder="Nome (ex.: Verde folha)" className="h-9 min-w-0" />
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 sm:order-last" onClick={() => setPaleta((p) => p.filter((_, j) => j !== i))} aria-label="Remover cor">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Input value={cor.hex} onChange={(e) => mudarCor(i, "hex", e.target.value)} className="col-span-3 h-9 font-mono text-xs sm:col-span-1" />
              <div className="col-span-3 min-w-0 sm:col-span-1">
                <Select value={cor.papel} onValueChange={(v) => mudarCor(i, "papel", v)}>
                  <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAPEIS_DA_COR.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <TituloDeSecao>Logo</TituloDeSecao>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CartaoDaLogo
            rotulo="Logo principal"
            dica="Escolha em qualquer pasta do Workspace, de Arquivos ou do acervo."
            caminho={k.logo_path || null}
            fileIdAntigo={k.logo_path ? null : k.logo_file_id || null}
            onEscolher={() => setEscolhendo("logo")}
            onTirar={() => void tirarLogo("logo")}
            tirando={tirando === "logo"}
          />
          <CartaoDaLogo
            rotulo="Logo alternativa"
            dica="Versão para fundo escuro ou claro, de qualquer pasta."
            caminho={k.logo_alt_path || null}
            fileIdAntigo={k.logo_alt_path ? null : k.logo_alt_file_id || null}
            onEscolher={() => setEscolhendo("alt")}
            onTirar={() => void tirarLogo("alt")}
            tirando={tirando === "alt"}
          />
        </div>
        <NavegadorDePastas
          aberto={!!escolhendo}
          onOpenChange={(v) => { if (!v && !gravandoLogo) setEscolhendo(null); }}
          titulo={escolhendo === "alt" ? "Escolher a logo alternativa" : "Escolher a logo principal"}
          descricao="Só aparecem imagens. Ao clicar, a imagem é copiada para a marca do cliente e passa a valer para os agentes."
          onEscolher={(e) => void escolherLogo(e)}
          ocupado={gravandoLogo}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Campo rotulo="Estilo (como a marca se parece)">
          <Textarea value={estilo} onChange={(e) => setEstilo(e.target.value)} rows={5} placeholder="Ex.: fotografia natural com luz de manhã, tipografia serifada nos títulos, muito respiro." />
        </Campo>
        <Campo rotulo="Regras (faça e não faça)">
          <Textarea value={regras} onChange={(e) => setRegras(e.target.value)} rows={5} placeholder="Ex.: nunca usar fundo preto; logo sempre no canto inferior." />
        </Campo>
      </section>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void salvar()} disabled={salvando || kit.isLoading}>
          {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Salvar kit de marca
        </Button>
      </div>
    </div>
  );
}
