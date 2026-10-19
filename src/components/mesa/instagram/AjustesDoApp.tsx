import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import {
  ajustesParaOTipo,
  GRUPOS_DOS_AJUSTES,
  progressoDosAjustes,
  TIPOS_DE_NEGOCIO,
  ehTipo,
  type AjusteAdaptado,
  type EstadoDosAjustes,
  type GrupoDoAjuste,
  type TipoOuNaoSei,
} from "../../../../supabase/functions/mesa-instagram/modulos/ajustes-do-app";
import { chamarInstagram } from "./instagramApi";

/**
 * Ajustes do app (20/10/2026, "perfil perfeito" da aba Redes). O checklist do que ligar e desligar
 * no Instagram (Editar perfil, Configurações, ao postar foto e Reels), adaptado ao tipo de negócio
 * do cliente. A API não lê esses ajustes: a equipe confere no app e marca aqui. O tipo vem do Jev
 * na primeira vez (com "não sei") e a equipe troca no topo. Catálogo e regras em
 * supabase/functions/mesa-instagram/modulos/ajustes-do-app.ts.
 */

type RespostaDosAjustes = { estado: EstadoDosAjustes; aviso?: string | null; custo_usd?: number };

function Grupo({
  grupo,
  rotulo,
  clientId,
  itens,
  feitos,
  total,
  marcados,
  onMarcar,
}: {
  grupo: GrupoDoAjuste;
  rotulo: string;
  clientId: string;
  itens: AjusteAdaptado[];
  feitos: number;
  total: number;
  marcados: Record<string, boolean>;
  onMarcar: (chave: string, feito: boolean) => void;
}) {
  const [recolhido, setRecolhido] = useRecolhido(`mesa:instagram:ajustes:${grupo}:${clientId}`, false);
  const resumo = `${feitos} de ${total}`;
  return (
    <section className="min-w-0 border-t border-border pt-2" data-grupo-de-ajustes={grupo} aria-label={rotulo}>
      <div className="flex min-w-0 items-center justify-between">
        <TituloRecolhivel titulo={rotulo} recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={resumo} className="mr-2" />
        {!recolhido && <span className={juntar(texto.auxiliar, "shrink-0 tabular-nums")}>{resumo}</span>}
      </div>
      {!recolhido && (
        <ul className={juntar(lista.aberta, "mt-1")}>
          {itens.map((a) => {
            const feito = !!marcados[a.chave];
            const id = `ajuste-${a.chave}`;
            return (
              <li key={a.chave} className={juntar(lista.linha, "items-start py-2", a.aplica ? "" : "opacity-60")} data-ajuste={a.chave} data-feito={feito ? "sim" : "nao"}>
                <Checkbox id={id} checked={feito} onCheckedChange={(v) => onMarcar(a.chave, v === true)} className="mr-2.5 mt-0.5" aria-label={`${a.titulo}: feito`} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center">
                    <label htmlFor={id} className={juntar("min-w-0 truncate text-[13px] font-medium leading-5 text-foreground", feito ? "text-muted-foreground line-through" : "")}>
                      {a.titulo}
                    </label>
                    {a.mudou && <span className={juntar(etiqueta, "ml-1.5 bg-primary/10 text-primary")}>adaptado</span>}
                    {a.depende_do_tipo && <span className={juntar(etiqueta, "ml-1.5 bg-warning/15 text-warning")}>depende do tipo</span>}
                    {!a.aplica && <span className={juntar(etiqueta, "ml-1.5 bg-muted text-muted-foreground")}>não se aplica</span>}
                    <AjudaRecolhida className="ml-1 shrink-0" rotulo={`Por que: ${a.titulo}`} titulo={a.titulo}>
                      {a.porque}
                      {a.original ? ` O checklist original (de criador) diz: ${a.original}` : ""}
                      {a.depende_do_tipo ? " Este item muda conforme o tipo de negócio: escolha o tipo no topo." : ""}
                    </AjudaRecolhida>
                  </div>
                  <p className="text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{a.fazer}</p>
                  <p className="mt-0.5 flex min-w-0 items-start text-[12px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                    <Smartphone className="mr-1 mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{a.caminho}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function AjustesDoApp({
  clientId,
  contaId,
  estado,
  onMudar,
}: {
  clientId: string;
  contaId: string | null;
  estado: EstadoDosAjustes;
  /** Troca o estado guardado no painel da aba (sem reler tudo). */
  onMudar: (fn: (e: EstadoDosAjustes) => EstadoDosAjustes) => void;
}) {
  const tipo: TipoOuNaoSei = estado.tipo_de_negocio ? estado.tipo_de_negocio.tipo : "nao_sei";
  const adaptados = ajustesParaOTipo(tipo);
  const marcados: Record<string, boolean> = {};
  for (const k of Object.keys(estado.itens)) marcados[k] = estado.itens[k].feito;
  const progresso = progressoDosAjustes(adaptados, estado.itens);
  const [lendoTipo, setLendoTipo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const pediuJev = useRef<string | null>(null);
  const extra = contaId ? { conta_id: contaId } : {};

  // Sem tipo guardado: o Jev escolhe uma vez por conta (com "não sei"); a equipe troca no topo.
  useEffect(() => {
    const chave = `${clientId}:${contaId || "principal"}`;
    if (estado.tipo_de_negocio || pediuJev.current === chave) return;
    pediuJev.current = chave;
    let vivo = true;
    setLendoTipo(true);
    chamarInstagram<RespostaDosAjustes>("ajustes_do_app", clientId, extra)
      .then((r) => {
        if (!vivo || !r || !r.estado) return;
        setAviso(r.aviso || null);
        onMudar((e) => ({ ...e, tipo_de_negocio: e.tipo_de_negocio || r.estado.tipo_de_negocio }));
      })
      .catch((e) => vivo && setAviso(textoDoErro(e)))
      .finally(() => vivo && setLendoTipo(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, contaId, estado.tipo_de_negocio]);

  const marcar = (chave: string, feito: boolean) => {
    const antes = estado.itens[chave] || null;
    onMudar((e) => ({ ...e, itens: { ...e.itens, [chave]: { feito, quando: new Date().toISOString(), por: null } } }));
    chamarInstagram<RespostaDosAjustes>("marcar_ajuste", clientId, { ...extra, chave, feito })
      .then((r) => {
        // Só o item deste clique: outro clique em andamento não volta atrás.
        const doServidor = r && r.estado && r.estado.itens[chave];
        if (doServidor) onMudar((e) => ({ ...e, itens: { ...e.itens, [chave]: doServidor } }));
      })
      .catch((e) => {
        onMudar((x) => {
          const itens = { ...x.itens };
          if (antes) itens[chave] = antes;
          else delete itens[chave];
          return { ...x, itens };
        });
        toast.error("Não deu para guardar o ajuste", { description: textoDoErro(e) });
      });
  };

  const trocarTipo = (v: string) => {
    if (!ehTipo(v) || v === tipo) return;
    const antes = estado.tipo_de_negocio;
    onMudar((e) => ({ ...e, tipo_de_negocio: { tipo: v, origem: "equipe", confianca: null, probabilidades: {}, quando: new Date().toISOString(), por: null } }));
    chamarInstagram<RespostaDosAjustes>("tipo_de_negocio", clientId, { ...extra, tipo: v })
      .then((r) => {
        setAviso(null);
        if (r && r.estado && r.estado.tipo_de_negocio) onMudar((e) => ({ ...e, tipo_de_negocio: r.estado.tipo_de_negocio }));
      })
      .catch((e) => {
        onMudar((x) => ({ ...x, tipo_de_negocio: antes }));
        toast.error("Não deu para trocar o tipo de negócio", { description: textoDoErro(e) });
      });
  };

  const origem = estado.tipo_de_negocio ? (estado.tipo_de_negocio.origem === "jev" ? "escolhido pelo Jev" : "escolhido pela equipe") : lendoTipo ? "o Jev está lendo o cliente" : "";
  const pct = progresso.total ? Math.round((progresso.feitos / progresso.total) * 100) : 0;

  return (
    <div className="min-w-0 space-y-3" data-ajustes-do-app="">
      <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1.5 [&>*]:mr-2">
        <SeletorCompacto
          rotulo="Tipo de negócio"
          valor={tipo}
          onEscolher={trocarTipo}
          modo="lista"
          opcoes={TIPOS_DE_NEGOCIO.map((t) => ({ valor: t.valor, rotulo: t.rotulo, descricao: t.dica }))}
        />
        {origem && <span className={juntar(texto.auxiliar, "min-w-0 truncate")} aria-live="polite">{origem}</span>}
        <AjudaRecolhida rotulo="Como funcionam os ajustes do app">
          O checklist do perfil perfeito: o que ligar e desligar no app do Instagram. A API não lê esses ajustes, então a equipe confere no celular e marca aqui. O original é de criador de conteúdo; para negócio local, loja e profissional liberal os itens que atrapalhariam a venda (como tirar o WhatsApp) mudam e dizem por quê.
        </AjudaRecolhida>
      </div>

      <div className="min-w-0" data-progresso-dos-ajustes="">
        <div className="flex min-w-0 items-center justify-between">
          <span className="text-[13px] font-semibold tabular-nums text-foreground">
            {progresso.feitos} de {progresso.total} feitos
          </span>
          <span className={juntar(texto.auxiliar, "tabular-nums")}>{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 min-w-0 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Ajustes feitos" aria-valuemin={0} aria-valuemax={progresso.total} aria-valuenow={progresso.feitos}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {aviso && <p className="text-[12px] leading-4 text-warning">{aviso}</p>}

      <div className="min-w-0 space-y-2">
        {GRUPOS_DOS_AJUSTES.map((g) => (
          <Grupo
            key={g.grupo}
            grupo={g.grupo}
            rotulo={g.rotulo}
            clientId={clientId}
            itens={adaptados.filter((a) => a.grupo === g.grupo)}
            feitos={progresso.por_grupo[g.grupo].feitos}
            total={progresso.por_grupo[g.grupo].total}
            marcados={marcados}
            onMarcar={marcar}
          />
        ))}
      </div>
    </div>
  );
}
