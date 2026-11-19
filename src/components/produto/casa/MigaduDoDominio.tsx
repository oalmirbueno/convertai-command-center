import { useState } from "react";
import { toast } from "sonner";
import { Copy, Hammer, Power, RefreshCw } from "lucide-react";
import { fraseDoErro } from "@/lib/produto/api";
import { ativarMigadu, conferirMigadu, lerConferenciaDoMigadu, montarMigadu, registrosDoMigaduParaColar, type DominioComIntegracao } from "@/lib/produto/email-pedidos";
import { Secao, botao, etiqueta, juntar, lista, texto } from "@/components/sistema";

/**
 * O domínio no Migadu (o correio da Aceleriq): montar (domínio, caixas por convite e apelidos),
 * conferir e ativar. A chave da API fica nos segredos da função; sem ela, os botões avisam o que falta.
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

  return (
    <Secao
      titulo="Migadu"
      descricao={!m ? "Ainda não montado" : !m.existe ? "Não existe no Migadu" : m.ok ? "Ativo" : "Falta ativar"}
      ajuda="Montar cria o domínio no Migadu, as caixas por convite (cada pessoa recebe o link para criar a própria senha no e-mail de hoje) e os apelidos. Depois publique os registros na Cloudflare e clique em Ativar."
      acao={
        <span className="flex flex-wrap items-center gap-1">
          <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void rodar("montar")} disabled={!!ocupado} data-montar-migadu="">
            <Hammer className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {ocupado === "montar" ? "Montando..." : "Montar"}
          </button>
          <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void rodar("conferir")} disabled={!!ocupado} data-conferir-migadu="">
            <RefreshCw className={juntar("mr-1.5 h-4 w-4", ocupado === "conferir" && "animate-spin")} aria-hidden="true" />
            Conferir
          </button>
          <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void rodar("ativar")} disabled={!!ocupado || !m || !m.existe} data-ativar-migadu="">
            <Power className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Ativar
          </button>
        </span>
      }
    >
      {m && m.registros.length > 0 && (
        <div className="min-w-0 space-y-2" data-registros-do-migadu="">
          <div className="flex items-center">
            <span className={juntar(texto.corpo, "flex-1 font-medium")}>Registros para a Cloudflare</span>
            <button type="button" className={botao.icone} onClick={copiar} aria-label="Copiar os registros" title="Copiar os registros">
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {m.registros.map((r) => (
              <li key={`${r.tipo}-${r.nome}-${r.valor}`} className={juntar(lista.linha, "items-start")}>
                <span className={juntar(etiqueta, "mr-2 shrink-0 bg-muted text-muted-foreground")}>{r.tipo}</span>
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
      {!m && <p className={texto.auxiliar}>Cadastre as caixas acima (com o e-mail de hoje de cada pessoa, para o convite) e clique em Montar.</p>}
    </Secao>
  );
}
