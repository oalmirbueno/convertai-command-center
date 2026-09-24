import { ArrowRight, Camera, Check, ChevronDown, Layers, Loader2, Plus, Wallet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMesa } from "@/components/mesa/MesaContexto";
import { estimarLocal, padraoPara, usd } from "@/lib/mesa/api";
import { useMesaFoto, type EtapaDaMesaFoto } from "./Comuns";
import { nomeDaReceita, partesDaGeracao, resumoDoEnsaio, rotuloDoEstadoDoEnsaio, rotuloDoTipo, tomadasParaGerar, useEnsaios, useKits, useReceitas } from "./fotoApi";
import { resumoDoLote, useLotes } from "./lote";

/**
 * Segunda linha da barra da Mesa Foto: o produto (kit) aberto, com a troca
 * ali mesmo (os kits rascunho que o diretor ou a sugestão gravaram também
 * aparecem), o ensaio aberto, o custo, o lote que está gerando (em qualquer
 * etapa) e o próximo passo do caminho principal, sempre em destaque. O kit
 * escolhido vai para o endereço (?kit=), então fica ao recarregar.
 */
export default function BarraDoEnsaio() {
  const { clientId, catalogo } = useMesa();
  const { kitId, ensaioId, irPara, escolherKit, proximo, etapa } = useMesaFoto();
  const kits = useKits(clientId);
  const ensaios = useEnsaios(clientId);
  const receitas = useReceitas();
  const lotes = useLotes();
  const lista = kits.data || [];
  const kit = kitId ? lista.find((k) => k.id === kitId) || null : null;
  const ensaio = ensaioId ? (ensaios.data || []).find((e) => e.id === ensaioId) || null : null;
  const resumo = resumoDoEnsaio(ensaio);
  const imagem = padraoPara(catalogo, "imagem");
  const faltam = tomadasParaGerar(ensaio).filter((t) => !t.versoes.length).length;
  const estimativa = ensaio && faltam && imagem ? estimarLocal(partesDaGeracao(imagem.id, "alta", faltam), catalogo) : null;
  const ativos = Object.keys(lotes)
    .map((k) => lotes[k])
    .filter((l) => l.client_id === clientId && l.ativo);
  const mostrarProximo = !!proximo && proximo.etapa !== etapa;

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center text-[11.5px] text-muted-foreground" aria-label="Kit, ensaio e custo" data-barra-do-ensaio="">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="mr-3 inline-flex min-w-0 max-w-full items-center rounded-md py-0.5 hover:text-foreground" aria-label="Trocar o produto (kit)">
            <Layers className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="mr-1">Produto:</span>
            <span className={`min-w-0 truncate ${kit ? "font-medium text-foreground" : ""}`}>{kit ? `${kit.nome} · ${rotuloDoTipo(kit.tipo)}` : "nenhum"}</span>
            {kit && kit.status === "rascunho" && <span className="ml-1 shrink-0 rounded-full border border-border px-1.5 text-[10px]">rascunho</span>}
            <ChevronDown className="ml-0.5 h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] w-72 max-w-[calc(100vw-24px)] overflow-y-auto">
          {lista.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Nenhum produto ainda.</p>}
          {lista.map((k) => (
            <DropdownMenuItem key={String(k.id)} onSelect={() => escolherKit(k.id)} className="text-[12.5px]" data-kit-na-barra={k.id}>
              <span className="mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center">{k.id === kitId && <Check className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1 truncate">{k.nome}</span>
              <span className="ml-2 shrink-0 text-[10.5px] text-muted-foreground">{k.status === "rascunho" ? "rascunho" : rotuloDoTipo(k.tipo)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => irPara("kits")} className="text-[12.5px]">
            <Plus className="mr-2 h-3.5 w-3.5" /> Identificar ou montar produto
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" onClick={() => irPara(ensaio ? "revisar" : "criar")} className="mr-3 inline-flex min-w-0 max-w-full items-center rounded-md py-0.5 hover:text-foreground">
        <Camera className="mr-1 h-3.5 w-3.5 shrink-0" />
        <span className="mr-1">Ensaio:</span>
        <span className={`min-w-0 truncate ${ensaio ? "font-medium text-foreground" : ""}`}>
          {ensaio ? `${nomeDaReceita(receitas.data ? receitas.data.receitas : null, ensaio.receita_id)} · ${rotuloDoEstadoDoEnsaio(ensaio.status)}` : "nenhum"}
        </span>
      </button>
      {ensaio && (
        <span className="mr-3 whitespace-nowrap tabular-nums">
          {resumo.aprovadas}/{resumo.total} aprovadas{resumo.paraRevisar ? ` · ${resumo.paraRevisar} para revisar` : ""}
        </span>
      )}
      {ensaio && (
        <span className="mr-3 inline-flex items-center whitespace-nowrap tabular-nums">
          <Wallet className="mr-1 h-3.5 w-3.5" />
          gasto <span className="mx-1 font-medium text-foreground">{usd(resumo.custo)}</span>
          {estimativa !== null && (
            <>
              · falta gerar <span className="ml-1 font-medium text-foreground">~{usd(estimativa)}</span>
            </>
          )}
        </span>
      )}
      {ativos.map((l) => {
        const r = resumoDoLote(l);
        const e = (ensaios.data || []).find((x) => x.id === l.ensaio_id);
        const destino: EtapaDaMesaFoto = e && e.receita_id === "campanha-com-modelo" ? "campanha" : "ensaio";
        return (
          <button
            key={l.ensaio_id}
            type="button"
            onClick={() => irPara(destino, { ensaio: l.ensaio_id })}
            className="mr-3 inline-flex items-center whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"
            data-lote-na-barra=""
          >
            <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Gerando {Math.min(r.andando + 1, r.total)} de {r.total}
          </button>
        );
      })}
      {mostrarProximo && proximo && (
        <button
          type="button"
          onClick={() => irPara(proximo.etapa as EtapaDaMesaFoto, proximo.extras)}
          className="ml-auto inline-flex min-w-0 max-w-full items-center rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          data-proximo-passo=""
        >
          <span className="truncate">Próximo: {proximo.rotulo}</span>
          <ArrowRight className="ml-1 h-3.5 w-3.5 shrink-0" />
        </button>
      )}
    </div>
  );
}
