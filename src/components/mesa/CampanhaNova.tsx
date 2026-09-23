import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Flame, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import CampanhaReferencias, { MAX_REFERENCIAS, ReferenciasEscolhidas } from "./CampanhaReferencias";
import { Cronometro } from "./Cronometro";
import { Campo } from "./Seletores";
import {
  campanhaCriar,
  chaves,
  DIAS_MAX_CAMPANHA,
  DIAS_PADRAO_CAMPANHA,
  diasEntreIso,
  hojeIso,
  partesDaCampanha,
  pedidoDaCampanhaDoHype,
  somarDiasIso,
  type Campanha,
  type Hype,
} from "./mesaV4Api";

/**
 * Nova campanha, numa coluna só: o pedido, o período, quantos conteúdos, as
 * imagens e as referências. Um clique e o estrategista cria o tema, a
 * identidade (com o selo a desenhar) e os conteúdos, prontos para gravar.
 */

const QUANTIDADES = ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

export default function CampanhaNova({
  hype,
  onLimparHype,
  onCriada,
  onCancelar,
}: {
  hype?: Hype | null;
  onLimparHype?: () => void;
  onCriada: (campanha: Campanha, projectId: string | null) => void;
  onCancelar?: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const anexos = useAnexos(clientId);
  const hoje = hojeIso();
  const [pedido, setPedido] = useState(() => (hype ? pedidoDaCampanhaDoHype(hype) : ""));
  const [inicio, setInicio] = useState(hoje);
  const [fim, setFim] = useState(() => somarDiasIso(hoje, DIAS_PADRAO_CAMPANHA));
  const [quantidade, setQuantidade] = useState("auto");
  const [referencias, setReferencias] = useState<string[]>([]);
  const [galeria, setGaleria] = useState(false);
  const [desde, setDesde] = useState<number | null>(null);

  const dias = inicio && fim ? diasEntreIso(inicio, fim) : -1;
  const erroDoPeriodo = !inicio || !fim
    ? "Escolha o início e o fim."
    : dias < 0
      ? "O fim vem antes do início."
      : dias > DIAS_MAX_CAMPANHA
        ? `Até ${DIAS_MAX_CAMPANHA} dias por campanha.`
        : "";
  const qtd = quantidade === "auto" ? null : Number(quantidade);

  const criar = async () => {
    setDesde(Date.now());
    try {
      return await campanhaCriar({
        clientId,
        pedido: pedido.trim(),
        periodoInicio: inicio,
        periodoFim: fim,
        quantidade: qtd,
        anexos: anexos.caminhos,
        referenciasIds: referencias,
        hype: hype || null,
      });
    } finally {
      setDesde(null);
    }
  };

  const concluir = (data: any) => {
    const campanha = data && data.campanha ? (data.campanha as Campanha) : null;
    if (data && data.proposta && data.proposta.id) queryClient.setQueryData(chaves.proposta(data.proposta.id), data.proposta);
    if (campanha) {
      queryClient.setQueryData<Campanha[]>(chaves.campanhas(clientId), (lista) => [campanha].concat((lista || []).filter((c) => c.id !== campanha.id)));
    }
    void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    anexos.limpar();
    if (campanha) onCriada(campanha, data.project_id ? String(data.project_id) : null);
  };

  return (
    <ZonaDeAnexos anexos={anexos} className="min-w-0">
      <section className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex min-w-0 items-center">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Nova campanha</h2>
          {onCancelar && (
            <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" onClick={onCancelar}>
              Cancelar
            </Button>
          )}
        </div>

        {hype && (
          <div className="flex min-w-0 items-center rounded-lg bg-muted px-3 py-2 text-[12px]">
            <Flame className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">Do hype: <strong className="font-medium">{hype.titulo}</strong></span>
            {onLimparHype && (
              <button type="button" onClick={onLimparHype} aria-label="Tirar o hype" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <Campo rotulo="O que é a campanha">
          <Textarea
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            rows={4}
            aria-label="Pedido da campanha"
            placeholder="Ex.: promoção do amor no Dia dos Namorados, 20% em kits para casal"
            className="text-[13px]"
          />
        </Campo>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Campo rotulo="Início">
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="h-9 min-w-0" aria-label="Início da campanha" />
          </Campo>
          <Campo rotulo="Fim">
            <Input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} className="h-9 min-w-0" aria-label="Fim da campanha" />
          </Campo>
          <Campo rotulo="Conteúdos" className="col-span-2 sm:col-span-1">
            <Select value={quantidade} onValueChange={setQuantidade}>
              <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Quantidade de conteúdos"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automático</SelectItem>
                {QUANTIDADES.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
        </div>
        {erroDoPeriodo && <p className="text-[12px] text-destructive">{erroDoPeriodo}</p>}

        <div className="space-y-2">
          <div className="flex min-w-0 items-center">
            <p className="min-w-0 flex-1 text-[12px] font-medium text-muted-foreground">Imagens e prints</p>
            <BotaoDeAnexar anexos={anexos} />
          </div>
          {anexos.lista.length ? (
            <MiniaturasDosAnexos anexos={anexos} tamanho="h-16 w-16" />
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[12px] text-muted-foreground">Arraste ou cole imagens aqui</p>
          )}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setGaleria((v) => !v)}
            aria-expanded={galeria}
            className="flex w-full min-w-0 items-center text-left"
          >
            <span className="min-w-0 flex-1 text-[12px] font-medium text-muted-foreground">
              Referências <span className="font-normal">({referencias.length} de {MAX_REFERENCIAS})</span>
            </span>
            <span className="inline-flex shrink-0 items-center text-[12px] font-medium text-primary">
              {galeria ? "Fechar" : "Escolher"}
              <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${galeria ? "rotate-180" : ""}`} />
            </span>
          </button>
          {!galeria && <ReferenciasEscolhidas ids={referencias} onTirar={(id) => setReferencias((l) => l.filter((x) => x !== id))} />}
          {galeria && <CampanhaReferencias valor={referencias} onChange={setReferencias} />}
        </div>

        <div className="flex flex-wrap items-center justify-end border-t border-border pt-3">
          {desde !== null && <span className="mb-1 mr-3 min-w-0"><Cronometro desde={desde} rotulo="Criando a campanha" previsao="~1min" /></span>}
          <BotaoComCusto
            rotulo="Criar campanha"
            titulo="Campanha criada"
            descricao="O estrategista cria o tema, a identidade com o selo e os conteúdos do período, pelo contexto do cliente."
            partes={() => partesDaCampanha(catalogo, qtd, anexos.caminhos.length)}
            executar={criar}
            aoConcluir={concluir}
            disabled={!pedido.trim() || !!erroDoPeriodo || anexos.subindo || desde !== null}
            className="mb-1"
          />
        </div>
      </section>
    </ZonaDeAnexos>
  );
}
