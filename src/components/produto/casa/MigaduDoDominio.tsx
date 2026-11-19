import { useState } from "react";
import { toast } from "sonner";
import { Copy, Hammer, Power, RefreshCw } from "lucide-react";
import { fraseDoErro } from "@/lib/produto/api";
import { ativarMigadu, conferirMigadu, lerConferenciaDoMigadu, montarMigadu, registrosDoMigaduParaColar, type DominioComIntegracao } from "@/lib/produto/email-pedidos";
import { Chip, HelpTooltip, OverflowMenu, type Tone } from "@/components/ds";
import { EstadoVazio, botao, juntar, texto } from "@/components/sistema";
import { TituloDoBloco } from "./pecasDaCasa";

/**
 * O domínio no Migadu (o correio da Aceleriq): montar (domínio, caixas por convite e apelidos),
 * conferir e ativar. A chave da API fica nos segredos da função; sem ela, os botões avisam o que falta.
 * 19/11/2026 (redesenho): o estado em pílula, UM botão com o próximo passo e o resto no "...".
 */
export default function MigaduDoDominio({ dominio, aoMudar }: { dominio: DominioComIntegracao; aoMudar: () => Promise<unknown> | void }) {
  const [ocupado, setOcupado] = useState<"" | "montar" | "conferir" | "ativar">("");
  const m = lerConferenciaDoMigadu(dominio.integracao);

  const rodar = async (qual: "montar" | "conferir" | "ativar") => {
    setOcupado(qual);
    try {
      if (qual === "montar") {
        const r = await montarMigadu(dominio.id);
        const partes = [r.dominio_criado ? "domínio criado" : "", r.criadas.length ? `${r.criadas.length} criado(s) por convite` : "", r.pendentes.length ? `${r.pendentes.length} pendente(s)` : ""].filter(Boolean);
        toast[r.pendentes.length ? "warning" : "success"](`Migadu: ${partes.join(", ") || "nada novo"}.`);
      } else if (qual === "ativar") {
        const r = await ativarMigadu(dominio.id);
        toast[r.ativo ? "success" : "warning"](r.ativo ? "Domínio ativo no Migadu." : r.motivo || "O DNS ainda não está certo.");
      } else {
        const r = await conferirMigadu(dominio.id);
        toast[r.ok ? "success" : "warning"](r.existe ? (r.ok ? "Ativo no Migadu." : "No Migadu, falta ativar.") : "Ainda não existe no Migadu.");
      }
      await aoMudar();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível falar com o Migadu agora."));
    } finally {
      setOcupado("");
    }
  };

  const copiar = () => {
    if (!m || !m.registros.length) return;
    void navigator.clipboard.writeText(registrosDoMigaduParaColar(m.registros)).then(() => toast.success("Registros copiados."));
  };

  const estado: { tom: Tone; rotulo: string } = !m ? { tom: "neutral", rotulo: "Não montado" } : !m.existe ? { tom: "warning", rotulo: "Não existe no Migadu" } : m.ok ? { tom: "success", rotulo: "Ativo" } : { tom: "warning", rotulo: "Falta ativar" };
  // O próximo passo vira o botão à vista; os outros dois vão para o "...".
  const proximo: "montar" | "ativar" | "conferir" = !m || !m.existe ? "montar" : !m.ok ? "ativar" : "conferir";
  const ICONE = { montar: Hammer, ativar: Power, conferir: RefreshCw } as const;
  const ROTULO = { montar: "Montar", ativar: "Ativar", conferir: "Conferir" } as const;
  const Icone = ICONE[proximo];

  return (
    <section className="min-w-0" data-migadu-do-dominio="">
      <TituloDoBloco
        aoLado={
          <>
            <Chip tone={estado.tom} dot>{estado.rotulo}</Chip>
            <HelpTooltip label="Sobre o Migadu">Montar cria o domínio no Migadu, as caixas por convite (cada pessoa recebe o link para criar a própria senha no e-mail de hoje) e os apelidos. Depois publique os registros na Cloudflare e clique em Ativar.</HelpTooltip>
            <button type="button" className={juntar(proximo === "conferir" ? botao.secundario : botao.primario, "h-8")} onClick={() => void rodar(proximo)} disabled={!!ocupado} data-montar-migadu={proximo === "montar" ? "" : undefined} data-ativar-migadu={proximo === "ativar" ? "" : undefined} data-conferir-migadu={proximo === "conferir" ? "" : undefined}>
              <Icone className={juntar("mr-1.5 h-4 w-4", ocupado === proximo && proximo === "conferir" && "animate-spin")} aria-hidden="true" />
              {ocupado === proximo ? `${ROTULO[proximo]}...` : ROTULO[proximo]}
            </button>
            <OverflowMenu
              label="Mais ações do Migadu"
              disabled={!!ocupado}
              items={[
                proximo !== "montar" && { label: "Montar de novo", icon: <Hammer className="h-4 w-4" />, onSelect: () => void rodar("montar") },
                proximo !== "conferir" && { label: "Conferir", icon: <RefreshCw className="h-4 w-4" />, onSelect: () => void rodar("conferir") },
                proximo !== "ativar" && { label: "Ativar", icon: <Power className="h-4 w-4" />, onSelect: () => void rodar("ativar"), disabled: !m || !m.existe },
              ]}
            />
          </>
        }
      >
        Migadu
      </TituloDoBloco>

      {!m && <EstadoVazio compacto titulo="Ainda não montado." descricao="Cadastre as caixas (com o e-mail de hoje de cada pessoa) e clique em Montar." />}

      {m && m.registros.length > 0 && (
        <div className="min-w-0" data-registros-do-migadu="">
          <div className="mb-1 flex items-center">
            <span className={juntar(texto.rotulo, "flex-1")}>Registros para a Cloudflare</span>
            <button type="button" className={botao.icone} onClick={copiar} aria-label="Copiar os registros" title="Copiar os registros">
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <ul className="min-w-0 divide-y divide-border/50">
            {m.registros.map((r) => (
              <li key={`${r.tipo}-${r.nome}-${r.valor}`} className="flex min-w-0 items-start py-2">
                <Chip tone="neutral" className="mr-2 mt-0.5 w-14 justify-center">{r.tipo}</Chip>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>{r.nome}</span>
                  <span className={juntar(texto.auxiliar, "block break-all")}>{r.tipo === "MX" ? `${r.prioridade ?? 10} ` : ""}{r.valor}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {m && m.pendentes && m.pendentes.length > 0 && (
        <ul className="mt-3 min-w-0 space-y-1" data-pendentes-do-migadu="">
          {m.pendentes.map((p) => (
            <li key={p.endereco} className={juntar(texto.auxiliar, "text-destructive")}>
              {p.endereco}: {p.motivo}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
