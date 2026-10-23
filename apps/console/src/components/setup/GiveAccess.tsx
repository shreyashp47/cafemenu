"use client";

import { useState } from "react";
import { deployAccount } from "@/lib/config";
import { fill, messages, problemText } from "@/lib/messages";
import { isProjectId } from "@/lib/platform/validate";
import type { ConnectionResult } from "@/lib/setup/connection";
import {
  cloudIamUrl,
  projectSettingsUrl,
  usersAndPermissionsUrl,
} from "@/lib/setup/links";
import {
  answerFor,
  cleanProjectId,
  type WizardState,
} from "@/lib/setup/wizard";
import { Button, TextButton } from "../Button";
import { CopyButton } from "../CopyButton";
import { Words } from "./Words";
import { StageHeading } from "../StageHeading";
import { Field, controlClass, controlProps } from "../form/Field";
import { Card } from "./Card";
import { ShotPlaceholder } from "./ShotPlaceholder";

const { access: text } = messages.setup;

/**
 * Step 4: the project's ID, the deploy account added as a member, and
 * Check connection. Says plainly that the member won't show in the Firebase
 * console's list, and links to where it does.
 */
export function GiveAccess({
  state,
  demo,
  focus,
  onProjectId,
  onCheck,
  onBack,
}: {
  state: WizardState;
  demo: boolean;
  focus: boolean;
  onProjectId: (value: string) => void;
  onCheck: () => void;
  onBack: () => void;
}) {
  const [tried, setTried] = useState(false);
  const projectId = cleanProjectId(state.projectId);
  const wellFormed = isProjectId(projectId);
  const idError =
    tried && !wellFormed ? problemText("project-id-format") : undefined;
  const answer = answerFor(state);
  const checking = answer.status === "checking";
  const iam = cloudIamUrl(wellFormed ? projectId : null);

  const check = () => {
    setTried(true);
    if (!wellFormed) {
      document.getElementById("setup-project-id")?.focus();
      return;
    }
    onCheck();
  };

  return (
    <Card>
      <StageHeading eyebrow={text.eyebrow} title={text.title} focus={focus} />
      <p className="text-text text-lg">{text.lead}</p>
      <p>
        <Words text={text.what} />
      </p>

      <Field
        id="setup-project-id"
        label={text.projectId.label}
        hint={text.projectId.hint}
        error={idError}
      >
        <input
          type="text"
          value={state.projectId}
          onChange={(e) => onProjectId(e.target.value)}
          onBlur={() => state.projectId && setTried(true)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={40}
          {...controlProps("setup-project-id", { hint: true, error: idError })}
          className={`${controlClass} min-h-tap font-mono`}
        />
      </Field>
      <p className="-mt-2 text-sm">
        <a
          href={projectSettingsUrl(wellFormed ? projectId : null)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-ink font-medium underline underline-offset-4"
        >
          {text.projectId.open}
          <span className="sr-only"> {messages.setup.newTab}</span>
        </a>
      </p>

      <section aria-labelledby="setup-member-title" className="space-y-4">
        <h2
          id="setup-member-title"
          className="font-display text-ink text-xl tracking-tight"
        >
          {text.member.title}
        </h2>
        <ol className="text-text list-decimal space-y-4 pl-6 marker:font-semibold">
          <li className="pl-1">
            <Words
              text={fill(text.member.open, {
                url: usersAndPermissionsUrl(wellFormed ? projectId : null),
              })}
            />
          </li>
          <li className="pl-1">
            <Words text={text.member.add} />
            {deployAccount ? (
              <div className="border-line bg-sunk mt-2 flex flex-wrap items-center gap-3 rounded-md border p-3">
                <code
                  id="setup-deploy-account"
                  className="text-ink min-w-0 font-mono text-sm break-all"
                >
                  {deployAccount}
                </code>
                <CopyButton
                  text={deployAccount}
                  label={text.member.copy}
                  done={text.member.copied}
                  tone="light"
                  describedBy="setup-deploy-account"
                />
              </div>
            ) : (
              <p className="bg-danger-soft text-danger mt-2 rounded-md p-3 text-sm font-medium">
                {text.member.noAccount}
              </p>
            )}
          </li>
          <li className="pl-1">
            <Words text={text.member.role} />
          </li>
          <li className="pl-1">
            <Words text={text.member.confirm} />
          </li>
        </ol>
        <ShotPlaceholder text={text.member.shot} />
        <div className="border-accent bg-accent-soft rounded-md border-l-4 p-4">
          <p className="text-ink font-semibold">{text.hidden.title}</p>
          <p className="text-text mt-1">
            <Words text={fill(text.hidden.text, { url: iam })} />
          </p>
        </div>
      </section>

      {demo && (
        <p className="text-muted text-sm">
          <Words text={text.demo} />
        </p>
      )}

      <div className="space-y-3">
        <Button
          onClick={check}
          disabled={checking}
          className="w-full sm:w-auto"
        >
          {checking ? text.checking : text.check}
        </Button>
        <div aria-live="polite">
          {answer.status === "answered" && (
            <CheckAnswer
              result={answer.result}
              projectId={answer.projectId}
              iam={iam}
            />
          )}
          {answer.status === "failed" && (
            <p className="bg-danger-soft text-danger rounded-md p-3 font-medium">
              {fill(text.result.failed, { error: answer.error })}
            </p>
          )}
        </div>
        <p className="text-muted text-sm">{text.saved}</p>
      </div>

      <TextButton onClick={onBack}>{text.back}</TextButton>
    </Card>
  );
}

/** What a check that ran found wrong. A passing one moves the step on. */
function CheckAnswer({
  result,
  projectId,
  iam,
}: {
  result: ConnectionResult;
  projectId: string;
  iam: string;
}) {
  if (result.status === "connected") return null;
  const project = `\`${projectId}\``;
  if (result.status === "no-access") {
    const words = text.result["no-access"];
    return (
      <div className="bg-danger-soft rounded-md p-4">
        <p className="text-danger font-semibold">
          <Words text={fill(words.title, { project })} />
        </p>
        <ul className="text-ink mt-2 list-disc space-y-1 pl-5">
          {words.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }
  const words = text.result.missing;
  return (
    <div className="bg-danger-soft rounded-md p-4">
      <p className="text-danger font-semibold">
        <Words text={fill(words.title, { project })} />
      </p>
      <p className="text-ink mt-2">{words.lead}</p>
      <ul className="text-ink mt-1 list-disc space-y-1 pl-5">
        {result.missing.map((gap) => (
          <li key={gap.permission}>
            <Words
              text={fill(words.item, {
                why: gap.why,
                permission: gap.permission,
              })}
            />
          </li>
        ))}
      </ul>
      <p className="text-ink mt-2">
        <Words text={fill(words.fix, { url: iam })} />
      </p>
    </div>
  );
}
