import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { botao, juntar } from "@/components/sistema/estilos";
import { useMesa } from "./MesaContexto";
import { JanelaDaAprovada, type AprovadaSemData } from "./AprovadasSemData";

/**
 * "Agendar" no Estúdio (frente AP, 28/09). Pedido do dono: "nova função de
 * agendamento pelo próprio Estúdio quando terminar; a ideia é facilitar".
 *
 * Com a arte entregue, um botão abre a mesma janela curta das aprovadas sem
 * data: data e hora já sugeridas pela data do conteúdo (dia da pauta com o
 * melhor horário), vai postar ou não, e os perfis da marca. Confirmar grava
 * pelo publicacao_confirmar: aprovada, agenda na hora; sem aprovação, fica
 * marcada e o banco agenda quando o cliente aprovar (a regra de sempre).
 *
 * Só admin e gestor (quem agenda). Onde plugar: na barra do item do Estúdio,
 * ao lado de Entrega, quando o trabalho está entregue.
 */
export default function AgendarDoEstudio({
  trabalho,
  item,
  className = "",
}: {
  trabalho: { id: string; status: string; file_ids?: string[] | null; post_id?: string | null; aprovado_em?: string | null; publicar_em?: string | null; entrega_aviso?: string | null; tipo?: string | null } | null;
  item: { id: string; title: string; due_date?: string | null; project_id?: string | null };
  className?: string;
}) {
  const { podeRecarregar } = useMesa();
  const [aberta, setAberta] = useState(false);
  if (!podeRecarregar || !trabalho || trabalho.status !== "entregue" || trabalho.tipo === "ads" || !(trabalho.file_ids || []).length) return null;
  const peca: AprovadaSemData = {
    id: trabalho.id,
    task_id: item.id,
    file_ids: trabalho.file_ids || [],
    post_id: trabalho.post_id || null,
    aprovado_em: trabalho.aprovado_em || null,
    publicar_em: trabalho.publicar_em || null,
    entrega_aviso: trabalho.entrega_aviso || null,
    titulo: item.title,
    dia: item.due_date || null,
    project_id: item.project_id || null,
  };
  return (
    <>
      {/* 16/10/2026 (dono: "texto + ícone vira só o ícone, sem bordas"): o nome fica no title e no leitor de tela. */}
      <button type="button" className={juntar(botao.icone, className)} onClick={() => setAberta(true)} aria-label="Agendar" title="Agendar" data-agendar-do-estudio="">
        <CalendarCheck className="h-4 w-4" aria-hidden="true" />
      </button>
      {aberta && (
        <JanelaDaAprovada peca={peca} posicao={1} total={1} titulo="Agendar" onFechar={() => setAberta(false)} onFeita={() => setAberta(false)} />
      )}
    </>
  );
}
