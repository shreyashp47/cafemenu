"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { tablesWithoutKey, type TableKeys } from "@/lib/table-keys";
import { formatTableList } from "@/lib/tables";

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
        <h2 className="text-lg">Table codes</h2>
        <p className="text-muted mt-0.5 text-sm">Checking your tables…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 print:hidden">
        <h2 className="text-lg">Table codes</h2>
        <p
          role="alert"
          className="text-berry-deep mt-0.5 text-sm font-semibold"
        >
          Couldn&apos;t load your table codes. Check your connection and reload
          this page.
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
      <h2 className="text-lg">Table codes</h2>
      {missing.length === 0 ? (
        <p
          role="status"
          className="text-sage-deep mt-0.5 text-sm font-semibold"
        >
          ✓ Every table has a code. Only someone who scanned the card on a table
          can order for it.
        </p>
      ) : (
        <>
          <p className="text-body mt-0.5 text-sm">
            {none
              ? "Right now anyone who knows your web address can order for any table without being in the cafe."
              : `Table${missing.length === 1 ? "" : "s"} ${formatTableList(missing)} ${missing.length === 1 ? "has" : "have"} no code yet, so anyone who knows the address can order for ${missing.length === 1 ? "it" : "them"} from anywhere.`}
          </p>
          <p className="text-muted mt-1.5 text-sm">
            A code is a secret part of the table&apos;s QR code. Orders without
            it are turned away. After creating codes,{" "}
            <strong className="text-ink">
              print the cards below and replace the old ones
            </strong>{" "}
            — the old cards stop working.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => void create()} disabled={state === "busy"}>
              {state === "busy"
                ? "Creating…"
                : none
                  ? "Create codes for all tables"
                  : `Create codes for ${missing.length} table${missing.length === 1 ? "" : "s"}`}
            </Button>
            {state === "error" ? (
              <p role="alert" className="text-berry-deep text-sm font-semibold">
                That didn&apos;t save. Check your connection and try again.
              </p>
            ) : null}
          </div>
        </>
      )}
      {state === "done" && missing.length === 0 ? (
        <p className="text-muted mt-1.5 text-sm">
          Now print the cards below and put them out.
        </p>
      ) : null}
    </Card>
  );
}
