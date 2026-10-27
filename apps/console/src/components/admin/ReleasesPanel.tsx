"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { DataBundle, RolloutStatus } from "@/lib/data/types";
import { formatDate } from "@/lib/format";
import { errorText, fill, messages } from "@/lib/messages";
import type { Release } from "@/lib/platform/model";
import {
  emptyReleaseForm,
  firstReleaseProblem,
  releaseFormProblems,
  releaseInputOf,
  type ReleaseField,
  type ReleaseForm,
} from "@/lib/admin/release-form";
import { rolloutButton } from "@/lib/admin/overview";
import { Button, TextButton } from "../Button";
import { Field, FormSection, controlClass, controlProps } from "../form/Field";
import { Rich } from "../Rich";

const { releases: text } = messages.admin;

const FOCUS: Record<ReleaseField, string> = {
  version: "release-version",
  channel: "release-channel-beta",
  schemaVersion: "release-schema",
  notes: "release-notes",
};

/**
 * Publishing a release record, and the rollout of each published release.
 * Both are requests: the backend checks the package and writes the record
 * (AdminRequests), and the rollout buttons are a stub for #32.
 */
export function ReleasesPanel({ data }: { data: DataBundle }) {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [rollouts, setRollouts] = useState<Record<string, RolloutStatus>>({});

  const reload = useCallback(async () => {
    try {
      setReleases(await data.releases.list());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [data]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(
    () => data.admin.subscribeRollouts(setRollouts, () => setRollouts({})),
    [data],
  );

  return (
    <FormSection id="admin-releases" title={text.title}>
      <p className="text-text">{text.lead}</p>
      <PublishForm data={data} releases={releases ?? []} onPublished={reload} />
      <ReleaseList
        data={data}
        releases={releases}
        failed={failed}
        rollouts={rollouts}
        onRefresh={reload}
      />
    </FormSection>
  );
}

function PublishForm({
  data,
  releases,
  onPublished,
}: {
  data: DataBundle;
  releases: readonly Release[];
  onPublished: () => Promise<void>;
}) {
  const [form, setForm] = useState<ReleaseForm>(() => emptyReleaseForm([]));
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // The schema starts at the newest release's, once the list has loaded.
  const newest = useMemo(
    () => emptyReleaseForm(releases).schemaVersion,
    [releases],
  );
  useEffect(() => {
    if (!touched) setForm((f) => ({ ...f, schemaVersion: newest }));
  }, [newest, touched]);

  const existing = useMemo(() => releases.map((r) => r.version), [releases]);
  const problems = releaseFormProblems(form, existing);
  const error = (field: ReleaseField) =>
    attempted && problems[field] ? text.problems[problems[field]] : undefined;
  const set = <K extends keyof ReleaseForm>(key: K, value: ReleaseForm[K]) => {
    setTouched(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setMessage(null);
    const first = firstReleaseProblem(problems);
    if (first) {
      document.getElementById(FOCUS[first])?.focus();
      return;
    }
    const input = releaseInputOf(form);
    setBusy(true);
    try {
      await data.admin.publishRelease(input);
      setMessage({
        ok: true,
        text: fill(text.published, { version: input.version }),
      });
      setForm((f) => ({ ...f, version: "", notes: "" }));
      setAttempted(false);
      await onPublished();
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const form_ = text.form;
  return (
    <form noValidate onSubmit={send} className="space-y-6">
      <h3 className="text-ink text-lg font-semibold">{form_.title}</h3>
      <Field
        id="release-version"
        label={form_.version.label}
        hint={form_.version.hint}
        error={error("version")}
      >
        <input
          type="text"
          value={form.version}
          onChange={(e) => set("version", e.target.value)}
          autoComplete="off"
          spellCheck={false}
          {...controlProps("release-version", {
            hint: form_.version.hint,
            error: error("version"),
          })}
          className={`${controlClass} min-h-tap max-w-xs font-mono`}
        />
      </Field>

      <fieldset
        aria-describedby={
          error("channel") ? "release-channel-error" : undefined
        }
      >
        <legend className="text-ink font-semibold">
          {form_.channel.label}
        </legend>
        <div className="mt-3 space-y-3">
          {(["beta", "stable"] as const).map((channel) => (
            <label
              key={channel}
              className="border-line-field has-checked:border-brand has-checked:bg-brand-soft has-focus-visible:outline-ring flex cursor-pointer gap-3 rounded-lg border p-3 has-checked:border-2 has-focus-visible:outline-3 has-focus-visible:outline-offset-2"
            >
              <input
                id={`release-channel-${channel}`}
                type="radio"
                name="release-channel"
                checked={form.channel === channel}
                onChange={() => set("channel", channel)}
                className="accent-brand mt-1 h-5 w-5 shrink-0"
              />
              <span className="min-w-0">
                <span className="text-ink block font-semibold">
                  {form_.channel[channel]}
                </span>
                <span className="text-muted block text-sm">
                  {form_.channel[`${channel}Text`]}
                </span>
              </span>
            </label>
          ))}
        </div>
        {error("channel") && (
          <p
            id="release-channel-error"
            className="text-danger mt-2 text-sm font-medium"
          >
            {error("channel")}
          </p>
        )}
      </fieldset>

      <Field
        id="release-schema"
        label={form_.schema.label}
        hint={form_.schema.hint}
        error={error("schemaVersion")}
      >
        <input
          type="text"
          inputMode="numeric"
          value={form.schemaVersion}
          onChange={(e) => set("schemaVersion", e.target.value)}
          autoComplete="off"
          {...controlProps("release-schema", {
            hint: form_.schema.hint,
            error: error("schemaVersion"),
          })}
          className={`${controlClass} min-h-tap max-w-24`}
        />
      </Field>

      <Field
        id="release-notes"
        label={form_.notes.label}
        hint={form_.notes.hint}
        error={error("notes")}
      >
        <textarea
          rows={6}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          spellCheck
          {...controlProps("release-notes", {
            hint: form_.notes.hint,
            error: error("notes"),
          })}
          className={`${controlClass} py-2`}
        />
      </Field>

      {attempted && firstReleaseProblem(problems) && (
        <p role="alert" className="text-danger font-medium">
          {form_.fixFields}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={busy}>
          {busy ? form_.submitting : form_.submit}
        </Button>
        <p
          role="status"
          className={
            message?.ok === false
              ? "text-danger font-medium"
              : "text-brand-ink font-medium"
          }
        >
          {message?.text}
        </p>
      </div>
    </form>
  );
}

function ReleaseList({
  data,
  releases,
  failed,
  rollouts,
  onRefresh,
}: {
  data: DataBundle;
  releases: Release[] | null;
  failed: boolean;
  rollouts: Record<string, RolloutStatus>;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const list = text.list;
  const words = text.rollout;

  const act = async (version: string, action: "start" | "pause") => {
    setBusy(version);
    setMessage(null);
    try {
      await data.admin.rollout(version, action);
      setMessage({ ok: true, text: words.done });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="release-list-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="release-list-title" className="text-ink text-lg font-semibold">
          {list.title}
        </h3>
        <TextButton onClick={() => void onRefresh()}>{list.refresh}</TextButton>
      </div>
      <p className="text-muted text-sm">
        <Rich text={words.stub} />
      </p>
      {!releases && !failed && (
        <p role="status" className="text-muted">
          {list.loading}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-danger font-medium">
          {list.error}
        </p>
      )}
      {releases?.length === 0 && <p className="text-muted">{list.none}</p>}
      {releases && releases.length > 0 && (
        <ul className="divide-line divide-y">
          {releases.map((release) => {
            const status = rollouts[release.version];
            const button = rolloutButton(status);
            return (
              <li key={release.version} className="space-y-2 py-4">
                <p className="text-ink font-semibold">
                  <span className="font-mono">{release.version}</span>
                  <span className="text-muted font-normal">
                    {" · "}
                    {list.channel[release.channel]}
                    {release.withdrawn && ` · ${list.withdrawn}`}
                  </span>
                </p>
                <p className="text-muted text-sm">
                  {fill(list.published, {
                    date: formatDate(release.publishedAt),
                  })}
                  {" · "}
                  {fill(list.schema, { schema: release.schemaVersion })}
                </p>
                {!release.withdrawn && (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-text">
                      <span className="text-muted">{words.label}: </span>
                      {words.status[status ?? "none"]}
                    </p>
                    {button && (
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() =>
                          act(
                            release.version,
                            button === "pause" ? "pause" : "start",
                          )
                        }
                      >
                        {fill(words[button], { version: release.version })}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p
        role="status"
        className={
          message?.ok === false
            ? "text-danger font-medium"
            : "text-brand-ink font-medium"
        }
      >
        {message?.text}
      </p>
    </section>
  );
}
