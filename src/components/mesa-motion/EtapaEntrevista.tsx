import { useEffect, useRef, useState } from "react";
import { ArrowRight, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import Secao from "@/components/sistema/Secao";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { alternarOpcao, entrevistaPadrao, INGREDIENTES, lerEntrevista, type RespostasDaEntrevista } from "../../../supabase/functions/_shared/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import { chamarMotion, type Filme, useGuardarFilme } from "./motionApi";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 2: entrevista com ingredientes nomeados em opções clicáveis (logo,
 * gancho, prova, frases, transição, ritmo, clima, fundo...). Um clique
 * grava; "Preencher tudo" sugere pelo contexto da marca com prévia e Desfazer;
 * "Usar o padrão" preenche só a forma do filme que está vazia (com Desfazer).
 * "Sem prova" vale sozinha: ligar tira as outras provas, e vice-versa.
 */

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const [obs, setObs] = useState(filme.entrevista.observacoes || "");
  // Resposta na tela na hora do clique; a gravação é uma por vez e sempre com a mais nova
  // (dois cliques rápidos não se apagam, e resposta velha não volta por cima da nova).
  const [e, setE] = useState<RespostasDaEntrevista>(filme.entrevista);
  const maisNova = useRef<RespostasDaEntrevista>(filme.entrevista);
  const emVoo = useRef(false);
  const pendente = useRef(false);
  useEffect(() => {
    if (emVoo.current || pendente.current) return;
    maisNova.current = filme.entrevista;
    setE(filme.entrevista);
  }, [filme.entrevista]);

  const gravar = async (): Promise<boolean> => {
    if (emVoo.current) {
      pendente.current = true;
      return true;
    }
    emVoo.current = true;
    const alvo = maisNova.current;
    let ok = true;
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, entrevista: alvo });
      if (!pendente.current) guardar(d.filme);
    } catch (err) {
      ok = false;
      avisarErro(err, "A resposta não foi salva");
      if (!pendente.current && maisNova.current === alvo) {
        // Não salvou: a tela volta ao que está gravado.
        maisNova.current = filme.entrevista;
        setE(filme.entrevista);
      }
    }
    emVoo.current = false;
    if (pendente.current) {
      pendente.current = false;
      return gravar();
    }
    return ok;
  };

  const salvar = (nova: RespostasDaEntrevista): Promise<boolean> => {
    maisNova.current = nova;
    setE(nova);
    return gravar();
  };

  const escolher = (chave: string, valor: string, multiplo: boolean) => {
    const e = maisNova.current;
    const atual = e[chave];
    let novo: string | string[];
    if (multiplo) {
      const ing = INGREDIENTES.find((i) => i.chave === chave)!;
      novo = alternarOpcao(ing, Array.isArray(atual) ? atual.slice() : [], valor);
    } else novo = atual === valor ? "" : valor;
    void salvar(lerEntrevista({ ...e, [chave]: novo }));
  };

  // "Usar o padrão": só os ingredientes da forma que estão vazios (duração igual ao alvo do tipo, fundo escuro como o kit).
  const padrao = entrevistaPadrao(filme.tipo);
  const vazios = Object.keys(padrao).filter((k) => !e[k]);
  const usarPadrao = async () => {
    const antes = maisNova.current;
    const faltam = Object.keys(padrao).filter((k) => !antes[k]);
    if (!faltam.length) return;
    const novo: Record<string, unknown> = { ...antes };
    faltam.forEach((k) => (novo[k] = padrao[k]));
    if (await salvar(lerEntrevista(novo)))
      toast.success(`Padrão em ${faltam.length} ${faltam.length === 1 ? "ingrediente" : "ingredientes"}`, { duration: 9000, action: { label: "Desfazer", onClick: () => void salvar(lerEntrevista(antes)) } });
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
          <>
            <button type="button" className={botao.secundario} onClick={() => void usarPadrao()} disabled={!vazios.length} title={vazios.length ? "Duração, logo, gancho, transição, ritmo e fundo" : "A forma do filme já está escolhida"} data-usar-padrao="">
              <Wand2 className="mr-1 h-3.5 w-3.5" />
              Usar o padrão
            </button>
            <PreencherComIA
              papel="motion"
              clientId={clientId}
              marcaId={marca ? marca.id : null}
              campos={campos}
              contexto={`Filme "${filme.nome}" (${filme.tipo === "filme_marca" ? "filme cinematográfico da marca" : "apresentação em motion"}).`}
              onAplicar={(v) => {
                if (typeof v.observacoes === "string") setObs(v.observacoes);
                return salvar(lerEntrevista({ ...maisNova.current, ...v })).then(() => undefined);
              }}
              onDesfazer={(a) => {
                if (typeof a.observacoes === "string") setObs(a.observacoes);
                return salvar(lerEntrevista({ ...maisNova.current, ...a })).then(() => undefined);
              }}
            />
          </>
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
            <textarea className={campoTexto} value={obs} maxLength={1500} onChange={(x) => setObs(x.target.value)} onBlur={() => obs !== (maisNova.current.observacoes || "") && void salvar(lerEntrevista({ ...maisNova.current, observacoes: obs }))} placeholder="O que mais o filme precisa ter" />
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
  return <ComFilme irPara={irPara}>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
