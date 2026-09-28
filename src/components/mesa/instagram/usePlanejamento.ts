import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { confirmarPublicacao, lerMelhoresHorarios, textoDoErro } from "@/lib/mesa/api";
import { dataEHoraCurta } from "../PublicacaoDaPeca";
import {
  dataEfetiva,
  distribuirAutomatico,
  moverNaOrdem,
  moverParaDia,
  mudancasDoRascunho,
  mudarData,
  ordemPorData,
  rascunhoValido,
  semAgendamento,
  tipoDoFormato,
  travaDoItem,
  type MudancaDeData,
  type Rascunho,
} from "../../../../supabase/functions/_shared/calendario-da-grade";
import { amanhaAs } from "../../../../supabase/functions/_shared/instagram-do-cliente";
import type { ItemDaGradeNaAba } from "./instagramApi";

/**
 * O planejamento da grade (rodada 3, 28/09): um rascunho só de datas que o
 * calendário (tela Agenda) e o simulador (prévia e Grade e simulador) usam
 * juntos. Mover num lugar aparece no outro na hora. Fica guardado no
 * navegador por cliente até o Confirmar, que aplica pelo mesmo caminho do
 * "Publicar em" (confirmarPublicacao), um por vez, depois da confirmação.
 */

const HORA_PADRAO = "11:30";

export type ConfirmacaoPendente = { id: string; titulo: string; data: string };

export function usePlanejamento({ clientId, escopo, itens, onMudou }: { clientId: string; /** Cliente e marca: o rascunho da Acerbi nunca se mistura com o da CME. */ escopo: string; itens: ItemDaGradeNaAba[]; onMudou: () => void }) {
  const confirmar = useConfirm();
  const queryClient = useQueryClient();
  const [rascunhoBruto, setRascunho] = useEstadoDaTela<Rascunho>(`mesa:instagram:rascunho:${escopo}`, {}, { validar: (v) => !!v && typeof v === "object" && !Array.isArray(v) });
  const [simulados, setSimulados] = useEstadoDaTela<ItemDaGradeNaAba[]>(`mesa:instagram:simulados:${escopo}`, [], { validar: (v) => Array.isArray(v) });
  const [fora, setFora] = useEstadoDaTela<string[]>(`mesa:instagram:fora-da-simulacao:${escopo}`, [], { validar: (v) => Array.isArray(v) });
  const [aplicando, setAplicando] = useState<{ feitos: number; total: number } | null>(null);

  const melhores = useQuery({
    queryKey: ["mesa", "melhores-horarios", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => lerMelhoresHorarios(clientId),
  });
  const horaDoFormato = (formato: string) => {
    const h = melhores.data && melhores.data.por_tipo ? melhores.data.por_tipo[tipoDoFormato(formato)] : null;
    return typeof h === "string" && /^\d{2}:\d{2}/.test(h) ? h.slice(0, 5) : HORA_PADRAO;
  };

  const todos = useMemo(() => itens.concat(simulados), [itens, simulados]);
  const rascunho = useMemo(() => rascunhoValido(todos, rascunhoBruto), [todos, rascunhoBruto]);
  const ordenados = useMemo(() => ordemPorData(todos, rascunho), [todos, rascunho]);
  const efetivos = useMemo(() => ordenados.map((i) => ({ ...i, data: dataEfetiva(i, rascunho) })), [ordenados, rascunho]);
  const naSimulacao = useMemo(() => efetivos.filter((i) => fora.indexOf(i.id) < 0), [efetivos, fora]);
  const mudancas: MudancaDeData[] = useMemo(() => mudancasDoRascunho(todos, rascunho), [todos, rascunho]);
  // Datas propostas (ainda não confirmadas) que o lote também confirma.
  const pendentes: ConfirmacaoPendente[] = useMemo(
    () =>
      itens
        .filter((i) => !rascunho[i.id] && !!i.data && !i.data_confirmada && !semAgendamento(i))
        .map((i) => ({ id: i.id, titulo: i.titulo, data: i.data as string })),
    [itens, rascunho],
  );
  const inicio = amanhaAs(horaDoFormato("estatico"));

  const aplicar = async () => {
    const lote = mudancas.filter((m) => m.agenda).map((m) => ({ id: m.id, titulo: m.titulo, data: m.para })).concat(pendentes);
    if (!lote.length) return;
    const ok = await confirmar({
      title: `Confirmar ${lote.length} ${lote.length === 1 ? "data" : "datas"}?`,
      description: "As datas ficam confirmadas. Cada post só vai ao ar depois da aprovação do cliente.",
      confirmLabel: "Confirmar",
    });
    if (!ok) return;
    const porId: Record<string, ItemDaGradeNaAba> = {};
    for (const i of itens) porId[i.id] = i;
    let feitos = 0;
    const feitosIds: string[] = [];
    for (const m of lote) {
      setAplicando({ feitos, total: lote.length });
      const item = porId[m.id];
      if (!item || !item.peca) continue;
      try {
        await confirmarPublicacao(String(item.peca.id), m.data, !!item.peca.publicar_ao_aprovar);
        feitos++;
        feitosIds.push(m.id);
      } catch (e) {
        toast.error(`"${m.titulo}" não mudou`, { description: textoDoErro(e) });
        break;
      }
    }
    setAplicando(null);
    if (feitos) {
      toast.success(`${feitos} ${feitos === 1 ? "data confirmada" : "datas confirmadas"}`, { description: "Publica só com a aprovação do cliente." });
      const resto: Rascunho = { ...rascunho };
      for (const id of feitosIds) delete resto[id];
      setRascunho(resto);
    }
    void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
    onMudou();
  };

  return {
    todos,
    rascunho,
    ordenados: efetivos,
    naSimulacao,
    fora,
    mudancas,
    pendentes,
    aplicando,
    horaDoFormato,
    fonteDoHorario: melhores.data ? melhores.data.fonte : null,
    travaDoItem,
    semAgendamento,
    mover: (de: number, para: number) => setRascunho(moverNaOrdem(todos, de, para, rascunho, inicio)),
    moverPorId: (id: string, paraId: string) => {
      const ordem = ordemPorData(todos, rascunho).map((i) => i.id);
      const de = ordem.indexOf(id);
      const para = ordem.indexOf(paraId);
      if (de >= 0 && para >= 0) setRascunho(moverNaOrdem(todos, de, para, rascunho, inicio));
    },
    paraDia: (id: string, dia: string) => {
      const i = todos.find((x) => x.id === id);
      if (i) setRascunho(moverParaDia(i, dia, rascunho, horaDoFormato(i.formato)));
    },
    mudarData: (id: string, iso: string) => {
      const i = todos.find((x) => x.id === id);
      if (i) setRascunho(mudarData(i, iso, rascunho));
    },
    automatico: () => {
      const novo = distribuirAutomatico(todos.filter((i) => fora.indexOf(i.id) < 0), rascunho, { inicio, horaDoFormato });
      setRascunho({ ...rascunho, ...novo });
      const n = mudancasDoRascunho(todos, { ...rascunho, ...novo }).length;
      toast.message(n ? `Datas sugeridas para ${n} ${n === 1 ? "post" : "posts"}` : "As datas já estão boas", { description: n ? "Confira o antes e depois e confirme." : undefined });
    },
    descartar: () => setRascunho({}),
    desfazerUm: (id: string) => {
      const resto: Rascunho = { ...rascunho };
      delete resto[id];
      setRascunho(resto);
    },
    aplicar,
    naSimulacaoOuNao: (id: string, dentro: boolean) => setFora(dentro ? fora.filter((x) => x !== id) : fora.concat([id])),
    adicionarSimulado: (s: { bucket: string; caminho: string; nome: string }) => {
      const id = `sim:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const item: ItemDaGradeNaAba = {
        id,
        titulo: s.nome.slice(0, 80) || "Arte do acervo",
        formato: "foto",
        origem: "simulado",
        data: null,
        data_confirmada: false,
        imagem: { bucket: s.bucket, caminho: s.caminho },
        estado: "simulado",
        peca: null,
        publicacao: null,
        dia_da_peca: null,
        task_id: null,
        laminas: [s.caminho],
        legenda: "",
      };
      setSimulados(simulados.concat([item]));
      toast.success("Arte na simulação", { description: "Arraste na grade ou mude a data. Para agendar, crie o post na Mesa Foto." });
      return id;
    },
    removerSimulado: (id: string) => {
      setSimulados(simulados.filter((s) => s.id !== id));
      const resto: Rascunho = { ...rascunho };
      delete resto[id];
      setRascunho(resto);
    },
  };
}

export type Planejamento = ReturnType<typeof usePlanejamento>;

/** "01/10 11:30" ou "sem data". */
export const dataCurtaOuSem = (iso: string | null | undefined) => (iso ? dataEHoraCurta(iso) : "sem data");
