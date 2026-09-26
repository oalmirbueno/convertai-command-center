import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { gravarCopiasSemEsperar } from "@/lib/miniaturas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { extensao, textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { Campo, TituloDeSecao } from "./Seletores";
import { AvisoDeErro } from "./Custo";

interface Rosto {
  id: string;
  pessoa: string;
  storage_path: string;
  autorizacao_registrada_em: string;
  autorizado_por: string;
  ativa: boolean;
}

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Rosto autorizado: só entra com o registro da autorização (quem autorizou e
 * quando). Sem os dois campos, o botão não envia; o banco também recusa.
 */
export default function ContextoRosto() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [pessoa, setPessoa] = useState("");
  const [autorizadoPor, setAutorizadoPor] = useState("");
  const [quando, setQuando] = useState(hoje());
  const [confirmo, setConfirmo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const rostos = useQuery({
    queryKey: ["mesa", "rostos", clientId],
    queryFn: async (): Promise<Rosto[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_rostos")
        .select("id, pessoa, storage_path, autorizacao_registrada_em, autorizado_por, ativa")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: ["mesa", "rostos", clientId] });

  const pronto = !!arquivo && pessoa.trim() && autorizadoPor.trim() && quando && confirmo;

  const enviar = async () => {
    if (!pronto || !arquivo) return;
    const ext = extensao(arquivo.name);
    if (["png", "jpg", "jpeg", "webp"].indexOf(ext) < 0) {
      toast.error("Envie a foto em PNG, JPG ou WEBP.");
      return;
    }
    setEnviando(true);
    const id = crypto.randomUUID();
    const caminho = `${clientId}/rostos/${id}.${ext}`;
    try {
      const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: arquivo.type || `image/${ext}`, upsert: false });
      if (error) throw error;
      gravarCopiasSemEsperar("mesa", caminho, arquivo, { nome: arquivo.name, mime: arquivo.type });
      const { error: erroLinha } = await (supabase as any).from("cliente_rostos").insert({
        id,
        client_id: clientId,
        pessoa: pessoa.trim(),
        storage_path: caminho,
        autorizado_por: autorizadoPor.trim(),
        autorizacao_registrada_em: new Date(`${quando}T12:00:00`).toISOString(),
      });
      if (erroLinha) {
        await supabase.storage.from("mesa").remove([caminho]);
        throw erroLinha;
      }
      toast.success("Rosto registrado com a autorização");
      setArquivo(null);
      setPessoa("");
      setAutorizadoPor("");
      setConfirmo(false);
      if (entrada.current) entrada.current.value = "";
      atualizar();
    } catch (e) {
      toast.error("Rosto não registrado", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  const alternar = async (r: Rosto, ativa: boolean) => {
    const { error } = await (supabase as any).from("cliente_rostos").update({ ativa }).eq("id", r.id);
    if (error) toast.error("Não foi possível salvar", { description: textoDoErro(error) });
    atualizar();
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-border bg-card p-3.5">
        <TituloDeSecao>Registrar rosto autorizado</TituloDeSecao>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          O gerador só usa o rosto de uma pessoa real com autorização registrada. Guarde o termo ou a mensagem de autorização fora daqui e informe quem autorizou e quando.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo rotulo="Foto">
            <Input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setArquivo(e.target.files?.[0] || null)} className="h-9 text-[12px]" />
          </Campo>
          <Campo rotulo="Pessoa na foto">
            <Input value={pessoa} onChange={(e) => setPessoa(e.target.value)} placeholder="Nome de quem aparece" className="h-9" />
          </Campo>
          <Campo rotulo="Autorizado por (obrigatório)">
            <Input value={autorizadoPor} onChange={(e) => setAutorizadoPor(e.target.value)} placeholder="Ex.: a própria pessoa, por WhatsApp" className="h-9" />
          </Campo>
          <Campo rotulo="Data da autorização (obrigatório)">
            <Input type="date" value={quando} max={hoje()} onChange={(e) => setQuando(e.target.value)} className="h-9" />
          </Campo>
        </div>
        <label className="flex items-start gap-2 text-[12.5px]">
          <Checkbox checked={confirmo} onCheckedChange={(v) => setConfirmo(v === true)} className="mt-0.5" />
          <span>Confirmo que a autorização existe e está guardada.</span>
        </label>
        <div className="flex justify-end">
          <Button type="button" onClick={() => void enviar()} disabled={!pronto || enviando}>
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
            Registrar
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <TituloDeSecao>Rostos do cliente</TituloDeSecao>
        {rostos.isError && <AvisoDeErro erro={rostos.error} />}
        {rostos.data && rostos.data.length === 0 && <p className="text-[12.5px] text-muted-foreground">Nenhum rosto registrado.</p>}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(rostos.data || []).map((r) => (
            <li key={r.id} className={`flex min-w-0 gap-3 rounded-xl border border-border bg-card p-2.5 ${r.ativa ? "" : "opacity-60"}`}>
              <ImagemDaMesa caminho={r.storage_path} alt={r.pessoa} className="h-20 w-16 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{r.pessoa}</p>
                <p className="mt-0.5 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                  <ShieldCheck className="mt-px h-3 w-3 shrink-0 text-success" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {r.autorizado_por} em {new Date(r.autorizacao_registrada_em).toLocaleDateString("pt-BR")}
                  </span>
                </p>
                <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Switch checked={r.ativa} onCheckedChange={(v) => void alternar(r, v)} className="scale-75" />
                  {r.ativa ? "em uso" : "fora"}
                </label>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
