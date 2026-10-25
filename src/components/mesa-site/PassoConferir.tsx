import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ImageOff } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, espaco, juntar, texto } from "@/components/sistema/estilos";
import { CAMPOS_DO_CONTEXTO, camposPreenchidos, type ContextoDoCliente } from "../../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import { CHAVES_DA_JORNADA, ROTULO_DA_ORIGEM, useContextoDoCliente } from "./jornadaApi";
import { useBarraDaEtapa } from "./BarraDaEtapa";
import { jornadaDoSite } from "./jornadaApi";
import ProdutosDaLoja from "./ProdutosDaLoja";

type Valores = Record<string, string>;

const ler = (c: ContextoDoCliente, chave: string): unknown => chave.split(".").reduce((acc: any, k) => (acc && typeof acc === "object" ? acc[k] : undefined), c as unknown);

/** Os valores da tela (lista vira uma linha por item). */
export function valoresDoContexto(c: ContextoDoCliente): Valores {
  const v: Valores = {};
  CAMPOS_DO_CONTEXTO.forEach((f) => {
    const x = ler(c, f.chave);
    v[f.chave] = Array.isArray(x) ? x.join("\n") : String(x || "");
  });
  return v;
}

/** Só o que mudou em relação ao que veio, no formato do contexto (contatos dentro de contatos). */
export function editadoDaTela(valores: Valores, base: Valores): Record<string, unknown> {
  const saida: Record<string, any> = {};
  CAMPOS_DO_CONTEXTO.forEach((f) => {
    if ((valores[f.chave] || "") === (base[f.chave] || "")) return;
    const v = f.lista ? (valores[f.chave] || "").split("\n").map((x) => x.trim()).filter(Boolean) : (valores[f.chave] || "").trim();
    const partes = f.chave.split(".");
    if (partes.length === 2) saida[partes[0]] = { ...(saida[partes[0]] || {}), [partes[1]]: v };
    else saida[f.chave] = v;
  });
  return saida;
}

/**
 * Passo 3: conferir o que veio do cliente. Marca, cores e fontes vêm do kit
 * da marca aberta (outra marca nunca herda); o resto (negócio, público,
 * oferta, produtos, contatos, endereço, horários, Instagram, copy aprovada)
 * vem preenchido e se edita aqui. O que a equipe muda vale só para este site.
 */
export default function PassoConferir({ site }: { site: LinhaDoSite }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const salvar = useSalvarSite(clientId, marca ? marca.id : null);
  const q = useContextoDoCliente(site.id);
  const base = useMemo(() => (q.data ? valoresDoContexto(q.data.contexto) : null), [q.data]);
  const [valores, setValores] = useState<Valores>({});
  const [dossieRecolhido, setDossieRecolhido] = useRecolhido(`mesa-site:jornada:dossie:${site.id}`, true);

  useEffect(() => {
    if (base) setValores(base);
  }, [base]);

  const mudancas = base ? editadoDaTela(valores, base) : {};
  const mudou = Object.keys(mudancas).length > 0;
  const contagem = q.data ? camposPreenchidos(q.data.contexto) : null;

  const gravar = async () => {
    if (!mudou) return true;
    await salvar("jornada_salvar", { site_id: site.id, contexto: mudancas });
    await qc.invalidateQueries({ queryKey: CHAVES_DA_JORNADA.contexto(site.id) });
    return true;
  };
  useBarraDaEtapa(
    { estado: contagem ? `${contagem.feitos} de ${contagem.total} preenchidos` : "Lendo o cliente", ocupado: q.isLoading, salvar: true, nadaASalvar: !mudou },
    { antesDeSeguir: gravar, aoSalvar: gravar },
  );

  if (q.isLoading) return <Carregando forma="aba" rotulo="Lendo o que o painel sabe do cliente" />;
  if (q.isError || !q.data) {
    return (
      <EstadoDeErro
        titulo="O contexto do cliente não abriu."
        acao={
          <button type="button" className={botao.secundario} onClick={() => void q.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );
  }
  const c = q.data.contexto;
  const origem = q.data.origem || {};

  return (
    <div className={espaco.pagina} data-passo-conferir="">
      <Secao titulo="Marca" descricao={c.marca.nome || "Sem nome"} ajuda="Logo, cores e fontes vêm do kit da marca aberta (Mesa do cliente). Para trocar, edite o kit: o site lê de lá na construção." recolher={false} data-marca-conferida="">
        <div className="flex min-w-0 flex-wrap items-center">
          <span className={juntar(texto.corpo, "mb-2 mr-4 inline-flex items-center")} title={c.marca.logo ? "Logo no kit" : "Sem logo no kit"}>
            {c.marca.logo ? <Check className="mr-1 h-4 w-4 text-primary" aria-hidden="true" /> : <ImageOff className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            {c.marca.logo ? "Logo" : "Sem logo"}
          </span>
          <span className="mb-2 mr-4 inline-flex items-center" aria-label={`Cores: ${c.marca.cores.join(", ") || "nenhuma"}`}>
            {c.marca.cores.length ? c.marca.cores.map((cor) => <span key={cor} className="mr-1 inline-block h-5 w-5 rounded-md border border-border" style={{ background: cor }} title={cor} />) : <span className={texto.auxiliar}>Sem cores no kit</span>}
          </span>
          <span className={juntar(texto.auxiliar, "mb-2 min-w-0 truncate")}>{c.marca.fontes.length ? c.marca.fontes.join(" · ") : "Fontes do método da casa"}</span>
        </div>
        {c.marca.tom && <p className={juntar(texto.auxiliar, "whitespace-normal")}>Tom: {c.marca.tom}</p>}
      </Secao>

      <Secao
        titulo="Dados do cliente"
        descricao={contagem ? `${contagem.feitos} de ${contagem.total} preenchidos` : ""}
        ajuda="Veio do contexto da marca, da estratégia aprovada, do dossiê, do Instagram, do cadastro e dos dados do site. Campo vazio fica vazio no site (o motor nunca inventa). O que você muda aqui vale só para este site."
        recolher={false}
      >
        <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2 desk:grid-cols-3" data-campos-do-contexto="">
          {CAMPOS_DO_CONTEXTO.map((f) => {
            const de = origem[f.chave] ? `Veio de: ${ROTULO_DA_ORIGEM[origem[f.chave]] || origem[f.chave]}` : "Sem dado no painel";
            const valor = valores[f.chave] || "";
            const mexido = base ? valor !== (base[f.chave] || "") : false;
            return (
              <label key={f.chave} className={juntar("block min-w-0", f.longo || f.lista ? "lg:col-span-1" : "")} title={de} data-campo={f.chave}>
                <span className={juntar(texto.rotulo, "mb-1 flex min-w-0 items-center")}>
                  <span className="min-w-0 truncate">{f.rotulo}</span>
                  {mexido && <span className="ml-1 shrink-0 text-primary">· editado</span>}
                  {!valor && <span className="ml-1 shrink-0">· vazio</span>}
                </span>
                {f.longo || f.lista ? (
                  <textarea value={valor} onChange={(e) => setValores((v) => ({ ...v, [f.chave]: e.target.value }))} rows={f.lista ? 3 : 2} className={juntar(campoTexto, "min-h-[64px]")} aria-label={f.rotulo} placeholder={f.lista ? "Um por linha" : ""} />
                ) : (
                  <input value={valor} onChange={(e) => setValores((v) => ({ ...v, [f.chave]: e.target.value }))} className={campo} aria-label={f.rotulo} />
                )}
              </label>
            );
          })}
        </div>
      </Secao>

      {jornadaDoSite(site).objetivo === "loja_virtual" && <ProdutosDaLoja site={site} produtosDoCliente={c.produtos} />}

      {c.dossie && (
        <div className="min-w-0" data-dossie="">
          <TituloRecolhivel titulo="Dossiê" recolhido={dossieRecolhido} onAlternar={() => setDossieRecolhido(!dossieRecolhido)} resumo="leitura do dossiê atual da marca" />
          {!dossieRecolhido && <p className={juntar(texto.auxiliar, "mt-2 whitespace-pre-line")}>{c.dossie}</p>}
        </div>
      )}
    </div>
  );
}
