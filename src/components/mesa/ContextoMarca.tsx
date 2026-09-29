import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import LogosDaMarca from "./ContextoLogos";
import { PaletaDaMarca } from "./ContextoPaleta";
import { useMesa } from "./MesaContexto";
import { Campo } from "./Seletores";
import Secao from "@/components/sistema/Secao";
import { superficie } from "@/components/sistema/estilos";
import { useInvalidarContexto } from "./contextoDoCliente";
import { chavesDoKit, gravarNoKit, useKitDaMesa } from "./kitDaMesa";

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

/**
 * O agente de contexto grava a cor principal como "primaria" (é o nome que o
 * diretor de arte procura). Na tela, as duas grafias são a mesma opção.
 */
export function papelNaTela(papel: string): string {
  const p = String(papel || "").toLowerCase();
  return p === "primaria" || p === "primária" ? "principal" : papel;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Kit de marca: paleta, logo, estilo e regras. Frente MC (29/09, dono: "criar
 * e editar a CME é igual a editar um cliente"): a MESMA tela para o cliente e
 * para a outra marca aberta no topo. Com a CME aberta, lê e grava só a linha
 * dela (cliente_marcas), com tom e "sobre a marca" a mais; vazio fica vazio
 * (nunca mostra nem grava o da Acerbi). Sem marca ou na principal, o kit do
 * cliente, como sempre.
 */
export default function ContextoMarca() {
  const { clientId, userId } = useMesa();
  const invalidar = useInvalidarContexto();
  const queryClient = useQueryClient();
  const [paleta, setPaletaBruta] = useState<Cor[]>([]);
  const [estilo, setEstiloBruto] = useState("");
  const [regras, setRegrasBrutas] = useState("");
  const [tom, setTomBruto] = useState("");
  const [sobre, setSobreBruto] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Editou e ainda não salvou: o kit relido (agente ao lado, sugestão
  // aplicada) não apaga o que está sendo digitado.
  const sujo = useRef(false);
  const setPaleta: typeof setPaletaBruta = (v) => {
    sujo.current = true;
    setPaletaBruta(v);
  };
  const setEstilo = (v: string) => {
    sujo.current = true;
    setEstiloBruto(v);
  };
  const setRegras = (v: string) => {
    sujo.current = true;
    setRegrasBrutas(v);
  };
  const setTom = (v: string) => {
    sujo.current = true;
    setTomBruto(v);
  };
  const setSobre = (v: string) => {
    sujo.current = true;
    setSobreBruto(v);
  };

  const kit = useKitDaMesa();
  const marca = kit.daMarca ? kit.marca : null;
  const chaveDaTela = marca ? marca.id : "cliente";

  // Trocou de marca no topo: a tela recarrega com o kit da outra (o que estava digitado não vai junto).
  const ultimaChave = useRef(chaveDaTela);
  useEffect(() => {
    if (ultimaChave.current !== chaveDaTela) {
      ultimaChave.current = chaveDaTela;
      sujo.current = false;
    }
    if (sujo.current) return;
    const k = kit.data;
    setPaletaBruta(Array.isArray(k?.paleta) ? (k!.paleta as Cor[]) : []);
    setEstiloBruto(k?.estilo || "");
    setRegrasBrutas(k?.regras || "");
    setTomBruto(marca ? marca.tom || "" : "");
    setSobreBruto(marca ? marca.contexto_extra || "" : "");
  }, [kit.data, chaveDaTela, marca]);

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
      const campos: Record<string, unknown> = {
        paleta: paleta.map((c) => ({ nome: c.nome.trim(), hex: c.hex.toUpperCase(), papel: c.papel })),
        estilo: estilo.trim() || null,
        regras: regras.trim() || null,
      };
      if (marca) {
        campos.tom = tom.trim() || null;
        campos.contexto_extra = sobre.trim().slice(0, 8000) || null;
      }
      await gravarNoKit(kit.alvo, campos, userId);
      sujo.current = false;
      toast.success(marca ? `Kit da ${marca.nome} salvo` : "Kit de marca salvo");
      invalidar(clientId);
      for (const queryKey of chavesDoKit(clientId)) void queryClient.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error("Kit não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-6">
      <Secao
        titulo="Paleta"
        recolher={`mesa:contexto:marca:paleta:${clientId}`}
        resumo={paleta.length ? `${paleta.length} ${paleta.length === 1 ? "cor" : "cores"}` : "sem cores"}
        corpoClassName="space-y-3"
        acao={
          <Button type="button" size="sm" variant="ghost" onClick={() => setPaleta((p) => p.concat([{ nome: "", hex: "#00C853", papel: "principal" }]))}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Cor
          </Button>
        }
      >
        {paleta.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            {marca ? `Nenhuma cor da ${marca.nome} ainda (a da outra marca nunca entra). Comece pela cor principal ou confirme as lidas da logo.` : "Nenhuma cor ainda. Comece pela cor principal da marca."}
          </p>
        )}
        {paleta.length > 0 && (
          // Prévia ao vivo, como a paleta aparece no hub Marca (clique copia o hex).
          <PaletaDaMarca paleta={paleta.filter((c) => HEX.test(c.hex))} />
        )}
        <ul className="space-y-2">
          {paleta.map((cor, i) => (
            <li key={i} className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 p-2 sm:grid-cols-[40px_minmax(0,1fr)_120px_140px_auto] ${superficie.poco}`}>
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
                <Select value={papelNaTela(cor.papel)} onValueChange={(v) => mudarCor(i, "papel", v)}>
                  <SelectTrigger className="h-9 text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAPEIS_DA_COR.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      </Secao>

      <Secao
        titulo="Logo"
        recolher={`mesa:contexto:marca:logo:${clientId}`}
        ajuda={
          marca
            ? `Logo só da ${marca.nome}: escolha em qualquer pasta, puxe do Instagram dela ou confirme a achada nos arquivos. A alternativa é a versão para fundo escuro ou claro.`
            : "Escolha em qualquer pasta do Workspace, de Arquivos ou do acervo. A alternativa é a versão para fundo escuro ou claro."
        }
      >
        <div className="max-w-xl">
          <LogosDaMarca kit={kit.data} />
        </div>
      </Secao>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Campo rotulo="Estilo (como a marca se parece)">
          <Textarea value={estilo} onChange={(e) => setEstilo(e.target.value)} rows={5} placeholder="Ex.: fotografia natural com luz de manhã, tipografia serifada nos títulos, muito respiro." />
        </Campo>
        <Campo rotulo="Regras (faça e não faça)">
          <Textarea value={regras} onChange={(e) => setRegras(e.target.value)} rows={5} placeholder="Ex.: nunca usar fundo preto; logo sempre no canto inferior." />
        </Campo>
        {marca && (
          <>
            <Campo rotulo="Tom de voz">
              <Textarea value={tom} onChange={(e) => setTom(e.target.value)} rows={3} placeholder={`Como a ${marca.nome} fala (vazio: sem tom, nunca o da outra marca).`} />
            </Campo>
            <Campo rotulo={`Sobre a ${marca.nome}`}>
              <Textarea value={sobre} onChange={(e) => setSobre(e.target.value)} rows={3} placeholder="Público, proposta e o que a diferencia." />
            </Campo>
          </>
        )}
      </section>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void salvar()} disabled={salvando || kit.isLoading}>
          {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {marca ? `Salvar kit da ${marca.nome}` : "Salvar kit de marca"}
        </Button>
      </div>
    </div>
  );
}
