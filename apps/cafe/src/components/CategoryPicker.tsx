"use client";

/**
 * Pick one of the menu's existing categories, or start a new one.
 *
 * The add-item form used to be a free-text input with a <datalist> of existing
 * categories, plus an effect that snapped the value back to the first category
 * whenever it didn't match one. Every keystroke — including deleting a letter to
 * start over — was undone, so the owner could neither type a new category nor
 * clear the box to see the suggestions (a datalist only shows options matching
 * what is already typed). A select for the existing ones and an explicit
 * "New category…" choice leaves nothing to guess.
 */

import { useState } from "react";

import { Input, Select } from "@/components/ui/Input";

const NEW = "__new__";

export function CategoryPicker({
  id,
  categories,
  value,
  onChange,
}: {
  id: string;
  categories: string[];
  value: string;
  /** `isNew` is true while the owner is typing a category that isn't listed. */
  onChange: (category: string, isNew: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  // An empty menu has nothing to pick from, so it can only be a new category.
  const typing = adding || categories.length === 0;

  const nameInput = (
    <Input
      id={categories.length === 0 ? id : `${id}-new`}
      aria-label={categories.length === 0 ? undefined : "New category name"}
      value={value}
      onChange={(e) => onChange(e.target.value, true)}
      placeholder="Bakes"
      autoFocus={adding}
      required
    />
  );

  if (categories.length === 0) return nameInput;

  return (
    <>
      <Select
        id={id}
        value={typing ? NEW : value}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setAdding(true);
            onChange("", true);
          } else {
            setAdding(false);
            onChange(e.target.value, false);
          }
        }}
      >
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={NEW}>New category…</option>
      </Select>
      {typing ? nameInput : null}
    </>
  );
}
