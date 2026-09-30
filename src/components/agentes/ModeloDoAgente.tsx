import { useState } from "react";
import { ChevronDown, Cpu } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { foco, juntar, toqueCompacto } from "@/components/sistema/estilos";
import { estimarLocal, nomeDoModelo, precoDoModelo, usd, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";

/**
 * O modelo do agente no pé do compositor (frente UXS, 30/09): "<nome> · ~US$
 * 0,01" num chip discreto, no lugar da estimativa solta. Tocar abre o
 * seletor; a escolha fica lembrada pela tela que usa (cada agente guarda na
 * chave dele) e vai no `modelo_id` da conversa. Vazio = o padrão do papel.
 *
 * Não usa a Mesa (useMesa): o agente de contratos vive fora dela. Quem usa
 * passa o catálogo que já tem e as partes da estimativa; a conta é local
 * (estimarLocal), sem ida à rede. Sem conta possível, fica o preço por 1M.
 * Mesmo desenho da LinhaDoModelo da Mesa Ads (ícone Cpu, texto discreto).
 */
export default function ModeloDoAgente({
  catalogo,
  modelo,
  escolhido,
  onEscolher,
  partes,
  carregando = false,
  disabled = false,
  className = "",
}: {
  catalogo: ModeloIa[];
  /** O modelo que vai ser usado (o escolhido, se ainda ativo; senão o padrão do papel). */
  modelo: ModeloIa | null;
  /** O que a pessoa escolheu ("" = padrão do papel). */
  escolhido: string;
  /** Sem ele o chip só mostra (não troca). */
  onEscolher?: (id: string) => void;
  /** Partes da estimativa de uma mensagem com este modelo. */
  partes?: (modeloId: string) => ParteDaEstimativa[];
  /** Catálogo a caminho. */
  carregando?: boolean;
  /** Mensagem indo: não troca no meio. */
  disabled?: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const custo = modelo && partes ? estimarLocal(partes(modelo.id), catalogo) : null;
  const padrao = !escolhido || !modelo || modelo.id !== escolhido;
  const nome = modelo ? nomeDoModelo(modelo) : carregando ? "Lendo os modelos" : "Sem modelo de texto ativo";
  const detalhe = modelo ? (custo !== null ? `~${usd(custo)}` : precoDoModelo(modelo)) : "";
  const linha = `${nome}${detalhe ? ` · ${detalhe}` : ""}${modelo && padrao ? " · padrão" : ""}`;
  const classe = juntar(toqueCompacto, "inline-flex h-8 min-w-0 max-w-full items-center rounded-md px-1 text-left text-[12px] text-muted-foreground", foco, className);

  if (!onEscolher) {
    return (
      <span className={classe} data-modelo-do-agente={modelo ? modelo.id : ""} title="Modelo desta conversa">
        <Cpu className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{linha}</span>
      </span>
    );
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Modelo do agente"
          title="Trocar o modelo desta conversa (a escolha fica lembrada); o preço é o de uma mensagem"
          className={juntar(classe, "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50")}
          data-modelo-do-agente={modelo ? modelo.id : ""}
        >
          <Cpu className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{linha}</span>
          <ChevronDown className={juntar("ml-0.5 h-3.5 w-3.5 shrink-0 transition-transform", aberto ? "rotate-180" : "")} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={6} className="w-[calc(100vw-24px)] max-w-[300px] space-y-2 p-3">
        <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modelo ? modelo.id : ""} onChange={(id) => onEscolher(id)} rotulo="Modelo" disabled={disabled} />
        {custo !== null && <p className="text-[12px] text-muted-foreground">~{usd(custo)} por mensagem</p>}
        {!!escolhido && (
          <button
            type="button"
            className={juntar("rounded text-[12px] text-primary hover:underline", foco)}
            onClick={() => {
              onEscolher("");
              setAberto(false);
            }}
          >
            Voltar ao padrão
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
