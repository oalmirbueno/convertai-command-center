import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Flame, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { BotaoDeAnexar, MiniaturasDosAnexos, useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import CampanhaReferencias, { MAX_REFERENCIAS, ReferenciasEscolhidas } from "./CampanhaReferencias";
import { Cronometro } from "./Cronometro";
import { Ditado } from "./Ditado";
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
import { trocarCampanhaNoCache } from "./campanhasApi";

/**
 * Nova campanha, numa coluna só e com o mínimo à vista: um campo grande
 * ("O que é a campanha?", com microfone e imagens), o período, quantos
 * conteúdos e o botão. As referências ficam em "Mais opções". Um clique e o
 * estrategista cria o tema, a identidade (com o selo a desenhar) e os
 * conteúdos; a campanha abre com o agente ao lado para os ajustes.
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
  const [maisOpcoes, setMaisOpcoes] = useState(false);
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
    if (campanha) trocarCampanhaNoCache(queryClient, clientId, campanha);
    void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    anexos.limpar();
    if (campanha) onCriada(campanha, data.project_id ? String(data.project_id) : null);
  };

  return (
    <ZonaDeAnexos anexos={anexos} className="mx-auto w-full min-w-0 max-w-2xl">
      <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex min-w-0 items-start">
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">Nova campanha</h2>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Descreva a campanha. O agente cria o tema, a identidade com o selo e os conteúdos do período.
            </p>
          </div>
          {onCancelar && (
            // Criando: a chamada já foi paga e segue no servidor; cancelar aqui
            // não a pararia e, ao voltar, puxaria a tela para a campanha nova.
            <Button type="button" size="sm" variant="ghost" className="ml-2 h-8 shrink-0" onClick={onCancelar} disabled={desde !== null}>
              Cancelar
            </Button>
          )}
        </div>

        {hype && (
          <div className="mt-4 flex min-w-0 items-center rounded-lg bg-muted px-3 py-2 text-[12px]">
            <Flame className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">Do hype: <strong className="font-medium">{hype.titulo}</strong></span>
            {onLimparHype && (
              <button type="button" onClick={onLimparHype} aria-label="Tirar o hype" className="ml-2 shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* O campo grande, como uma conversa: texto, microfone e imagens. */}
        <div className="mt-4 rounded-xl border border-border bg-background p-2.5 focus-within:border-primary/60">
          <label htmlFor="pedido-da-campanha" className="block px-1 pb-1 text-[12px] font-medium text-muted-foreground">
            O que é a campanha?
          </label>
          <Textarea
            id="pedido-da-campanha"
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            rows={5}
            aria-label="Pedido da campanha"
            placeholder="Ex.: promoção do amor no Dia dos Namorados, 20% em kits para casal, tom leve e romântico"
            className="min-h-[120px] resize-y border-0 bg-transparent px-1 py-1 text-[13.5px] leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <MiniaturasDosAnexos anexos={anexos} />
          <div className="mt-1 flex min-w-0 items-center">
            <BotaoDeAnexar anexos={anexos} className="mr-1.5" />
            <Ditado valor={pedido} onChange={setPedido} disabled={desde !== null} className="min-w-0" />
            <span className="ml-auto hidden truncate pl-2 text-[11px] text-muted-foreground sm:inline">Arraste ou cole imagens e prints</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
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
        {erroDoPeriodo && <p className="mt-2 text-[12px] text-destructive">{erroDoPeriodo}</p>}

        {/* Mais opções: as referências da campanha. */}
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setMaisOpcoes((v) => !v)}
            aria-expanded={maisOpcoes}
            className="inline-flex items-center text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`mr-1 h-4 w-4 transition-transform ${maisOpcoes ? "" : "-rotate-90"}`} />
            Mais opções
            {referencias.length > 0 && <span className="ml-1.5 font-normal">({referencias.length} referência(s))</span>}
          </button>
          {maisOpcoes && (
            <div className="mt-3 space-y-2">
              <div className="flex min-w-0 items-center">
                <p className="min-w-0 flex-1 text-[12px] font-medium text-muted-foreground">
                  Referências <span className="font-normal">({referencias.length} de {MAX_REFERENCIAS})</span>
                </p>
                <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 text-primary" aria-expanded={galeria} onClick={() => setGaleria((v) => !v)}>
                  {galeria ? "Fechar" : "Escolher"}
                </Button>
              </div>
              {galeria ? (
                <CampanhaReferencias valor={referencias} onChange={setReferencias} />
              ) : (
                <ReferenciasEscolhidas ids={referencias} onTirar={(id) => setReferencias((l) => l.filter((x) => x !== id))} />
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end">
          {desde !== null && <span className="mb-1 mr-3 min-w-0"><Cronometro desde={desde} rotulo="Criando a campanha" previsao="~1min" /></span>}
          <BotaoComCusto
            rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />Criar campanha</>}
            titulo="Campanha criada"
            descricao="O estrategista cria o tema, a identidade com o selo e os conteúdos do período, pelo contexto do cliente."
            partes={() => partesDaCampanha(catalogo, qtd, anexos.caminhos.length)}
            executar={criar}
            aoConcluir={concluir}
            disabled={!pedido.trim() || !!erroDoPeriodo || anexos.subindo || desde !== null}
            className="mb-1 h-9"
          />
        </div>
      </section>
    </ZonaDeAnexos>
  );
}
