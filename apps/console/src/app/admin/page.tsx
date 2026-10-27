import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AdminArea } from "@/components/admin/AdminArea";
import { messages } from "@/lib/messages";

export const metadata: Metadata = {
  title: messages.meta.adminTitle,
  // The maintainer's page: nothing for a search engine to list.
  robots: { index: false, follow: false },
};

/**
 * The platform admin (#30): every cafe, the releases, the audit log. Not
 * linked from anywhere; only an account with the `admin` claim sees more than
 * the sign-in form, and the rules are what refuse everyone else the data.
 */
export default function Admin() {
  return (
    <>
      <SiteHeader onHome={false} />
      <main id="main" className="bg-sunk">
        <AdminArea />
      </main>
      <SiteFooter />
    </>
  );
}
