import type { Metadata } from "next";
import { SignupClosed } from "@/components/SignupClosed";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SetupFlow } from "@/components/setup/SetupFlow";
import { signupOpen } from "@/lib/config";
import { messages } from "@/lib/messages";

export const metadata: Metadata = { title: messages.meta.setupTitle };

/**
 * Onboarding (#27): the owner's steps 3 and 4, creating a Firebase project
 * and giving CafeMenu access, for a cafe saved by sign-up. Closed with
 * sign-up against the real platform (src/lib/config.ts).
 */
export default function Setup() {
  return (
    <>
      <SiteHeader onHome={false} />
      <main id="main" className="bg-sunk">
        {signupOpen ? <SetupFlow /> : <SignupClosed />}
      </main>
      <SiteFooter />
    </>
  );
}
