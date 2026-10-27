import type { Metadata } from "next";
import { SignupClosed } from "@/components/SignupClosed";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SignupFlow } from "@/components/signup/SignupFlow";
import { signupOpen } from "@/lib/config";
import { messages } from "@/lib/messages";

const { meta } = messages;

export const metadata: Metadata = { title: meta.signupTitle };

/**
 * Sign-up (#26): the form, the email link and the draft cafe. Against the
 * real platform it stays a "coming soon" page until NEXT_PUBLIC_SIGNUP_OPEN
 * is set (src/lib/config.ts).
 */
export default function SignUp() {
  return (
    <>
      <SiteHeader onHome={false} />
      <main id="main" className="bg-sunk">
        {signupOpen ? <SignupFlow /> : <SignupClosed />}
      </main>
      <SiteFooter />
    </>
  );
}
