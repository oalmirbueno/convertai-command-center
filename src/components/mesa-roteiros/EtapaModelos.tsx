import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Layers, Loader2, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { modoDoTipo, type EstruturaDoModelo } from "../../../supabase/functions/_shared/roteiro-modelo";
import { chamarRoteiros, CHAVES, useModelos, useRoteiros, type ModeloDeRoteiro } from "./roteirosApi";
import { AvisoDoBanco, BlocoRecolhivel } from "./Comuns";
import BibliotecaValidada from "./BibliotecaValidada";

/**
 * Etapa 5: memória (MEMORIA-E-TEMPLATES.md, de forma simples). Todo roteiro
 * aprovado vira modelo do cliente sozinho (estrutura, ritmo, direção e as
 * falas como exemplo, só deste cliente). O modelo da agência é escolha
 * explícita, com prévia do que sai: sem fala, legenda, CTA, nome, contato,
 * número ou oferta do cliente de origem. Usar um modelo abre um roteiro novo
 * com ele como base (a IA não copia: segue o ritmo com o conteúdo novo).
 */
export default function EtapaModelos({ onUsarModelo, onUsarBase }: { onUsarModelo: (id: string) => void; onUsarBase?: (id: string) => void }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const modelosQ = useModelos(clientId);
  const roteirosQ = useRoteiros(clientId);
  const modelos = modelosQ.data ? modelosQ.data.lista : [];
  const aprovados = (roteirosQ.data ? roteirosQ.data.lista : []).filter((r) => !!r.versao_aprovada && !r.arquivado_em);
  const [origem, setOrigem] = useEstadoDaTela<string>(`mesa-roteiros:modelos:origem:${clientId}`, "", { validar: (v) => typeof v === "string" });
  const [previa, setPrevia] = useState<{ estrutura: EstruturaDoModelo; removidos: string[] } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const verPrevia = async () => {
    if (!origem) return;
    setOcupado("previa");
    try {
      const r = await chamarRoteiros<{ estrutura: EstruturaDoModelo; removidos: string[] }>("modelo_previa", { roteiro_id: origem, escopo: "agencia" });
      setPrevia(r);
    } catch (e) {
      avisarErro(e, "Não foi possível montar a prévia");
    } finally {
      setOcupado(null);
    }
  };

  const salvarDaAgencia = async () => {
    setOcupado("salvar");
    try {
      await chamarRoteiros("modelo_salvar", { roteiro_id: origem, escopo: "agencia" });
      toast.success("Modelo da agência salvo", { description: "Sem dado do cliente de origem." });
      setPrevia(null);
      setOrigem("");
      void qc.invalidateQueries({ queryKey: CHAVES.modelos(clientId) });
    } catch (e) {
      avisarErro(e, "Não foi possível salvar o modelo");
    } finally {
      setOcupado(null);
    }
  };

  const revogar = async (m: ModeloDeRoteiro) => {
    setOcupado(m.id);
    try {
      await chamarRoteiros("modelo_revogar", { modelo_id: m.id });
      toast.success("Modelo retirado", { description: "Não aparece mais para usos novos." });
      void qc.invalidateQueries({ queryKey: CHAVES.modelos(clientId) });
    } catch (e) {
      avisarErro(e, "Não foi possível retirar o modelo");
    } finally {
      setOcupado(null);
    }
  };

  // Frente ROT: a biblioteca "Roteiros validados" vem primeiro e não depende da tabela da memória.
  const biblioteca = <BibliotecaValidada onUsarBase={(id) => (onUsarBase ? onUsarBase(id) : undefined)} />;
  if (modelosQ.data && modelosQ.data.indisponivel) {
    return (
      <div className="min-w-0 space-y-6" data-etapa-modelos="">
        {biblioteca}
        <AvisoDoBanco />
      </div>
    );
  }

  const doCliente = modelos.filter((m) => m.escopo === "cliente");
  const daAgencia = modelos.filter((m) => m.escopo === "agencia");
  const linha = (m: ModeloDeRoteiro) => (
    <li key={m.id} className="flex min-w-0 items-center px-4 py-2.5" data-modelo={m.id}>
      <div className="mr-2 min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{m.nome}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {modoDoTipo(m.tipo).rotulo} · {m.estrutura.blocos.length} blocos · {m.estrutura.duracao_alvo_s}s · {m.estrutura.blocos.map((b) => b.funcao).join(", ")}
        </p>
      </div>
      <button type="button" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")} onClick={() => onUsarModelo(m.id)} aria-label={`Usar ${m.nome} num roteiro novo`}>
        Usar
        <span className="ml-1 hidden sm:inline">num roteiro novo</span>
      </button>
      <button type="button" className={juntar(botao.icone, "ml-1 hover:text-destructive")} disabled={ocupado === m.id} onClick={() => void revogar(m)} aria-label={`Retirar o modelo ${m.nome}`}>
        {ocupado === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </li>
  );

  return (
    <div className="min-w-0 space-y-6" data-etapa-modelos="">
      {biblioteca}
      <BlocoRecolhivel
        chave={`mesa-roteiros:modelos:cliente:${clientId}`}
        nivel={2}
        icone={<UserRound className="h-4 w-4" />}
        titulo="Modelos deste cliente"
        ajuda="Todo roteiro aprovado vira modelo daqui, com estrutura, ritmo, direção e as falas como exemplo. Fica só com este cliente."
        estado={modelosQ.isSuccess ? `${doCliente.length} ${doCliente.length === 1 ? "modelo" : "modelos"}` : undefined}
        resumo={modelosQ.isSuccess ? `${doCliente.length} ${doCliente.length === 1 ? "modelo" : "modelos"}` : undefined}
      >
        {modelosQ.isLoading && <Carregando forma="lista" linhas={2} rotulo="Lendo os modelos" />}
        {!modelosQ.isLoading && !doCliente.length && <EstadoVazio compacto titulo="Nenhum ainda." descricao="Aprove um roteiro na Revisão." />}
        {doCliente.length > 0 && <ul className="divide-y divide-border">{doCliente.map(linha)}</ul>}
      </BlocoRecolhivel>

      <BlocoRecolhivel
        chave={`mesa-roteiros:modelos:agencia:${clientId}`}
        nivel={2}
        icone={<Building2 className="h-4 w-4" />}
        titulo="Modelos da agência"
        ajuda="Estrutura e ritmo que servem a qualquer cliente, sem dado privado. Sai do modelo: fala, legenda, CTA, nome, contato, número e oferta do cliente de origem."
        estado={modelosQ.isSuccess ? `${daAgencia.length} ${daAgencia.length === 1 ? "modelo" : "modelos"}` : undefined}
        resumo={modelosQ.isSuccess ? `${daAgencia.length} ${daAgencia.length === 1 ? "modelo" : "modelos"}` : undefined}
      >
        {!modelosQ.isLoading && !daAgencia.length && <EstadoVazio compacto titulo="Nenhum ainda." />}
        {daAgencia.length > 0 && <ul className="divide-y divide-border">{daAgencia.map(linha)}</ul>}

        {/* 28/09: o cabeçalho feito à mão virou bloco recolhível; listas abertas, sem cartão. */}
        <BlocoRecolhivel chave={`mesa-roteiros:modelos:levar:${clientId}`} nivel={3} icone={<Layers className="h-4 w-4" />} titulo="Levar um roteiro aprovado para a agência">
          <div className="flex min-w-0 items-end">
            <CampoDeFormulario rotulo="Roteiro aprovado de origem" className="mr-2 min-w-0 flex-1 sm:max-w-md">
              <select
                value={origem}
                onChange={(e) => {
                  setOrigem(e.target.value);
                  setPrevia(null);
                }}
                className={campo}
                aria-label="Roteiro aprovado de origem"
              >
                <option value="">{aprovados.length ? "Escolha o roteiro aprovado" : "Nenhum roteiro aprovado ainda"}</option>
                {aprovados.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.titulo}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <button type="button" className={botao.secundario} disabled={!origem || !!ocupado} onClick={() => void verPrevia()}>
              {ocupado === "previa" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Ver prévia
            </button>
          </div>
          {previa && (
            <div className={juntar(superficie.poco, "min-w-0 space-y-2 px-3 py-3")} data-previa-do-modelo="">
              <div className="flex min-w-0 flex-wrap items-center justify-between">
                <p className="mb-1 mr-2 flex min-w-0 items-center text-[12px] font-medium">
                  <ShieldCheck className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">Sai do modelo: {previa.removidos.join(", ")}.</span>
                </p>
                <button type="button" className={juntar(botao.primario, "mb-1")} disabled={!!ocupado} onClick={() => void salvarDaAgencia()}>
                  {ocupado === "salvar" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Salvar como modelo da agência
                </button>
              </div>
              <ol className="space-y-1 text-[12px]">
                {previa.estrutura.blocos.map((b, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    <span className="font-medium">
                      {i + 1}. {b.funcao}
                    </span>{" "}
                    ({b.segundos}s){b.orientacao ? `: ${b.orientacao}` : ""}
                  </li>
                ))}
              </ol>
              {previa.estrutura.mecanismos_de_gancho.length > 0 && (
                <p className={juntar(texto.auxiliar, "leading-5 [overflow-wrap:anywhere]")}>Mecanismos de gancho: {previa.estrutura.mecanismos_de_gancho.join(", ")}</p>
              )}
            </div>
          )}
        </BlocoRecolhivel>
      </BlocoRecolhivel>
    </div>
  );
}
