"use client";

/**
 * Owner menu management (docs/requirements.md §4.3 step 2, §5.1).
 *
 * "Owner can edit menu without a developer", mostly from a phone. So the menu
 * is a list of compact rows the owner can scan: marking something sold out is
 * one tap on the row's switch, and the full edit form only opens for the one
 * item being edited. Adding an item is a form that stays out of the way until
 * it's asked for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CategoryPicker } from "@/components/CategoryPicker";
import { NewGuestsSetting } from "@/components/NewGuestsSetting";
import { Icon, categoryIcon, itemArtIcon } from "@/components/icons";
import {
  useConfigRepo,
  useIsDemo,
  useMenu,
  useMenuRepo,
  useSpecialOffer,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/money";
import { SEED_MENU } from "@/lib/data/seed";
import type { MenuItem } from "@/lib/types";

type Patch = Partial<Omit<MenuItem, "id">>;

export default function AdminMenuPage() {
  const { items, loading } = useMenu();
  const repo = useMenuRepo();
  const isDemo = useIsDemo();
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort(),
    [items],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()];
  }, [items]);

  const soldOut = items.filter((i) => !i.available).length;

  /** Runs one write; the page's error banner shows why it failed. */
  const run = useCallback(
    async (id: string | null, fn: () => Promise<void>): Promise<boolean> => {
      setSavingId(id);
      setError(null);
      try {
        await fn();
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "That change didn't save.",
        );
        return false;
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  if (loading || !repo) return <Loading label="Reading the menu…" />;

  return (
    <div className="flex flex-col gap-5 pb-8">
      {error ? (
        <p
          role="alert"
          className="border-berry bg-paper text-berry-deep rounded-md border-2 px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1">
          <NewGuestsSetting />
          <SpecialOfferCard />
        </aside>

        <section
          aria-labelledby="menu-heading"
          className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="menu-heading" className="text-xl">
                Menu
              </h2>
              <p className="tnum text-muted text-sm">
                {plural(items.length, "item")} ·{" "}
                {soldOut === 0 ? "all available" : `${soldOut} sold out`}
              </p>
            </div>
            <Button
              onClick={() => setAdding((open) => !open)}
              aria-expanded={adding}
              aria-controls="add-item"
              variant={adding ? "ghost" : "primary"}
            >
              <Icon name={adding ? "close" : "plus"} size={18} />
              {adding ? "Close" : "Add item"}
            </Button>
          </div>

          {adding ? (
            <AddItemCard
              categories={categories}
              onError={setError}
              onDone={() => setAdding(false)}
            />
          ) : null}

          {grouped.length > 1 ? <CategoryJump groups={grouped} /> : null}

          {items.length === 0 ? (
            <EmptyState
              title="No items yet"
              body={
                isDemo
                  ? "Tap Add item to add your first drink, or restore the sample menu below."
                  : "Tap Add item to add your first drink."
              }
            />
          ) : (
            grouped.map(([category, list]) => (
              <section
                key={category}
                id={`cat-${slug(category)}`}
                aria-labelledby={`m-${slug(category)}`}
                className="scroll-mt-56"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-pill bg-secondary/15 text-secondary grid size-9 place-items-center">
                    <Icon name={categoryIcon(category)} size={20} />
                  </span>
                  <h3 id={`m-${slug(category)}`} className="text-lg">
                    {category}
                  </h3>
                  <span className="tnum text-muted text-sm">
                    ({list.length})
                  </span>
                </div>

                <ul className="flex flex-col gap-2">
                  {list.map((item) => (
                    <MenuRow
                      key={item.id}
                      item={item}
                      categories={categories}
                      busy={savingId === item.id}
                      open={editingId === item.id}
                      onOpen={() => setEditingId(item.id)}
                      onClose={() => setEditingId(null)}
                      onToggle={(available) =>
                        void run(item.id, () =>
                          repo.update(item.id, { available }),
                        )
                      }
                      onSave={async (patch) => {
                        const ok = await run(item.id, () =>
                          repo.update(item.id, patch),
                        );
                        if (ok) setEditingId(null);
                      }}
                      onDelete={() =>
                        void run(item.id, async () => {
                          if (
                            !window.confirm(
                              `Remove "${item.name}" from the menu? Past orders keep it.`,
                            )
                          ) {
                            return;
                          }
                          await repo.remove(item.id);
                          setEditingId(null);
                        })
                      }
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          {isDemo ? (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h3 className="text-base">Reset the sample menu</h3>
                <p className="text-muted text-sm">
                  Demo data only. This replaces the current menu with{" "}
                  {SEED_MENU.length} sample items.
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() =>
                  void run("reset", async () => {
                    if (
                      !window.confirm(
                        "Replace the whole menu with the samples?",
                      )
                    ) {
                      return;
                    }
                    await repo.replaceAll(SEED_MENU.map((i) => ({ ...i })));
                    setEditingId(null);
                  })
                }
              >
                <Icon name="trash" size={18} />
                Reset samples
              </Button>
            </Card>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Shortcut chips to each category, for menus longer than one screen. */
function CategoryJump({ groups }: { groups: [string, MenuItem[]][] }) {
  return (
    <nav aria-label="Jump to category">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {groups.map(([category, list]) => (
          <li key={category} className="shrink-0">
            <a
              href={`#cat-${slug(category)}`}
              className="rounded-pill border-line bg-paper font-round text-ink hover:border-primary flex min-h-11 items-center gap-1.5 border-2 px-3.5 text-sm transition-colors"
            >
              <Icon name={categoryIcon(category)} size={17} />
              {category}
              <span className="tnum text-muted">{list.length}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SpecialOfferCard() {
  const repo = useConfigRepo();
  const offer = useSpecialOffer();
  const [text, setText] = useState(offer.text);
  const [enabled, setEnabled] = useState(offer.enabled);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    setText(offer.text);
    setEnabled(offer.enabled);
  }, [offer.text, offer.enabled]);

  const dirty = text !== offer.text || enabled !== offer.enabled;

  async function save() {
    if (!repo) return;
    setState("saving");
    try {
      await repo.save({ enabled, text });
      setState("saved");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  return (
    <Card className="p-4">
      <h2 className="text-lg">Today&apos;s special</h2>
      <p className="text-muted text-sm">
        One short line pinned to the top of the customer menu.
      </p>

      <div className="mt-3">
        <Field
          label="Message"
          htmlFor="special-text"
          hint="Up to 140 characters."
        >
          <Input
            id="special-text"
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            placeholder="Free refills before 11am"
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Switch
          tone="plain"
          checked={enabled}
          onChange={setEnabled}
          label="Show to customers"
        />
        <Button
          onClick={() => void save()}
          disabled={state === "saving" || !text.trim()}
        >
          {state === "saving"
            ? "Saving…"
            : state === "saved"
              ? "Saved ✓"
              : "Save"}
        </Button>
      </div>
      {state === "error" ? (
        <p role="alert" className="text-berry-deep mt-2 text-sm font-semibold">
          That didn&apos;t save. Try again.
        </p>
      ) : dirty && state === "idle" ? (
        <p className="text-muted mt-2 text-sm">
          Not live yet. Tap Save to show customers.
        </p>
      ) : null}
    </Card>
  );
}

function AddItemCard({
  categories,
  onError,
  onDone,
}: {
  categories: string[];
  onError: (message: string | null) => void;
  onDone: () => void;
}) {
  const repo = useMenuRepo();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  // null until the owner picks one: the menu loads after the first render, so
  // the default has to follow it rather than be fixed at mount. A picked
  // category that has since left the menu (its last item moved or deleted)
  // falls back to the default too, so the form never files an item under a
  // category the select no longer shows.
  const [picked, setPicked] = useState<{ name: string; isNew: boolean } | null>(
    null,
  );
  const category =
    picked && (picked.isNew || categories.includes(picked.name))
      ? picked.name
      : (categories[0] ?? "");
  // Remounts the picker after an add, so a just-created category shows as a
  // normal choice in the list instead of an open "new category" box.
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const priceError =
    price.trim() === ""
      ? undefined
      : Number.isFinite(Number(price)) && Number(price) > 0
        ? undefined
        : "Enter a price above 0.";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo) return;
    if (!name.trim() || priceError) {
      onError("Give the item a name and a valid price.");
      return;
    }
    if (!category.trim()) {
      onError("Give the new category a name.");
      return;
    }
    onError(null);
    setBusy(true);
    try {
      await repo.create({
        name: name.trim(),
        description: description.trim(),
        price: Math.round(Number(price)),
        category: category.trim(),
      });
      setAdded(`Added “${name.trim()}” to ${category.trim()}.`);
      setName("");
      setDescription("");
      setPrice("");
      setPicked({ name: category.trim(), isNew: false });
      setFormKey((k) => k + 1);
      nameRef.current?.focus();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add that item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="add-item" className="border-highlight! p-4">
      <h3 className="text-lg">Add an item</h3>
      <p
        role="status"
        className={cn(
          "text-sage-deep flex items-center gap-1.5 text-sm font-semibold",
          added ? "mt-1" : "sr-only",
        )}
      >
        {added ? (
          <>
            <Icon name="check" size={18} />
            {added} Add another, or tap Done.
          </>
        ) : null}
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="new-name">
          <Input
            ref={nameRef}
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cardamom Bun"
            required
          />
        </Field>
        <Field label="Price (₹)" htmlFor="new-price" error={priceError}>
          <Input
            id="new-price"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="140"
            required
          />
        </Field>
        <Field label="Category" htmlFor="new-category">
          <CategoryPicker
            key={formKey}
            id="new-category"
            categories={categories}
            value={category}
            onChange={(name, isNew) => setPicked({ name, isNew })}
          />
        </Field>
        <Field label="Short description" htmlFor="new-desc" hint="Optional.">
          <Textarea
            id="new-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Warm, sugary, cardamom-heavy."
            rows={2}
          />
        </Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            <Icon name="plus" size={18} />
            {busy ? "Adding…" : "Add to menu"}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            {added ? "Done" : "Cancel"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MenuRow({
  item,
  categories,
  busy,
  open,
  onOpen,
  onClose,
  onToggle,
  onSave,
  onDelete,
}: {
  item: MenuItem;
  categories: string[];
  busy: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: (available: boolean) => void;
  onSave: (patch: Patch) => Promise<void>;
  onDelete: () => void;
}) {
  const soldOut = !item.available;
  return (
    <li
      className={cn(
        "bg-paper shadow-card rounded-lg border-2 transition-colors",
        open
          ? "border-primary"
          : soldOut
            ? "border-line border-dashed"
            : "border-line-soft",
      )}
    >
      <div className="flex items-center gap-1.5 p-1 pr-1.5 sm:gap-2 sm:p-1.5 sm:pr-2">
        <button
          type="button"
          onClick={open ? onClose : onOpen}
          aria-expanded={open}
          aria-controls={open ? `edit-${item.id}` : undefined}
          className="hover:bg-cream-soft focus-visible:outline-ring flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 text-left transition-colors focus-visible:outline-3 sm:gap-3 sm:p-1.5"
        >
          <span
            className={cn(
              "bg-highlight-soft/70 text-primary grid size-10 shrink-0 place-items-center rounded-md sm:size-11",
              soldOut && "opacity-50 grayscale",
            )}
          >
            <Icon name={itemArtIcon(item.art)} size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="sr-only">Edit </span>
            <span
              className={cn(
                "font-round line-clamp-2 text-[0.95rem] leading-snug font-semibold sm:line-clamp-1",
                soldOut ? "text-body" : "text-ink",
              )}
            >
              {item.name}
            </span>
            <span className="text-muted block truncate text-sm leading-snug">
              <span className="tnum text-primary font-semibold">
                {formatINR(item.price)}
              </span>
              {/* on a phone the name needs the room; the editor shows it all */}
              {item.description ? (
                <span className="hidden sm:inline"> · {item.description}</span>
              ) : null}
            </span>
          </span>
          <Icon
            name={open ? "chevron" : "edit"}
            size={18}
            className={cn(
              "text-muted hidden shrink-0 sm:block",
              open && "rotate-180",
            )}
          />
        </button>

        <Switch
          checked={item.available}
          onChange={onToggle}
          disabled={busy}
          label={item.available ? "Available" : "Sold out"}
          srContext={`: ${item.name}`}
          className="min-w-[8.25rem]"
        />
      </div>

      {open ? (
        <MenuItemEditor
          item={item}
          categories={categories}
          busy={busy}
          onCancel={onClose}
          onSave={onSave}
          onDelete={onDelete}
        />
      ) : null}
    </li>
  );
}

/**
 * Mounted only while open, so the draft starts from the item as it is now and
 * a live update to some other item can't wipe what the owner is typing.
 */
function MenuItemEditor({
  item,
  categories,
  busy,
  onCancel,
  onSave,
  onDelete,
}: {
  item: MenuItem;
  categories: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: Patch) => Promise<void>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const dirty =
    draft.name !== item.name ||
    draft.description !== item.description ||
    draft.price !== item.price ||
    draft.category !== item.category;

  const priceError =
    Number.isFinite(draft.price) && draft.price > 0
      ? undefined
      : "Price must be above 0.";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || priceError || !draft.name.trim()) return;
    void onSave({
      name: draft.name.trim(),
      description: draft.description.trim(),
      price: draft.price,
      category: draft.category.trim() || "Drinks",
    });
  }

  return (
    <form
      id={`edit-${item.id}`}
      aria-label={`Edit ${item.name}`}
      onSubmit={submit}
      className="border-line-soft grid gap-3 border-t-2 p-3 sm:grid-cols-[1fr_8rem]"
    >
      <Field label="Name" htmlFor={`name-${item.id}`}>
        <Input
          id={`name-${item.id}`}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </Field>
      <Field label="Price (₹)" htmlFor={`price-${item.id}`} error={priceError}>
        <Input
          id={`price-${item.id}`}
          inputMode="numeric"
          value={String(draft.price)}
          onChange={(e) =>
            setDraft({
              ...draft,
              price: Math.max(0, Math.round(Number(e.target.value) || 0)),
            })
          }
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description" htmlFor={`desc-${item.id}`}>
          <Textarea
            id={`desc-${item.id}`}
            rows={2}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Category" htmlFor={`cat-${item.id}`}>
          <Select
            id={`cat-${item.id}`}
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          >
            {[...new Set([...categories, draft.category])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button
          type="submit"
          disabled={busy || !dirty || Boolean(priceError) || !draft.name.trim()}
        >
          <Icon name="check" size={18} />
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-pill border-line bg-paper font-round text-berry-deep hover:border-berry ml-auto inline-flex min-h-11 items-center gap-1.5 border-2 px-3.5 text-sm font-semibold transition-colors disabled:opacity-45"
        >
          <Icon name="trash" size={18} />
          Delete
        </button>
      </div>
    </form>
  );
}
