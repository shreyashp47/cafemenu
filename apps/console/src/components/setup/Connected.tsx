import { fill, messages } from "@/lib/messages";
import { cloudIamUrl } from "@/lib/setup/links";
import { TextButton } from "../Button";
import { StageHeading } from "../StageHeading";
import { Card } from "./Card";
import { Words } from "./Words";

const { connected: text } = messages.setup;

/** The check passed: what happens next, and where access can be removed. */
export function Connected({
  cafeName,
  projectId,
  focus,
  onBack,
}: {
  cafeName: string;
  projectId: string;
  focus: boolean;
  onBack: () => void;
}) {
  return (
    <Card>
      <StageHeading
        eyebrow={text.eyebrow}
        title={fill(text.title, { name: cafeName })}
        focus={focus}
      />
      <p className="text-text text-lg">
        <Words text={fill(text.text, { project: projectId })} />
      </p>
      {/* TODO(#28): start provisioning here, and show its progress. */}
      <p className="border-brand bg-brand-soft text-ink rounded-md border-l-4 p-4">
        {text.next}
      </p>
      <p className="text-text">
        <Words text={fill(text.iam, { url: cloudIamUrl(projectId) })} />
      </p>
      <TextButton onClick={onBack}>{text.back}</TextButton>
    </Card>
  );
}
