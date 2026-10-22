"use client";

/**
 * Printable per-table QR cards (docs/requirements.md §5.5).
 *
 * "One static QR code per table, encoding table number in the URL. Generated
 * once, printed, placed on table — no dynamic regeneration needed." So the
 * cards are a print sheet, not a live view: encode once, print, laminate.
 *
 * It is also where the owner sets how many tables the cafe has. That list is
 * saved to config/tables and is what /order checks a scanned table number
 * against, so the cards printed here and the tables a customer can order from
 * are always the same list.
 *
 * And it is where each table gets its secret code (src/lib/table-keys.ts),
 * which the QR code carries and the order rules check. A table with no code
 * takes orders from anyone who types its address; the owner turns that off by
 * creating codes and putting the new cards out. "Regenerated once, when a card
 * leaks" is the one exception to the spec's "no dynamic regeneration".
 *
 * And the switch for staff confirming new guests (src/lib/table-open.ts):
 * the other half of keeping out orders from people not in the cafe.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useConfigRepo,
  useTableKeys,
  useTables,
} from "@/components/providers/DataProvider";
import { CafeMark } from "@/components/CafeMark";
import { TableCodes } from "@/components/TableCodes";
import { TableListEditor } from "@/components/TableListEditor";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { useCafeSettings } from "@/hooks/useCafeSettings";
import { qrToSvg } from "@/lib/qr";
import { generateTableKey, tablesWithoutKey } from "@/lib/table-keys";
import { orderHref } from "@/lib/tables";
import { t } from "@/lib/i18n";

export default function QrPage() {
  const { settings } = useCafeSettings();
  // The cafe's own address from its settings, else whatever address this
  // page is open on, until the owner types another.
  const pinned = settings.baseUrl ?? "";
  const [here, setHere] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  const origin = typed ?? (pinned || here);
  const repo = useConfigRepo();
  // Cards follow the *saved* list, not the editor's draft: a card printed for
  // a table that was never saved would send customers to "that table number
  // looks odd".
  const { tables, saved, loading } = useTables();
  const { keys, loading: keysLoading, error: keysError } = useTableKeys();
  const codesInUse = Object.keys(keys).length > 0;

  const createKeys = useCallback(
    async (forTables: number[]) => {
      if (!repo) throw new Error(t("common.storageNotReady"));
      if (forTables.length === 0) return;
      const fresh: Record<number, string> = {};
      for (const n of forTables) fresh[n] = generateTableKey();
      await repo.saveTableKeys(fresh);
    },
    [repo],
  );

  const saveTables = useCallback(
    async (next: number[]) => {
      if (!repo) throw new Error(t("common.storageNotReady"));
      await repo.saveTables(next);
      // A table added to a cafe that already uses codes gets one straight away,
      // so it is never the one open door. Not before the owner has opted in:
      // giving a table a code stops its current keyless card from working, and
      // that has to be the owner's decision, made with new cards in hand.
      if (codesInUse) await createKeys(tablesWithoutKey(next, keys));
    },
    [repo, codesInUse, createKeys, keys],
  );

  useEffect(() => {
    // Without an address in the settings, bake in whatever host this page is
    // served from, so the printed card works before a domain cutover.
    setHere(window.location.origin);
  }, []);

  const base = origin.replace(/\/+$/, "");
  const valid =
    /^https?:\/\//i.test(base) && !loading && !keysLoading && tables.length > 0;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Card className="p-4 print:hidden">
        <h2 className="text-lg">{t("qr.tables")}</h2>
        <p className="text-muted mt-0.5 mb-3 text-sm">{t("qr.qrCodeAny")}</p>
        <TableListEditor
          tables={tables}
          saved={saved}
          loading={loading}
          onSave={saveTables}
        />
      </Card>

      <TableCodes
        tables={tables}
        keys={keys}
        loading={loading || keysLoading}
        error={keysError}
        onCreate={createKeys}
      />

      <Card className="p-4 print:hidden">
        <h2 className="text-lg">{t("qr.tableQrCodes")}</h2>
        <p className="text-muted mt-0.5 text-sm">{t("qr.printPageCut")}</p>

        <div className="mt-3 grid gap-3">
          <Field
            label={t("qr.addressPrint")}
            htmlFor="base-url"
            hint={t("qr.liveSiteAddress")}
          >
            <Input
              id="base-url"
              value={origin}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t("qr.httpsYourcafeWeb")}
              inputMode="url"
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => window.print()} disabled={!valid}>
            {t("qr.printCards", { count: tables.length })}
          </Button>
          {loading ? null : !valid ? (
            <p role="alert" className="text-berry-deep text-sm font-semibold">
              {t("qr.enterFullAddress")}
            </p>
          ) : (
            <p className="text-muted text-sm">
              {t("qr.tablesReady", { count: tables.length })}
            </p>
          )}
        </div>
      </Card>

      {valid ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2">
          {tables.map((table) => (
            <TableCard
              key={table}
              table={table}
              url={`${base}${orderHref(table, keys[table])}`}
              hasCode={Boolean(keys[table])}
              onRenew={() => createKeys([table])}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TableCard({
  table,
  url,
  hasCode,
  onRenew,
}: {
  table: number;
  url: string;
  hasCode: boolean;
  onRenew: () => Promise<void>;
}) {
  const { settings } = useCafeSettings();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
    "idle",
  );

  async function renew() {
    setState("busy");
    try {
      await onRenew();
      setConfirming(false);
      setState("done");
    } catch {
      setState("error");
    }
  }

  // Rendering the SVG needs a browser-free-safe encode; `qrToSvg` is pure.
  const svg = useMemo(() => {
    try {
      return qrToSvg(url);
    } catch {
      return null;
    }
  }, [url]);

  return (
    <li className="print:break-inside-avoid">
      <Card className="flex flex-col items-center gap-3 p-5 text-center">
        {/* The logo sits above the code, never on it: the QR keeps its whole
            quiet zone and error budget, so the card scans as it always did. */}
        <CafeMark size={56} mascot={false} />
        <p className="font-hand text-primary text-3xl leading-none">
          {settings.name}
        </p>
        <p className="text-2xs text-muted font-semibold tracking-[0.18em] uppercase">
          {settings.tagline}
        </p>

        <div className="border-line-soft rounded-md border-2 bg-white p-3">
          {svg ? (
            <span
              className="block size-[9.5rem] sm:size-[11rem]"
              // Generated locally from the table URL by src/lib/qr.ts — no
              // third-party QR image service, so it also works offline.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="text-berry-deep text-sm">{t("qr.couldNotBuild")}</p>
          )}
        </div>

        <div>
          <p className="font-round text-ink text-2xl">
            {t("qr.tableNumber", { table })}
          </p>
          <p className="text-muted mt-1 text-sm">{t("qr.scanOpenMenu")}</p>
        </div>

        <p className="tnum text-2xs text-muted break-all">{url}</p>

        <p className="rounded-pill bg-highlight-soft font-hand text-primary-dark px-3 py-1 text-xl">
          {t("qr.noAppNeeded")}
        </p>

        <div className="border-line-soft flex w-full flex-col items-center gap-2 border-t-2 pt-3 print:hidden">
          {!hasCode ? (
            <p className="rounded-pill border-secondary text-secondary-deep border-2 px-3 py-0.5 text-sm font-semibold">
              {t("qr.noCodeYet")}
            </p>
          ) : confirming ? (
            <div
              role="group"
              aria-label={t("qr.newCodeFor", { table })}
              className="border-berry-deep bg-berry/5 w-full rounded-md border-2 p-3 text-left"
            >
              <p className="text-berry-deep text-sm font-semibold">
                {t("qr.makeNewCodeQuestion", { table })}
              </p>
              <p className="text-muted mt-0.5 text-sm">
                {t("qr.cardTableStops")}
              </p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={state === "busy"}
                  onClick={() => setConfirming(false)}
                >
                  {t("qr.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={state === "busy"}
                  onClick={() => void renew()}
                >
                  {state === "busy" ? t("qr.making") : t("qr.makeNewCode")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setState("idle");
                setConfirming(true);
              }}
            >
              {t("qr.newCode")}
            </Button>
          )}
          {state === "done" ? (
            <p role="status" className="text-sm font-semibold">
              {t("qr.newCodeMade")}
            </p>
          ) : state === "error" ? (
            <p role="alert" className="text-berry-deep text-sm font-semibold">
              {t("qr.didntSaveTry")}
            </p>
          ) : null}
        </div>
      </Card>
    </li>
  );
}
