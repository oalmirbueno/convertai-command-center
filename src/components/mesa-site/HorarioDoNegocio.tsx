import { Plus, X } from "lucide-react";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { DIAS_NA_TELA, horaDoTexto, lerLinhaDeHorario, textoDaLinhaDeHorario } from "../../../supabase/functions/_shared/site-lancamento";

/**
 * Horário de funcionamento em pílulas (UXS 30/09): dias Seg a Dom, "abre" e
 * "fecha" em HH:MM (fecha aceita 24:00; fechar depois da meia-noite vale), e
 * "+ horário" até 7 linhas (Seg a Sex + Sáb, ou o intervalo do almoço). Grava
 * no formato do schema (a ida e a volta não perdem nada). Linha que não dá
 * para mostrar em pílulas fica como texto e vai como está: nunca some.
 */

export type LinhaDaTela = { id: string; dias: boolean[]; abre: string; fecha: string; texto?: string };

export const MAX_LINHAS_DE_HORARIO = 7;

let proximoId = 0;
const novoId = () => `h${(proximoId += 1)}`;

/** As linhas da tela a partir da lista salva (schema) ou da que o ✨ trouxe. */
export function linhasDoHorario(lista: string[]): LinhaDaTela[] {
  return lista.slice(0, MAX_LINHAS_DE_HORARIO).map((h) => {
    const l = lerLinhaDeHorario(h);
    return l ? { id: novoId(), ...l } : { id: novoId(), dias: [false, false, false, false, false, false, false], abre: "", fecha: "", texto: String(h) };
  });
}

/** A hora digitada em HH:MM ("93:0" da máscara também vale: só os números, 9:30). */
export const horaDaTela = (v: string, fechar: boolean): string | null => horaDoTexto(v, fechar) || horaDoTexto(String(v || "").replace(/\D/g, ""), fechar);

/** A linha da tela no formato do schema (null quando falta dia ou a hora é inválida). */
export const linhaNoSchema = (l: LinhaDaTela): string | null => textoDaLinhaDeHorario({ dias: l.dias, abre: horaDaTela(l.abre, false) || "", fecha: horaDaTela(l.fecha, true) || "" });

/** A lista para gravar e as linhas incompletas (sem dia ou com hora inválida), para avisar antes. */
export function horarioParaSalvar(linhas: LinhaDaTela[]): { lista: string[]; incompletas: number } {
  const lista: string[] = [];
  let incompletas = 0;
  linhas.forEach((l) => {
    if (l.texto !== undefined) {
      if (l.texto.trim()) lista.push(l.texto.trim());
      return;
    }
    const t = linhaNoSchema(l);
    if (t) lista.push(t);
    else incompletas += 1;
  });
  return { lista, incompletas };
}

/** Máscara HH:MM enquanto digita (só números; os dois-pontos entram sozinhos). */
const mascara = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
};

function CampoDeHora({ valor, onMudar, rotulo, fechar }: { valor: string; onMudar: (v: string) => void; rotulo: string; fechar: boolean }) {
  const invalida = !!valor && !horaDaTela(valor, fechar);
  return (
    <input
      value={valor}
      onChange={(e) => onMudar(mascara(e.target.value))}
      onBlur={() => {
        const h = horaDaTela(valor, fechar);
        if (h && h !== valor) onMudar(h);
      }}
      inputMode="numeric"
      maxLength={5}
      placeholder={fechar ? "18:00" : "09:00"}
      aria-label={rotulo}
      aria-invalid={invalida || undefined}
      className={juntar(campo, "h-8 w-[72px] shrink-0 text-center tabular-nums", invalida && "border-destructive")}
    />
  );
}

export default function HorarioDoNegocio({ linhas, onMudar }: { linhas: LinhaDaTela[]; onMudar: (l: LinhaDaTela[]) => void }) {
  const mudar = (id: string, v: Partial<LinhaDaTela>) => onMudar(linhas.map((l) => (l.id === id ? { ...l, ...v } : l)));
  const alternarDia = (id: string, d: number) => onMudar(linhas.map((l) => (l.id === id ? { ...l, dias: l.dias.map((x, i) => (i === d ? !x : x)) } : l)));
  const somar = () => onMudar(linhas.concat([{ id: novoId(), dias: [true, true, true, true, true, false, false], abre: "09:00", fecha: "18:00" }]));
  return (
    <div className="min-w-0" data-horario-do-negocio="">
      <span className={juntar(texto.rotulo, "mb-1 block")}>Horário</span>
      {!linhas.length && <p className={texto.auxiliar}>Sem horário</p>}
      <ul className="min-w-0">
        {linhas.map((l, n) => {
          const incompleta = l.texto === undefined && !linhaNoSchema(l);
          return (
            <li key={l.id} className="flex min-w-0 flex-wrap items-center py-1" data-linha-de-horario={n + 1}>
              {l.texto !== undefined ? (
                // Fora do formato das pílulas: fica visível como texto e vai como está.
                <input value={l.texto} onChange={(e) => mudar(l.id, { texto: e.target.value })} className={juntar(campo, "mb-1 mr-2 h-8 min-w-0 flex-1")} aria-label={`Horário ${n + 1} (texto)`} />
              ) : (
                <>
                  <div className="mb-1 mr-2 flex min-w-0 flex-wrap" role="group" aria-label={`Dias do horário ${n + 1}`}>
                    {DIAS_NA_TELA.map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={l.dias[i]}
                        onClick={() => alternarDia(l.id, i)}
                        className={juntar(etiqueta, "toque-compacto mb-1 mr-1 h-7 px-2 text-[12px]", l.dias[i] ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="mb-1 mr-2 flex shrink-0 items-center">
                    <CampoDeHora valor={l.abre} onMudar={(v) => mudar(l.id, { abre: v })} rotulo={`Abre (horário ${n + 1})`} fechar={false} />
                    <span className={juntar(texto.auxiliar, "mx-1.5")}>às</span>
                    <CampoDeHora valor={l.fecha} onMudar={(v) => mudar(l.id, { fecha: v })} rotulo={`Fecha (horário ${n + 1})`} fechar />
                  </div>
                </>
              )}
              {incompleta && <span className={juntar(texto.etiqueta, "mb-1 mr-2 text-destructive")}>falta dia ou hora</span>}
              <button type="button" className={juntar(botao.icone, "mb-1")} aria-label={`Tirar o horário ${n + 1}`} title="Tirar" onClick={() => onMudar(linhas.filter((x) => x.id !== l.id))}>
                <X className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
      {linhas.length < MAX_LINHAS_DE_HORARIO && (
        <button type="button" className={botao.discreto} onClick={somar} data-somar-horario="">
          <Plus className="mr-1 h-3.5 w-3.5" />
          horário
        </button>
      )}
    </div>
  );
}
