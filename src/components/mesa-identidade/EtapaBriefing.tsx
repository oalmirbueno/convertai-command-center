import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, espaco, juntar, texto } from "@/components/sistema/estilos";
import { CAMPOS_DO_BRIEFING, type BriefingDaIdentidade, type CampoDoBriefing } from "../../../supabase/functions/mesa-identidade/modulos/briefing-da-identidade";
import { CRITERIOS_PADRAO } from "../../../supabase/functions/mesa-identidade/modulos/naming";
import { chamarIdentidade } from "./identidadeApi";
import { CabecalhoDaEtapa, contextoParaPreencher, Pastilha, useProjetoDaMesa } from "./Comuns";

const ROTULO_DA_FONTE: Record<string, string> = { briefing: "do briefing", contexto: "do painel", equipe: "da equipe" };

const paraTexto = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));
const paraLista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v == null ? "" : v).split(/[,;\n]+/)).map((x) => x.trim()).filter(Boolean);

/**
 * Etapa 2, Briefing: lê o briefing que o cliente respondeu (frente BRF, ou o
 * questionário antigo) e o contexto da marca; o que falta vira pergunta aqui.
 * Salvar é sempre parcial (o que está preenchido fica).
 */
export default function EtapaBriefing() {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const avisarErro = useAvisarErro();
  const montado = useQuery({
    queryKey: ["mesa-identidade", "briefing", projeto.id],
    queryFn: () => chamarIdentidade<{ briefing: BriefingDaIdentidade }>("briefing_montar", { projeto_id: projeto.id }).then((r) => r.briefing),
    staleTime: 5 * 60_000,
  });
  const salvo = (projeto.dados.briefing || {}) as Record<string, unknown>;
  const [valores, setValores] = useState<Record<string, string>>({});
  const [criterios, setCriterios] = useState<string>("");
  const [salvando, setSalvando] = useState(false);

  // Começa pelo que a equipe salvou; o resto vem do briefing e do painel.
  useEffect(() => {
    const base: Record<string, string> = {};
    for (const c of CAMPOS_DO_BRIEFING) {
      const daEquipe = paraTexto(salvo[c.campo]);
      const doMontado = montado.data && montado.data.campos[c.campo] ? paraTexto(montado.data.campos[c.campo]!.valor) : "";
      base[c.campo] = daEquipe || doMontado;
    }
    setValores(base);
    setCriterios(Array.isArray(salvo.criterios_do_nome) ? (salvo.criterios_do_nome as string[]).join("\n") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montado.data, projeto.id]);

  const fonteDe = (c: CampoDoBriefing) => {
    if (salvo[c]) return "equipe";
    const m = montado.data && montado.data.campos[c];
    return m ? m.fonte : null;
  };

  const faltando = useMemo(() => CAMPOS_DO_BRIEFING.filter((c) => !String(valores[c.campo] || "").trim()), [valores]);

  const salvar = async (base: Record<string, string> = valores, crits: string = criterios, frase: string | null = "Briefing salvo") => {
    setSalvando(true);
    try {
      const valor: Record<string, unknown> = {};
      for (const c of CAMPOS_DO_BRIEFING) {
        const v = String(base[c.campo] || "").trim();
        if (!v) continue;
        valor[c.campo] = c.lista ? v.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10) : v.slice(0, 1500);
      }
      const crit = crits.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
      if (crit.length) valor.criterios_do_nome = crit;
      if (montado.data && montado.data.origem.briefing_id) valor.briefing_id = montado.data.origem.briefing_id;
      await salvarParte("briefing", valor);
      if (frase) toast.success(frase);
    } catch (e) {
      avisarErro(e, "O briefing não foi salvo");
      throw e;
    } finally {
      setSalvando(false);
    }
  };

  // "Preencher com IA" (peça comum): cada campo e a seção inteira. O valor entra no campo e é salvo; o Desfazer volta o anterior.
  const campoDaIa = (c: (typeof CAMPOS_DO_BRIEFING)[number]): CampoParaPreencher => ({
    chave: c.campo,
    rotulo: c.rotulo,
    tipo: c.lista ? "lista" : c.campo === "negocio" || c.campo === "publico" || c.campo === "proposito" ? "texto_longo" : "texto",
    valorAtual: c.lista ? paraLista(valores[c.campo]) : valores[c.campo] || "",
    dica: c.pergunta,
    maximo: c.lista ? 8 : 600,
  });
  const aplicarIa = async (v: Record<string, unknown>) => {
    const novos = { ...valores };
    let crits = criterios;
    for (const k of Object.keys(v)) {
      if (k === "criterios_do_nome") crits = paraLista(v[k]).join("\n");
      else novos[k] = Array.isArray(v[k]) ? (v[k] as unknown[]).map(String).join(", ") : v[k] == null ? "" : String(v[k]);
    }
    setValores(novos);
    setCriterios(crits);
    await salvar(novos, crits, null);
  };
  const preencher = (campos: CampoParaPreencher[], rotulo?: string, compacto = false) => (
    <PreencherComIA papel="identidade" clientId={clientId} marcaId={marcaId} campos={campos} contexto={contextoParaPreencher(projeto)} rotulo={rotulo} compacto={compacto} onAplicar={(v) => aplicarIa(v)} onDesfazer={(a) => aplicarIa(a)} />
  );

  return (
    <div className={espaco.pagina} data-etapa-briefing="">
      <CabecalhoDaEtapa
        etapa="briefing"
        ajuda="O briefing respondido pelo cliente entra sozinho; o que o painel já sabe (kit e contexto da marca) completa. Campo vazio é pergunta para o cliente: nada é inventado."
        acoes={
          <button type="button" className={juntar(botao.secundario, "m-1 h-8")} onClick={() => void salvar().catch(() => undefined)} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} Salvar
          </button>
        }
      />
      {montado.isLoading && <Carregando forma="lista" linhas={4} rotulo="Lendo o briefing" />}
      {montado.isError && (
        <p className={juntar(texto.auxiliar, "text-warning")} role="alert">
          O briefing do cliente não foi lido. Dá para preencher aqui mesmo.
        </p>
      )}
      {montado.data && !montado.data.origem.respondido && (
        <p className={texto.auxiliar}>
          Sem briefing respondido. <Link className="text-primary underline-offset-2 hover:underline" to={`/briefings?client=${clientId}`}>Enviar o link do briefing</Link>
        </p>
      )}
      <Secao titulo="A marca" descricao={faltando.length ? `${faltando.length} em aberto` : "Completo"} recolher={`mesa-identidade:${projeto.id}:briefing:marca`} acao={preencher(CAMPOS_DO_BRIEFING.map(campoDaIa), "Preencher tudo")}>
        <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          {CAMPOS_DO_BRIEFING.map((c) => {
            const fonte = fonteDe(c.campo);
            const longo = c.campo === "negocio" || c.campo === "publico" || c.campo === "proposito";
            return (
              <CampoDeFormulario
                key={c.campo}
                rotulo={
                  <span className="flex min-w-0 items-center">
                    <span className="mr-1.5 truncate">{c.rotulo}</span>
                    {fonte && <Pastilha tom={fonte === "equipe" ? "bom" : "neutro"}>{ROTULO_DA_FONTE[fonte]}</Pastilha>}
                    {preencher([campoDaIa(c)], `Preencher ${c.rotulo.toLowerCase()} com IA`, true)}
                  </span>
                }
                apoio={c.lista ? "Separe por vírgula" : undefined}
                obrigatorio={c.essencial}
                largo={longo}
              >
                {longo ? (
                  <textarea className={juntar(campoTexto, "min-h-[72px]")} value={valores[c.campo] || ""} maxLength={1500} placeholder={c.pergunta} onChange={(e) => setValores((v) => ({ ...v, [c.campo]: e.target.value }))} />
                ) : (
                  <input className={campo} value={valores[c.campo] || ""} maxLength={600} placeholder={c.pergunta} onChange={(e) => setValores((v) => ({ ...v, [c.campo]: e.target.value }))} />
                )}
              </CampoDeFormulario>
            );
          })}
        </div>
      </Secao>
      {(projeto.modo === "zero" || projeto.com_naming) && (
        <Secao
          titulo="Critérios do nome"
          descricao="Um por linha"
          divisoria
          recolher={`mesa-identidade:${projeto.id}:briefing:criterios`}
          acao={preencher([{ chave: "criterios_do_nome", rotulo: "Critérios do nome", tipo: "lista", valorAtual: paraLista(criterios), dica: "Critérios para julgar os nomes (som, sentido, diferença, idioma).", maximo: 6 }], "Preencher com IA")}
        >
          <textarea className={juntar(campoTexto, "min-h-[96px]")} value={criterios} maxLength={1200} placeholder={CRITERIOS_PADRAO.join("\n")} onChange={(e) => setCriterios(e.target.value)} aria-label="Critérios do nome" />
        </Secao>
      )}
    </div>
  );
}
