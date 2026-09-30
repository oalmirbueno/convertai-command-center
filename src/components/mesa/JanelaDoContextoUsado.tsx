import { useQuery } from "@tanstack/react-query";
import { Check, Layers, Minus } from "lucide-react";
import { Carregando, juntar, texto } from "@/components/sistema";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { lerContextoUsado } from "@/lib/mesa/contextoUsado";
import { dataCurta, type PacoteDaMarca } from "../../../supabase/functions/_shared/contexto-completo-regras";

/**
 * Janela central "O que os agentes leem" (frente SYNC, 30/09/2026). Mostra,
 * da marca aberta, a linha "Usando: ..." e o que ainda falta para o agente
 * ter o contexto completo (estratégia aprovada, briefing respondido, dossiê).
 * Leitura leve e só com a janela aberta (src/lib/mesa/contextoUsado.ts), com
 * as mesmas regras do servidor. Abre na JanelaCentral do sistema (nunca
 * gaveta lateral).
 */

type Item = { chave: string; le: boolean; texto: string };

export function itensDaJanela(p: PacoteDaMarca): Item[] {
  const nome = p.marca ? p.marca.nome : p.nomeCliente;
  const temContexto = Object.keys(p.contexto || {}).some((k) => k !== "marca" && k !== "fontes_lidas" && k !== "lacunas");
  const temKit = !!p.kit && (p.kit.paleta.length > 0 || !!p.kit.estilo || p.kit.temLogo);
  return [
    { chave: "contexto", le: temContexto, texto: temContexto ? `Contexto da marca ${nome} (negócio, público, oferta e tom)` : `Contexto da marca ${nome} ainda vazio` },
    { chave: "kit", le: temKit, texto: temKit ? `Kit da marca${p.kit && p.kit.temLogo ? " com logo" : ""}${p.kit && p.kit.paleta.length ? ` e ${p.kit.paleta.length} cor(es)` : ""}` : "Kit da marca sem logo nem cores" },
    {
      chave: "estrategia",
      le: !!p.estrategia,
      texto: p.estrategia
        ? `Estratégia v${p.estrategia.versao} da Mesa Identidade${p.estrategia.aprovada ? ", aprovada" : ", em construção"}${p.estrategia.tagline ? `, tagline "${p.estrategia.tagline}"` : ""}`
        : "Sem estratégia de marca na Mesa Identidade",
    },
    {
      chave: "briefing",
      le: !!p.briefing,
      texto: p.briefing ? `Briefing${p.briefing.titulo ? ` "${p.briefing.titulo}"` : ""}${dataCurta(p.briefing.data) ? ` de ${dataCurta(p.briefing.data)}` : ""}${p.briefing.enviado ? "" : " (ainda não respondido)"}` : "Nenhum briefing desta marca",
    },
    { chave: "dossie", le: !!p.dossie, texto: p.dossie ? `Dossiê atual${dataCurta(p.dossie.data) ? ` de ${dataCurta(p.dossie.data)}` : ""}` : "Sem dossiê atual desta marca" },
    { chave: "decisoes", le: p.decisoes.length > 0, texto: p.decisoes.length ? `${p.decisoes.length} decisão(ões) do conselho` : "Nenhuma decisão do conselho" },
    { chave: "cerebro", le: !!p.cerebro && p.cerebro.regras > 0, texto: p.cerebro && p.cerebro.regras ? `Cérebro com ${p.cerebro.regras} regra(s) ensinada(s)` : "Nenhuma regra ensinada ainda" },
    { chave: "instagram", le: !!p.instagram, texto: p.instagram ? `Instagram ${p.instagram.contas.map((c) => `@${c}`).join(", ")}` : "Sem Instagram ligado a esta marca" },
  ];
}

export default function JanelaDoContextoUsado({ clientId, marcaId, onClose }: { clientId: string; marcaId: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["mesa", "contexto-usado", clientId, marcaId || "-"],
    queryFn: () => lerContextoUsado(clientId, marcaId),
    staleTime: 60_000,
  });
  const itens = q.data ? itensDaJanela(q.data.pacote) : [];
  return (
    <JanelaCentral
      aberta
      onFechar={onClose}
      titulo="O que os agentes leem"
      icone={<Layers className="h-4 w-4" />}
      largura="sm"
      ajuda="Todo agente e toda geração com IA desta mesa lê o mesmo pacote da marca aberta: contexto e kit, a estratégia aprovada na Mesa Identidade (tom e tagline), o briefing mais novo, o dossiê, as decisões do conselho, as regras ensinadas e o Instagram. A marca que não é a principal só lê o que é dela. O que falta aparece aqui para a equipe completar."
      rotuloDaAjuda="O que esta janela mostra?"
      descricaoOculta="O contexto da marca que os agentes desta mesa usam"
      data-janela-do-contexto-usado=""
    >
      <div className="space-y-4">
        {q.isLoading && <Carregando linhas={3} rotulo="Lendo o contexto da marca" />}
        {q.isError && <p className="text-[13px] text-destructive" role="alert">Não deu para ler o contexto agora. Feche e abra de novo.</p>}
        {q.data && (
          <>
            <p className={texto.corpo} data-linha-do-usando="">{q.data.linha}</p>
            <ul className="space-y-1.5">
              {itens.map((i) => (
                <li key={i.chave} className="flex min-w-0 items-start" data-item-usado={i.le ? "le" : "falta"}>
                  {i.le ? <Check className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" /> : <Minus className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className={juntar(i.le ? texto.corpo : texto.auxiliar, "min-w-0 [overflow-wrap:anywhere]")}>{i.texto}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </JanelaCentral>
  );
}
