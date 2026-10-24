import type { Metadata } from "next";
import { SignupClosed } from "@/components/SignupClosed";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { CafeArea } from "@/components/owner/CafeArea";
import { signupOpen } from "@/lib/config";
import { messages } from "@/lib/messages";

export const metadata: Metadata = { title: messages.meta.cafeTitle };

/**
 * The owner area (#29): a signed-in owner's cafe, its updates, branding and
 * access. Closed with sign-up against the real platform
 * (src/lib/config.ts), since there are no owners until it opens.
 */
export default function Cafe() {
  return (
    <>
      <SiteHeader onHome={false} />
      <main id="main" className="bg-sunk">
        {signupOpen ? <CafeArea /> : <SignupClosed />}
      </main>
      <SiteFooter />
    </>
  );
}
