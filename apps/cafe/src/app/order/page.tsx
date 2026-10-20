"use client";

import { Suspense, useMemo, useState } from "react";

import { Doodles } from "@/components/Doodles";
import {
  Icon,
  categoryIcon,
  itemArtIcon,
  type IconName,
} from "@/components/icons";
import { Mascot } from "@/components/Mascot";
import {
  DataProvider,
  useIsDemo,
  useMenu,
  useSpecialOffer,
  useTables,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { Sheet } from "@/components/ui/Sheet";
import { SpeechBubble, WashiNote } from "@/components/ui/SpeechBubble";
import { useCart } from "@/hooks/useCart";
import { useTableCode, useTakeKeyFromAddress } from "@/hooks/useTableCode";
import { useTableQuery } from "@/hooks/useTableQuery";
import { getCafeName, getCafeTagline } from "@/lib/config";
import { formatINR, lineSubtotal, priceCart } from "@/lib/money";
import { orderCapProblems } from "@/lib/order-caps";
import { readTableCode, type TableCode } from "@/lib/table-keys";
import type { MenuItem } from "@/lib/types";

export default function OrderPage() {
  return (
    <DataProvider>
      {/*
        A static export prerenders this route with no query string, so anything
        reading it has to sit behind a Suspense boundary or the build fails.
        It also keeps the "Finding your table…" loader inside the boundary,
        which is where it belongs — it is the fallback, not the whole page.
      */}
      <Suspense fallback={<Loading label="Finding your table…" />}>
        <OrderScreen />
      </Suspense>
    </DataProvider>
  );
}

function OrderScreen() {
  const { ready, tableNumber, raw, tableKey } = useTableQuery();
  // The owner's live table list (config/tables), or the env default until one
  // is saved. Wait for it rather than judging the URL against the default: a
  // QR code for table 9 is valid in a cafe that saved 1..12, and must not be
  // flashed "that table number looks odd" while the list is on its way.
  const { tables: known, loading } = useTables();
  // Save the scanned code (restarting its 3 hours) and take it out of the
  // address bar, so it is not left in history, a bookmark or a shared link.
  useTakeKeyFromAddress(ready, tableNumber, tableKey);

  if (!ready || loading) return <Loading label="Finding your table…" />;
  if (tableNumber === null) return <ScanPrompt odd={raw !== null} />;
  // A number that parses but is not a table this cafe has. Reachable by editing
  // the URL, or by scanning a QR code left over from a table that has since been
  // removed. Worth catching here rather than at checkout: the rules accept
  // tableNumber 1..50 while the parser accepts 1..999, so without this the
  // customer builds a whole basket and is refused by Firestore at the last step,
  // with an error about a number they never chose.
  if (!known.includes(tableNumber)) return <ScanPrompt odd />;

  return <MenuScreen tableNumber={tableNumber} urlKey={tableKey} />;
}

/**
 * Where a customer lands without a usable table in the address.
 *
 * This used to be a grid of table numbers to tap. It had to go: a table's QR
 * code carries a secret code (src/lib/table-keys.ts), and a tapped number
 * cannot, so once the owner switches codes on every one of those buttons would
 * lead to a menu that refuses the order at the very last step. The phone cannot
 * tell which tables have codes either — they are unreadable to customers on
 * purpose. So the honest answer is the only one that always works: scan.
 */
function ScanPrompt({ odd }: { odd: boolean }) {
  return (
    <main className="relative mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-5 px-5 py-10 text-center">
      <Doodles />
      <Mascot mood="worry" size={140} />
      <h1 className="font-hand text-primary-dark text-4xl">
        {odd ? "That table number looks odd" : "Scan the QR code on your table"}
      </h1>
      <div className="border-line bg-paper shadow-card flex w-full items-center gap-3 rounded-lg border-2 p-4 text-left">
        <span className="bg-highlight-soft text-primary grid size-12 shrink-0 place-items-center rounded-md">
          <Icon name="qr" size={28} />
        </span>
        <p className="text-body text-sm leading-snug">
          {odd
            ? "Scan the QR code on your table again — it opens the menu for that table."
            : "Point your phone's camera at the card on your table. It opens the menu for that table."}
        </p>
      </div>
      <p className="text-muted max-w-xs text-sm">
        No card on your table? Ask at the counter and we&apos;ll take your order
        there.
      </p>
    </main>
  );
}

function MenuScreen({
  tableNumber,
  urlKey,
}: {
  tableNumber: number;
  urlKey: string | null;
}) {
  const { items, loading, error } = useMenu();
  const code = useTableCode(tableNumber, urlKey);
  const offer = useSpecialOffer();
  const isDemo = useIsDemo();
  const cart = useCart(tableNumber, items);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const categories = useMemo(() => {
    const seen = new Map<string, IconName>();
    for (const item of items)
      seen.set(item.category, categoryIcon(item.category));
    return [...seen.entries()];
  }, [items]);

  const byCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [items]);

  const showAll = activeCategory === "All";
  const groups = showAll
    ? categories
    : categories.filter(([name]) => name === activeCategory);

  /** Live re-pricing at checkout: catches a price change or a sold-out item. */
  const priceCheck = useMemo(
    () => priceCart(cart.lines, items),
    [cart.lines, items],
  );

  function jumpTo(category: string) {
    setActiveCategory(category);
    if (category === "All") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document
      .getElementById(`cat-${slug(category)}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="pb-cart relative min-h-svh">
      <Doodles />

      <header className="safe-t border-line-soft bg-cream/85 relative z-10 border-b-2 backdrop-blur-sm">
        <div className="shell flex items-center gap-3 py-3">
          <Mascot size={58} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="font-hand text-primary truncate text-[2rem] leading-none">
              {getCafeName()}
            </h1>
            <p className="text-2xs text-muted truncate font-semibold tracking-[0.14em] uppercase">
              {getCafeTagline()}
            </p>
          </div>
          <span className="rounded-pill border-primary bg-paper font-round text-primary flex shrink-0 items-center gap-1.5 border-2 px-3 py-1.5 text-sm">
            <Icon name="pin" size={16} />
            <span className="tnum">{tableNumber}</span>
          </span>
        </div>
      </header>

      {offer.enabled && offer.text ? (
        <div className="shell relative z-10 flex justify-center pt-4">
          <WashiNote tone="sage" tilt={-1.5}>
            {offer.text}
          </WashiNote>
        </div>
      ) : null}

      {isDemo ? <DemoNotice /> : null}

      <ScanNotice code={code} />

      {/* category rail — docs/anime-theme.md §4: icons, not plain text labels */}
      {items.length > 0 ? (
        <nav
          aria-label="Menu categories"
          className="no-scrollbar border-line-soft bg-cream/90 sticky top-0 z-20 mt-4 overflow-x-auto border-y-2 backdrop-blur-sm"
          // fades the right edge so a cut-off chip reads as "scroll me"
          style={{
            maskImage:
              "linear-gradient(to right, #000 0, #000 calc(100% - 1.5rem), transparent 100%)",
          }}
        >
          <div className="shell flex gap-2 py-2">
            <CategoryChip
              label="All"
              icon="sparkle"
              active={showAll}
              onClick={() => jumpTo("All")}
            />
            {categories.map(([name, icon]) => (
              <CategoryChip
                key={name}
                label={name}
                icon={icon}
                active={activeCategory === name}
                onClick={() => jumpTo(name)}
              />
            ))}
          </div>
        </nav>
      ) : null}

      <main className="shell relative z-10 pt-4">
        {error ? (
          <div
            role="alert"
            className="border-berry bg-paper rounded-lg border-2 p-4 text-center"
          >
            <p className="text-berry-deep font-semibold">
              We couldn&apos;t load the menu.
            </p>
            <p className="text-muted mt-1 text-sm">{error.message}</p>
          </div>
        ) : loading || items.length === 0 ? (
          <Loading label="Setting out the cups…" />
        ) : (
          <div className="flex flex-col gap-7 pb-4">
            {groups.map(([category, icon]) => (
              <section
                key={category}
                id={`cat-${slug(category)}`}
                aria-labelledby={`h-${slug(category)}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-pill bg-secondary/15 text-secondary grid size-9 place-items-center">
                    <Icon name={icon} size={20} />
                  </span>
                  <h2 id={`h-${slug(category)}`} className="text-xl">
                    {category}
                  </h2>
                </div>

                <ul className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                  {byCategory.get(category)?.map((item) => (
                    <MenuCard
                      key={item.id}
                      item={item}
                      qty={
                        cart.lines.find((l) => l.menuItemId === item.id)?.qty ??
                        0
                      }
                      onAdd={() => cart.add(item)}
                      onInc={() => cart.increment(item.id)}
                      onDec={() => cart.decrement(item.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="text-muted pt-2 pb-6 text-center text-sm">
          Pay at the counter when you&apos;re done — no app, no OTP, no
          cash-handling here.
        </p>
      </main>

      {/* floating cart trigger */}
      {cart.count > 0 ? (
        <div className="safe-b fixed inset-x-0 bottom-0 z-30 px-4">
          <Button
            size="lg"
            fullWidth
            onClick={() => setSheetOpen(true)}
            className="shadow-lift"
          >
            <Icon name="cart" size={22} />
            <span>View order</span>
            <span className="tnum rounded-pill bg-on-dark/20 px-2.5 py-0.5 text-sm">
              {cart.count}
            </span>
            <span className="tnum ml-auto">{formatINR(cart.total)}</span>
          </Button>
        </div>
      ) : null}

      <CartSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        tableNumber={tableNumber}
        code={code}
        cart={cart}
        priceCheck={priceCheck}
        menu={items}
      />
    </div>
  );
}

function CategoryChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-pill font-round flex min-h-11 shrink-0 items-center gap-1.5 border-2 px-3.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-on-dark shadow-card"
          : "border-line bg-paper text-ink hover:border-primary",
      ].join(" ")}
    >
      <Icon name={icon} size={18} />
      {label}
    </button>
  );
}

function MenuCard({
  item,
  qty,
  onAdd,
  onInc,
  onDec,
}: {
  item: MenuItem;
  qty: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
}) {
  const soldOut = !item.available;

  return (
    // No opacity on the whole card: it drags every text colour below the WCAG AA
    // contrast floor (axe measured 3.41:1 for the "Sold out" badge). Sold out is
    // signalled with a muted surface, a muted illustration, a struck-through name
    // and an explicit badge instead.
    <li
      className={[
        "border-line-soft shadow-card flex h-full flex-col overflow-hidden rounded-lg border-2",
        soldOut ? "bg-tan/40" : "bg-paper",
      ].join(" ")}
    >
      <div className="flex flex-1 gap-2.5 p-2.5">
        <div
          className={[
            "grid size-11 shrink-0 place-items-center rounded-md min-[420px]:size-14",
            soldOut ? "bg-tan text-muted" : "bg-highlight-soft/70 text-primary",
          ].join(" ")}
        >
          <Icon name={itemArtIcon(item.art)} size={26} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[0.95rem] leading-snug text-balance">
            {item.name}
          </h3>
          {item.description ? (
            <p className="text-muted mt-0.5 line-clamp-2 text-[0.8rem] leading-snug">
              {item.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* price lives on its own row so a long name can never squeeze it out */}
      {/* Wraps only as a last resort (a 4-digit price on a narrow card): the
          stepper then drops under the price instead of spilling out of the card. */}
      <div className="border-line-soft mt-auto flex flex-wrap items-center justify-between gap-x-1 gap-y-1 border-t-2 px-2 py-1.5">
        <span className="tnum font-round text-primary pl-0.5 text-base font-semibold">
          {formatINR(item.price)}
        </span>
        {soldOut ? (
          <span className="rounded-pill bg-tan-deep font-round text-ink px-3 py-1.5 text-sm">
            Sold out
          </span>
        ) : qty === 0 ? (
          <Button size="sm" variant="highlight" onClick={onAdd}>
            <Icon name="plus" size={18} />
            Add
          </Button>
        ) : (
          <Stepper
            name={item.name}
            qty={qty}
            onDec={onDec}
            onInc={onInc}
            className="ml-auto"
          />
        )}
      </div>
    </li>
  );
}

/**
 * − qty + as one joined pill. The buttons keep their 44px tap targets but share
 * one outline instead of each carrying its own border and gap, so the control
 * is 108px wide and fits beside the price on a half-width card at 360–390px.
 */
function Stepper({
  name,
  qty,
  onDec,
  onInc,
  className,
}: {
  name: string;
  qty: number;
  onDec: () => void;
  onInc: () => void;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-pill bg-paper ring-primary flex shrink-0 items-center ring-2 ring-inset",
        className ?? "",
      ].join(" ")}
    >
      <StepperButton label={`Remove one ${name}`} onClick={onDec}>
        <Icon name="minus" size={18} />
      </StepperButton>
      <span
        className="tnum font-round text-ink min-w-5 text-center text-lg"
        aria-live="polite"
      >
        {qty}
      </span>
      <StepperButton label={`Add one more ${name}`} onClick={onInc}>
        <Icon name="plus" size={18} />
      </StepperButton>
    </div>
  );
}

function StepperButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-pill text-primary hover:bg-highlight-soft/60 focus-visible:outline-ring grid size-11 place-items-center transition-transform focus-visible:outline-3 active:scale-90"
    >
      {children}
    </button>
  );
}

function CartSheet({
  open,
  onClose,
  tableNumber,
  code,
  cart,
  priceCheck,
  menu,
}: {
  open: boolean;
  onClose: () => void;
  tableNumber: number;
  code: TableCode;
  cart: ReturnType<typeof useCart>;
  priceCheck: ReturnType<typeof priceCart>;
  menu: MenuItem[];
}) {
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  // A price change is fine (the button below shows the live total); a sold-out or
  // deleted item is not, and must be resolved before the order can go through.
  // Over the size limits the rules enforce: say so before the tap, not after.
  const caps = orderCapProblems(priceCheck.lines, priceCheck.total);
  const blocked = priceCheck.blocking.length > 0 || caps.length > 0;
  // The table has a code and this phone's copy has run out: no order can get
  // through, so say so before the tap rather than after it.
  const needsScan = code.state === "expired";

  async function place() {
    setError(null);
    // Judged again now, not when the page loaded: a tab left open past the
    // 3 hours must not send a code that has run out.
    const fresh = readTableCode(tableNumber);
    if (fresh.state === "expired") {
      setError(SCAN_AGAIN);
      return;
    }
    setPlacing(true);
    try {
      const { placeOrder } = await import("@/lib/place-order");
      const tableKey = fresh.state === "valid" ? fresh.key : null;
      const order = await placeOrder({
        tableNumber,
        cartLines: cart.lines,
        menu,
        notes: undefined,
        tableKey,
      });
      cart.clear();
      // No code in this address: "Back to the menu" relies on the phone's
      // saved copy, and a shared or bookmarked confirmation link carries none.
      window.location.assign(
        `/order/confirmation?table=${tableNumber}&id=${order.id}`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't send that. Try again.",
      );
      setPlacing(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Table ${tableNumber}`}
      footer={
        cart.isEmpty ? null : (
          <div className="flex flex-col gap-2 pb-1">
            {blocked ? (
              <p
                role="alert"
                className="border-berry/40 bg-berry/10 text-berry-deep rounded-sm border-2 px-3 py-2 text-sm"
              >
                {[...priceCheck.blocking, ...caps].join(" ")} Please adjust your
                order.
              </p>
            ) : priceCheck.changes.length > 0 ? (
              <p
                role="status"
                className="border-secondary/40 bg-highlight-soft/60 text-primary-dark rounded-sm border-2 px-3 py-2 text-sm"
              >
                Price updated &mdash; the total below is what you&apos;ll pay.
              </p>
            ) : null}
            {needsScan && !error ? (
              <p
                role="alert"
                className="border-berry/40 bg-berry/10 text-berry-deep rounded-sm border-2 px-3 py-2 text-sm"
              >
                {SCAN_AGAIN}
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="border-berry/40 bg-berry/10 text-berry-deep rounded-sm border-2 px-3 py-2 text-sm"
              >
                {error}
              </p>
            ) : null}
            <label className="text-body flex min-h-11 cursor-pointer items-center gap-2.5 px-1 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="size-5 accent-[var(--primary)]"
              />
              I&apos;ll pay at the counter.
            </label>
            <Button
              size="lg"
              fullWidth
              disabled={placing || blocked || !agreed || needsScan}
              onClick={place}
            >
              {placing
                ? "Sending…"
                : `Place order · ${formatINR(priceCheck.total)}`}
            </Button>
          </div>
        )
      }
    >
      {cart.isEmpty ? (
        <EmptyState
          mood="worry"
          title="Nothing here yet"
          body="Tap + Add on anything that looks good. It stays here if you switch apps."
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {cart.lines.map((line) => {
            const item = menu.find((m) => m.id === line.menuItemId);
            return (
              <li
                key={line.menuItemId}
                className="border-line-soft bg-paper rounded-md border-2 p-2.5"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-ink truncate font-semibold">
                      {line.name}
                    </p>
                    <p className="tnum text-muted text-sm">
                      {formatINR(line.price)} each
                    </p>
                  </div>
                  <Stepper
                    name={line.name}
                    qty={line.qty}
                    onDec={() => cart.decrement(line.menuItemId)}
                    onInc={() => cart.increment(line.menuItemId)}
                  />
                </div>
                <div className="border-line-soft mt-2 flex items-center justify-between border-t pt-2">
                  <p className="tnum text-primary font-semibold">
                    {formatINR(lineSubtotal(line))}
                  </p>
                  <button
                    type="button"
                    onClick={() => cart.remove(line.menuItemId)}
                    className="text-muted hover:text-berry-deep min-h-11 px-2 text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    Remove
                  </button>
                </div>
                {item && !item.available ? (
                  <p className="text-berry-deep mt-1 text-sm font-semibold">
                    Just sold out — remove it to continue.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!cart.isEmpty ? (
        <SpeechBubble mood="happy" className="mt-4" tail="none">
          {cart.count === 1
            ? "One for the road?"
            : `${cart.count} items going on order #soon.`}
        </SpeechBubble>
      ) : null}
    </Sheet>
  );
}

const SCAN_AGAIN =
  "It's been a while since you scanned. To order, please scan the QR code on your table again.";

/**
 * Said before the customer builds a basket, not only at checkout, whenever this
 * phone has no fresh code for the table.
 *
 * Two strengths, because the phone cannot read which tables have codes:
 * - expired: the phone once scanned a code here, so the table has one and
 *   ordering is switched off until a new scan (see CartSheet).
 * - none: the phone has never scanned here. The table may be one without a code
 *   yet, which still takes orders, so this is a hint and the order is tried;
 *   if the rules refuse it, checkout says to scan (TableCodeRefused).
 */
function ScanNotice({ code }: { code: TableCode }) {
  if (code.state === "valid") return null;
  return (
    <div className="shell relative z-10 pt-3">
      <div
        role="status"
        className={[
          "flex items-center gap-2.5 rounded-md border-2 px-3 py-2",
          code.state === "expired"
            ? "border-berry/50 bg-berry/10"
            : "border-line bg-paper",
        ].join(" ")}
      >
        <Icon name="qr" size={22} className="text-primary shrink-0" />
        <p className="text-ink text-sm leading-snug">
          {code.state === "expired"
            ? SCAN_AGAIN
            : "To order, scan the QR code on your table."}
        </p>
      </div>
    </div>
  );
}

function DemoNotice() {
  return (
    <div className="shell relative z-10 pt-3">
      <div className="border-secondary/50 bg-highlight-soft/50 flex items-start gap-2 rounded-md border-2 border-dashed px-3 py-2">
        <Icon name="sparkle" size={18} className="text-secondary mt-0.5" />
        <p className="text-primary-dark text-sm leading-snug">
          <strong className="font-semibold">Demo mode.</strong> Orders are saved
          in this browser only. Add Firebase keys to <code>.env.local</code> to
          go live.
        </p>
      </div>
    </div>
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
