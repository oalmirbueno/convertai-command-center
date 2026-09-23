import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import LogosDaMarca from "./ContextoLogos";
import { useMesa } from "./MesaContexto";
import { Campo, TituloDeSecao } from "./Seletores";
import { useInvalidarContexto, useKitDoCliente } from "./contextoDoCliente";

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

export default function ContextoMarca() {
  const { clientId, userId } = useMesa();
  const invalidar = useInvalidarContexto();
  const [paleta, setPaleta] = useState<Cor[]>([]);
  const [estilo, setEstilo] = useState("");
  const [regras, setRegras] = useState("");
  const [salvando, setSalvando] = useState(false);

  const kit = useKitDoCliente(clientId);

  useEffect(() => {
    const k = kit.data;
    setPaleta(Array.isArray(k?.paleta) ? (k!.paleta as Cor[]) : []);
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
        <p className="text-[12px] text-muted-foreground">Escolha em qualquer pasta do Workspace, de Arquivos ou do acervo. A alternativa é a versão para fundo escuro ou claro.</p>
        <div className="max-w-xl">
          <LogosDaMarca kit={kit.data} />
        </div>
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
