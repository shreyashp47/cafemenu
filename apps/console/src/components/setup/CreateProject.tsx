import { fill, messages } from "@/lib/messages";
import { Button } from "../Button";
import { Words } from "./Words";
import { StageHeading } from "../StageHeading";
import { Card } from "./Card";
import { ShotPlaceholder } from "./ShotPlaceholder";

const { project: text } = messages.setup;

/** Step 3: a Firebase project on the free Spark plan, in their own account. */
export function CreateProject({
  cafeName,
  focus,
  onDone,
}: {
  cafeName: string;
  focus: boolean;
  onDone: () => void;
}) {
  return (
    <Card>
      <StageHeading eyebrow={text.eyebrow} title={text.title} focus={focus} />
      <p className="text-text text-lg">
        <Words text={text.lead} />
      </p>
      <ol className="text-text list-decimal space-y-3 pl-6 marker:font-semibold">
        {text.steps.map((step) => (
          <li key={step} className="pl-1">
            <Words text={fill(step, { name: cafeName })} />
          </li>
        ))}
      </ol>
      <ShotPlaceholder text={text.shot} />
      <ShotPlaceholder text={text.shotPlan} />
      <p className="text-muted">{text.keepOpen}</p>
      <Button onClick={onDone} className="w-full sm:w-auto">
        {text.next}
      </Button>
      <p className="text-muted text-sm">{text.already}</p>
    </Card>
  );
}
