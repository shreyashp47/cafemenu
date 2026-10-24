import { deployAccount } from "@/lib/config";
import { fill, messages } from "@/lib/messages";
import type { Cafe } from "@/lib/platform/model";
import { cloudIamUrl } from "@/lib/setup/links";
import { CopyButton } from "../CopyButton";
import { Rich } from "../Rich";
import { FormSection } from "../form/Field";
import { Words } from "../setup/Words";

const { access: text } = messages.cafe;

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="text-text list-disc space-y-1 pl-6">
      {items.map((item) => (
        <li key={item}>
          <Rich text={item} />
        </li>
      ))}
    </ul>
  );
}

function Steps({ items, url }: { items: readonly string[]; url?: string }) {
  return (
    <ol className="text-text list-decimal space-y-2 pl-6">
      {items.map((item) => (
        <li key={item} className="pl-1">
          <Words text={url ? fill(item, { url }) : item} />
        </li>
      ))}
    </ol>
  );
}

/**
 * What CafeMenu can do in the owner's project, how to check it and remove it,
 * and what leaving means. The words are docs/legal/access-explained.md's, and
 * wait for the same things it waits for (the roles, from the Phase 0 spike).
 */
export function AccessPanel({ cafe }: { cafe: Cafe }) {
  const iam = cloudIamUrl(cafe.projectId);
  return (
    <FormSection id="access" title={text.title}>
      <p className="text-text">{text.lead}</p>

      <div className="space-y-2">
        <p className="text-ink font-semibold">{text.account.label}</p>
        {deployAccount ? (
          <div className="border-line bg-sunk flex flex-wrap items-center gap-3 rounded-md border p-3">
            <code
              id="access-deploy-account"
              className="text-ink min-w-0 font-mono text-sm break-all"
            >
              {deployAccount}
            </code>
            <CopyButton
              text={deployAccount}
              label={text.copy}
              done={text.copied}
              tone="light"
              describedBy="access-deploy-account"
            />
          </div>
        ) : (
          <p className="bg-sunk text-text rounded-md p-3 text-sm">
            {text.account.none}
          </p>
        )}
        <p className="text-text">
          <Rich text={text.roles} />
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-ink text-lg font-semibold">{text.can.title}</h3>
        <p className="text-text">
          <Rich text={text.can.text} />
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-ink text-lg font-semibold">{text.will.title}</h3>
        <List items={text.will.items} />
      </div>

      <div className="space-y-2">
        <h3 className="text-ink text-lg font-semibold">{text.wont.title}</h3>
        <List items={text.wont.items} />
      </div>

      <div className="space-y-2">
        <h3 className="text-ink text-lg font-semibold">{text.check.title}</h3>
        <p className="text-text">{text.check.lead}</p>
        <Steps items={text.check.steps} url={iam} />
        <p className="text-text">
          <Words text={text.check.more} />
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-ink text-lg font-semibold">{text.remove.title}</h3>
        <Steps items={text.remove.steps} />
      </div>

      <div className="space-y-2">
        <h3 className="text-ink text-lg font-semibold">{text.leaving.title}</h3>
        <p className="text-text">{text.leaving.lead}</p>
        <List items={text.leaving.items} />
        <p className="text-text">{text.leaving.back}</p>
        <p className="text-text">
          <Words text={text.leaving.delete} />
        </p>
      </div>

      <p>
        <Words text={text.full} />
      </p>
    </FormSection>
  );
}
