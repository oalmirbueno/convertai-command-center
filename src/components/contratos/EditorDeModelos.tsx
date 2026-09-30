import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type ModeloNaTela, type Preferencias } from "@/lib/contratos/api";
import { PartesDoDiff } from "./DiffDeTexto";
import type { ClausulaDoModelo, ParteDoDiff, VariavelDoModelo } from "../../../supabase/functions/_shared/contrato-modelo";
import { ROTULO_DAS_EXTRAS } from "../../../supabase/functions/contratos/modulos/contrato-modelo-extras-v1";

/**
 * Editor de modelos de contrato (frente CON2, 30/09), em /contratos?vista=modelos.
 * Versão publicada nunca muda: editar é publicar a versão N+1, com a
 * diferença conferida antes e o Confirmar. Os contratos já montados guardam a
 * versão que usaram. Texto mudado volta a "revisão jurídica pendente".
 * Embaixo, as preferências do dono: cláusulas extras ligadas por padrão e os
 * dias do aviso de vencimento e do lembrete de assinatura. Só o admin publica.
 */

type Conferencia = { erros: string[]; avisos: string[]; resumo: { alteradas: string[]; novas: string[]; removidas: string[]; variaveis: string[] }; diffs: Array<{ chave: string; titulo: string; partes: ParteDoDiff[] }>; versao_nova: number };
type Resposta = { modelos: ModeloNaTela[]; preferencias: Preferencias };

const ROTULO_DO_TIPO: Record<string, string> = { condicoes_gerais: "Condições gerais", bloco: "Anexo de serviço", extras: "Cláusulas extras", aditivo: "Termo aditivo" };

export default function EditorDeModelos({ aoVoltar }: { aoVoltar: () => void }) {
  const { profile } = useAuth();
  const admin = profile?.role === "admin";
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVES_DOS_CONTRATOS.modelos, queryFn: () => chamarContratos<Resposta>("modelos_listar") });
  const [chave, setChave] = useState<string>("condicoes_gerais");
  const [clausulas, setClausulas] = useState<ClausulaDoModelo[]>([]);
  const [variaveis, setVariaveis] = useState<VariavelDoModelo[]>([]);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const modelo = useMemo(() => (consulta.data ? consulta.data.modelos.find((m) => m.chave === chave) || null : null), [consulta.data, chave]);
  useEffect(() => {
    if (!modelo) return;
    setClausulas(modelo.ativo.clausulas.map((c) => ({ ...c })));
    setVariaveis(modelo.ativo.variaveis.map((v) => ({ ...v })));
    setConferencia(null);
  }, [modelo]);

  if (consulta.isLoading) return <Carregando forma="aba" rotulo="Abrindo os modelos" />;
  if (consulta.isError || !consulta.data) return <EstadoDeErro titulo={textoDoErro(consulta.error, "Os modelos não abriram.")} acao={<button type="button" className={botao.secundario} onClick={() => consulta.refetch()}>Tentar de novo</button>} />;

  const rascunho = { nome: modelo ? modelo.nome : "", clausulas, variaveis };
  const mudarClausula = (i: number, m: Partial<ClausulaDoModelo>) => {
    setClausulas((l) => l.map((c, k) => (k === i ? { ...c, ...m } : c)));
    setConferencia(null);
  };
  const conferir = async () => {
    setOcupado(true);
    try {
      setConferencia(await chamarContratos<Conferencia>("modelo_conferir", { chave, rascunho }));
    } catch (e) {
      toast.error("Não deu para conferir", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };
  const publicar = async () => {
    setConfirmando(false);
    setOcupado(true);
    try {
      const r = await chamarContratos<{ publicado: { versao: number } }>("modelo_publicar", { chave, rascunho, confirmar: true });
      await qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.modelos });
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.contexto });
      toast.success(`Versão ${r.publicado.versao} publicada`, { description: "Contratos novos usam esta versão. Os já montados continuam na deles." });
    } catch (e) {
      toast.error("A versão não foi publicada", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6" data-editor-de-modelos="">
      <div className="flex min-w-0 items-center">
        <button type="button" onClick={aoVoltar} className={juntar(botao.icone, "mr-1")} aria-label="Voltar para os contratos">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <CabecalhoDeSecao
          className="min-w-0 flex-1"
          titulo="Modelos de contrato"
          descricao={modelo ? `${ROTULO_DO_TIPO[modelo.tipo] || modelo.tipo} · versão ${modelo.ativo.versao} · ${modelo.ativo.revisao_juridica}` : undefined}
          ajuda="Versão publicada não muda: aqui você edita e publica a próxima. Contratos já montados continuam na versão deles. Texto mudado volta a revisão jurídica pendente até o advogado conferir."
          acao={
            <SeletorCompacto
              rotulo="Modelo"
              modo="lista"
              opcoes={consulta.data.modelos.map((m) => ({ valor: m.chave, rotulo: m.nome, descricao: `v${m.ativo.versao}` }))}
              valor={chave}
              onEscolher={setChave}
            />
          }
        />
      </div>

      {modelo && (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-clausulas-do-modelo="">
          {clausulas.map((c, i) => (
            <li key={`${i}-${c.chave}`} className="min-w-0 space-y-2 px-2 py-3">
              <div className="flex min-w-0 items-center">
                <span className={juntar(texto.auxiliar, "mr-2 w-6 shrink-0 tabular-nums")}>{i + 1}.</span>
                <input value={c.titulo} onChange={(e) => mudarClausula(i, { titulo: e.target.value })} className={juntar(campo, "min-w-0 flex-1")} aria-label={`Título da cláusula ${i + 1}`} disabled={!admin} />
                {c.quando && <span className={juntar(texto.auxiliar, "ml-2 hidden shrink-0 sm:inline")}>quando {c.quando.variavel}{c.quando.igual ? ` = ${c.quando.igual}` : c.quando.preenchida ? " preenchida" : ""}</span>}
                {admin && (
                  <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => { setClausulas((l) => l.filter((_x, k) => k !== i)); setConferencia(null); }} aria-label={`Tirar a cláusula ${c.titulo}`}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <textarea value={c.texto} onChange={(e) => mudarClausula(i, { texto: e.target.value })} rows={4} className={campoTexto} aria-label={`Texto da cláusula ${c.titulo}`} disabled={!admin} />
            </li>
          ))}
        </ul>
      )}
      {modelo && admin && (
        <button type="button" className={botao.secundario} onClick={() => setClausulas((l) => l.concat([{ chave: `nova_${l.length + 1}`, titulo: "Nova cláusula", texto: "" }]))}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Cláusula
        </button>
      )}

      {modelo && variaveis.length > 0 && (
        <Secao titulo="Padrões dos campos" divisoria recolher={`contratos:modelos:padroes:${chave}`} ajuda="O valor que cada campo já traz num contrato novo. Mudar o padrão também publica uma versão nova.">
          <GrupoDeCampos colunas={3}>
            {variaveis.map((v, i) => (
              <CampoDeFormulario key={v.nome} rotulo={v.rotulo} apoio={v.nome}>
                {v.tipo === "escolha" ? (
                  <select value={v.padrao || ""} onChange={(e) => { setVariaveis((l) => l.map((x, k) => (k === i ? { ...x, padrao: e.target.value || undefined } : x))); setConferencia(null); }} className={campo} disabled={!admin}>
                    <option value="">Sem padrão</option>
                    {(v.opcoes || []).map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={v.padrao || ""} onChange={(e) => { setVariaveis((l) => l.map((x, k) => (k === i ? { ...x, padrao: e.target.value || undefined } : x))); setConferencia(null); }} className={campo} disabled={!admin} />
                )}
              </CampoDeFormulario>
            ))}
          </GrupoDeCampos>
        </Secao>
      )}

      {conferencia && (
        <div className="min-w-0 space-y-3" data-conferencia-do-modelo="">
          {conferencia.erros.map((e) => (
            <p key={e} className={juntar(texto.corpo, "text-destructive")}>{e}</p>
          ))}
          {conferencia.avisos.map((e) => (
            <p key={e} className={juntar(texto.auxiliar, "text-warning")}>{e}</p>
          ))}
          <p className={texto.auxiliar}>
            {`Muda: ${conferencia.resumo.alteradas.length} alteradas, ${conferencia.resumo.novas.length} novas, ${conferencia.resumo.removidas.length} saem, ${conferencia.resumo.variaveis.length} campos.`}
          </p>
          {conferencia.diffs.map((d) => (
            <div key={d.chave} className="min-w-0 rounded-md bg-muted/50 p-3">
              <p className={juntar(texto.rotulo, "mb-1.5")}>{d.titulo}</p>
              <PartesDoDiff partes={d.partes} />
            </div>
          ))}
        </div>
      )}

      {modelo && admin && (
        <div className="flex min-w-0 items-center justify-end [&>*+*]:ml-2">
          <button type="button" className={botao.secundario} onClick={() => void conferir()} disabled={ocupado}>
            {ocupado && !conferencia ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Ver a diferença
          </button>
          <button type="button" className={botao.primario} onClick={() => setConfirmando(true)} disabled={ocupado || !conferencia || conferencia.erros.length > 0}>
            <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> Publicar versão {conferencia ? conferencia.versao_nova : ""}
          </button>
        </div>
      )}

      <PreferenciasDosContratos preferencias={consulta.data.preferencias} admin={admin} />

      <ConfirmModal
        open={confirmando}
        onCancel={() => setConfirmando(false)}
        title={`Publicar a versão ${conferencia ? conferencia.versao_nova : ""}?`}
        description="Contratos novos passam a usar esta versão. Os já montados continuam na versão deles."
        confirmLabel="Publicar"
        onConfirm={() => void publicar()}
      />
    </div>
  );
}

function PreferenciasDosContratos({ preferencias, admin }: { preferencias: Preferencias; admin: boolean }) {
  const qc = useQueryClient();
  const [p, setP] = useState<Preferencias>(preferencias);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setP(preferencias), [preferencias]);
  const mudou = JSON.stringify(p) !== JSON.stringify(preferencias);
  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await chamarContratos<{ preferencias: Preferencias; anterior: Preferencias }>("preferencias_salvar", { extras: p.extras, avisos: p.avisos });
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.modelos });
      toast.success("Preferências salvas", {
        action: {
          label: "Desfazer",
          onClick: () => void chamarContratos("preferencias_salvar", { extras: r.anterior.extras, avisos: r.anterior.avisos }).then(() => qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.modelos })).catch((e) => toast.error("Não foi desfeito", { description: textoDoErro(e) })),
        },
      });
    } catch (e) {
      toast.error("Não foi salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Secao titulo="Biblioteca e avisos" divisoria recolher="contratos:modelos:preferencias" ajuda="Cada cláusula extra pode nascer ligada em todo contrato novo, desligada (a equipe liga quando precisar) ou ficar fora da biblioteca. Os avisos valem para a rotina diária dos contratos.">
      <GrupoDeCampos colunas={3}>
        {Object.keys(ROTULO_DAS_EXTRAS).map((k) => (
          <CampoDeFormulario key={k} rotulo={ROTULO_DAS_EXTRAS[k as keyof typeof ROTULO_DAS_EXTRAS]}>
            <select value={p.extras[k] || "padrao_nao"} onChange={(e) => setP((x) => ({ ...x, extras: { ...x.extras, [k]: e.target.value as Preferencias["extras"][string] } }))} className={campo} disabled={!admin}>
              <option value="padrao_sim">Ligada por padrão</option>
              <option value="padrao_nao">Desligada por padrão</option>
              <option value="desligada">Fora da biblioteca</option>
            </select>
          </CampoDeFormulario>
        ))}
        <CampoDeFormulario rotulo="Aviso de vencimento (dias antes)">
          <input type="number" min={5} max={120} value={p.avisos.aviso_vencimento_dias} onChange={(e) => setP((x) => ({ ...x, avisos: { ...x.avisos, aviso_vencimento_dias: Number(e.target.value) } }))} className={campo} disabled={!admin} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Lembrete de assinatura (dias)">
          <input type="number" min={1} max={30} value={p.avisos.lembrete_assinatura_dias} onChange={(e) => setP((x) => ({ ...x, avisos: { ...x.avisos, lembrete_assinatura_dias: Number(e.target.value) } }))} className={campo} disabled={!admin} />
        </CampoDeFormulario>
      </GrupoDeCampos>
      {admin && (
        <div className="mt-4 flex min-w-0 items-center justify-end">
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !mudou}>
            {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Salvar preferências
          </button>
        </div>
      )}
    </Secao>
  );
}

