"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { tablesWithoutKey, type TableKeys } from "@/lib/table-keys";
import { formatTableList } from "@/lib/tables";
import { t } from "@/lib/i18n";
import { rich } from "@/lib/i18n-rich";

/**
 * The "Table codes" panel on /admin/qr: whether the tables are protected, and
 * the one button that protects them. Written for an owner who has never heard of a "key": what is open, what the
 * button does, and the step that is easy to forget — putting the new cards out.
 */
export function TableCodes({
  tables,
  keys,
  loading,
  error,
  onCreate,
}: {
  tables: number[];
  keys: TableKeys;
  loading: boolean;
  error: Error | null;
  onCreate: (tables: number[]) => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
    "idle",
  );
  const missing = tablesWithoutKey(tables, keys);
  const none = missing.length === tables.length;

  async function create() {
    setState("busy");
    try {
      await onCreate(missing);
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (loading) {
    return (
      <Card className="p-4 print:hidden">
        <h2 className="text-lg">{t("tableCodes.tableCodes")}</h2>
        <p className="text-muted mt-0.5 text-sm">
          {t("tableCodes.checkingTables")}
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 print:hidden">
        <h2 className="text-lg">{t("tableCodes.tableCodes")}</h2>
        <p
          role="alert"
          className="text-berry-deep mt-0.5 text-sm font-semibold"
        >
          {t("tableCodes.couldntLoadTable")}
        </p>
      </Card>
    );
  }

  return (
    <Card
      className={[
        "p-4 print:hidden",
        missing.length > 0 ? "border-secondary" : "",
      ].join(" ")}
    >
      <h2 className="text-lg">{t("tableCodes.tableCodes")}</h2>
      {missing.length === 0 ? (
        <p
          role="status"
          className="text-sage-deep mt-0.5 text-sm font-semibold"
        >
          {t("tableCodes.everyTableHas")}
        </p>
      ) : (
        <>
          <p className="text-body mt-0.5 text-sm">
            {none
              ? t("tableCodes.noneHave")
              : t("tableCodes.someMissing", {
                  count: missing.length,
                  list: formatTableList(missing),
                })}
          </p>
          <p className="text-muted mt-1.5 text-sm">
            {rich("tableCodes.explain", {
              b: (c) => <strong className="text-ink">{c}</strong>,
            })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => void create()} disabled={state === "busy"}>
              {state === "busy"
                ? t("tableCodes.creating")
                : none
                  ? t("tableCodes.createAll")
                  : t("tableCodes.createSome", { count: missing.length })}
            </Button>
            {state === "error" ? (
              <p role="alert" className="text-berry-deep text-sm font-semibold">
                {t("tableCodes.didntSaveCheck")}
              </p>
            ) : null}
          </div>
        </>
      )}
      {state === "done" && missing.length === 0 ? (
        <p className="text-muted mt-1.5 text-sm">
          {t("tableCodes.nowPrintCards")}
        </p>
      ) : null}
    </Card>
  );
}
