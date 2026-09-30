import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import Secao from "@/components/sistema/Secao";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { INGREDIENTES, lerEntrevista, type RespostasDaEntrevista } from "../../../supabase/functions/_shared/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import { chamarMotion, type Filme, useGuardarFilme } from "./motionApi";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 2: entrevista com ingredientes nomeados em opções clicáveis (logo,
 * gancho, prova, frases, transição, ritmo, clima, fundo...). Um clique
 * grava; "Preencher tudo" sugere pelo contexto da marca com prévia e Desfazer.
 */

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const [obs, setObs] = useState(filme.entrevista.observacoes || "");
  const e = filme.entrevista;

  const salvar = async (nova: RespostasDaEntrevista) => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, entrevista: nova });
      guardar(d.filme);
    } catch (err) {
      avisarErro(err, "A resposta não foi salva");
    }
  };

  const escolher = (chave: string, valor: string, multiplo: boolean) => {
    const atual = e[chave];
    let novo: string | string[];
    if (multiplo) {
      const l = Array.isArray(atual) ? atual.slice() : [];
      novo = l.indexOf(valor) >= 0 ? l.filter((x) => x !== valor) : l.concat([valor]);
    } else novo = atual === valor ? "" : valor;
    void salvar(lerEntrevista({ ...e, [chave]: novo }));
  };

  const campos: CampoParaPreencher[] = [
    ...INGREDIENTES.filter((i) => !i.multiplo).map((i): CampoParaPreencher => ({ chave: i.chave, rotulo: i.rotulo, tipo: "escolha", opcoes: i.opcoes.map((o) => o.valor), valorAtual: e[i.chave] || "" })),
    { chave: "observacoes", rotulo: "Observações", tipo: "texto_longo", valorAtual: obs, maximo: 1500 },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Ingredientes do filme"
        descricao={`${Object.keys(e).filter((k) => k !== "observacoes").length} de ${INGREDIENTES.length} escolhidos`}
        ajuda="Cada ingrediente tem opções nomeadas. O que você escolher aqui manda no BRAND.md e nos storyboards."
        acao={
          <PreencherComIA
            papel="motion"
            clientId={clientId}
            marcaId={marca ? marca.id : null}
            campos={campos}
            contexto={`Filme "${filme.nome}" (${filme.tipo === "filme_marca" ? "filme cinematográfico da marca" : "apresentação em motion"}).`}
            onAplicar={(v) => {
              if (typeof v.observacoes === "string") setObs(v.observacoes);
              return salvar(lerEntrevista({ ...e, ...v }));
            }}
            onDesfazer={(a) => {
              if (typeof a.observacoes === "string") setObs(a.observacoes);
              return salvar(lerEntrevista({ ...e, ...a }));
            }}
          />
        }
      >
        <div className="min-w-0 space-y-4">
          {INGREDIENTES.map((ing) => (
            <div key={ing.chave} className="min-w-0" role="group" aria-label={ing.rotulo}>
              <span className={juntar(texto.rotulo, "mb-1.5 block")}>
                {ing.rotulo}
                {ing.multiplo ? " (um ou mais)" : ""}
              </span>
              <div className="flex min-w-0 flex-wrap">
                {ing.opcoes.map((o) => {
                  const v = e[ing.chave];
                  const ligado = Array.isArray(v) ? v.indexOf(o.valor) >= 0 : v === o.valor;
                  return (
                    <button key={o.valor} type="button" aria-pressed={ligado} title={o.dica} className={juntar(ligado ? botao.primario : botao.secundario, "mb-2 mr-2 h-8")} onClick={() => escolher(ing.chave, o.valor, !!ing.multiplo)}>
                      {o.rotulo}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <label className="block min-w-0">
            <span className={texto.rotulo}>Observações</span>
            <textarea className={campoTexto} value={obs} maxLength={1500} onChange={(x) => setObs(x.target.value)} onBlur={() => void salvar(lerEntrevista({ ...e, observacoes: obs }))} placeholder="O que mais o filme precisa ter" />
          </label>
        </div>
      </Secao>
      <button type="button" className={botao.primario} onClick={() => void chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, etapa: "brand" }).then((d) => (guardar(d.filme), irPara("brand"))).catch((x) => avisarErro(x, "Não foi salvo"))}>
        Seguir para o BRAND.md
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EtapaEntrevista({ irPara }: { irPara: IrPara }) {
  return <ComFilme>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
