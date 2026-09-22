import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useResolvedFileUrl } from "@/lib/fileUrls";
import { extensao, textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import { Campo, TituloDeSecao } from "./Seletores";

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
const IMAGENS = ["png", "jpg", "jpeg", "webp", "svg", "gif"];

interface ArquivoDeImagem {
  id: string;
  file_name: string;
  file_url: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  extension: string | null;
}

function Miniatura({ arquivo, className = "" }: { arquivo: ArquivoDeImagem; className?: string }) {
  const { url } = useResolvedFileUrl({
    fileUrl: arquivo.file_url,
    storageBucket: arquivo.storage_bucket,
    storagePath: arquivo.storage_path,
    transform: { width: 240, height: 240, resize: "contain" },
  });
  if (!url) return <div className={`animate-pulse bg-secondary/60 ${className}`} />;
  return <img src={url} alt={arquivo.file_name} loading="lazy" className={`object-contain ${className}`} />;
}

export default function ContextoMarca() {
  const { clientId, userId } = useMesa();
  const queryClient = useQueryClient();
  const [paleta, setPaleta] = useState<Cor[]>([]);
  const [logo, setLogo] = useState<string | null>(null);
  const [logoAlt, setLogoAlt] = useState<string | null>(null);
  const [estilo, setEstilo] = useState("");
  const [regras, setRegras] = useState("");
  const [escolhendo, setEscolhendo] = useState<"logo" | "alt" | null>(null);
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
    setLogo(k?.logo_file_id || null);
    setLogoAlt(k?.logo_alt_file_id || null);
    setEstilo(k?.estilo || "");
    setRegras(k?.regras || "");
  }, [kit.data]);

  const arquivos = useQuery({
    queryKey: ["mesa", "imagens-do-cliente", clientId],
    queryFn: async (): Promise<ArquivoDeImagem[]> => {
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, file_url, storage_bucket, storage_path, mime_type, extension, created_at")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return ((data || []) as ArquivoDeImagem[]).filter((f) => {
        const ext = (f.extension || extensao(f.file_name || "")).toLowerCase();
        return String(f.mime_type || "").indexOf("image/") === 0 || IMAGENS.indexOf(ext) >= 0;
      });
    },
  });

  const porId = useMemo(() => new Map((arquivos.data || []).map((a) => [a.id, a])), [arquivos.data]);

  const mudarCor = (i: number, campo: keyof Cor, valor: string) =>
    setPaleta((p) => p.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)));

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
          logo_file_id: logo,
          logo_alt_file_id: logoAlt,
          estilo: estilo.trim() || null,
          regras: regras.trim() || null,
          atualizado_por: userId,
        },
        { onConflict: "client_id" },
      );
      if (error) throw error;
      toast.success("Kit de marca salvo");
      void queryClient.invalidateQueries({ queryKey: ["mesa", "kit", clientId] });
    } catch (e) {
      toast.error("Kit não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const escolher = (id: string) => {
    if (escolhendo === "logo") setLogo(id);
    if (escolhendo === "alt") setLogoAlt(id);
    setEscolhendo(null);
  };

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
                className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
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
          {([["logo", "Logo principal", logo], ["alt", "Logo alternativa (fundo escuro ou claro)", logoAlt]] as const).map(([qual, rotulo, id]) => (
            <div key={qual} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/60">
                {id && porId.get(id) ? <Miniatura arquivo={porId.get(id)!} className="h-16 w-16" /> : <span className="text-[10px] text-muted-foreground">vazio</span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium">{rotulo}</p>
                <p className="truncate text-[11px] text-muted-foreground">{id ? porId.get(id)?.file_name || "arquivo escolhido" : "Escolha entre as imagens do cliente em Arquivos"}</p>
                <div className="mt-1.5 flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-7 text-[11.5px]" onClick={() => setEscolhendo(qual)}>Escolher</Button>
                  {id && <Button type="button" size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => (qual === "logo" ? setLogo(null) : setLogoAlt(null))}>Tirar</Button>}
                </div>
              </div>
            </div>
          ))}
        </div>
        {escolhendo && (
          <div className="rounded-xl border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[12.5px] font-medium">Escolha a {escolhendo === "logo" ? "logo principal" : "logo alternativa"}</p>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEscolhendo(null)}>Fechar</Button>
            </div>
            {arquivos.isLoading && <p className="text-[12px] text-muted-foreground">Lendo os arquivos do cliente…</p>}
            {arquivos.data && arquivos.data.length === 0 && <p className="text-[12px] text-muted-foreground">Este cliente ainda não tem imagens em Arquivos. Envie a logo por lá e volte aqui.</p>}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(arquivos.data || []).slice(0, 60).map((a) => {
                const marcado = a.id === (escolhendo === "logo" ? logo : logoAlt);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => escolher(a.id)}
                    className={`relative min-w-0 overflow-hidden rounded-lg border bg-secondary/40 p-1 text-left ${marcado ? "border-primary" : "border-border hover:border-primary/50"}`}
                  >
                    <Miniatura arquivo={a} className="aspect-square w-full" />
                    <span className="mt-1 block truncate text-[10px] text-muted-foreground">{a.file_name}</span>
                    {marcado && <Check className="absolute right-1 top-1 h-4 w-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
