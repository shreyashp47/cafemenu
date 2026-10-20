import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Closing } from "@/components/landing/Closing";
import { Cost } from "@/components/landing/Cost";
import { Faq } from "@/components/landing/Faq";
import { Features } from "@/components/landing/Features";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { TryIt } from "@/components/landing/TryIt";

/**
 * The landing page: what CafeMenu is, how an owner sets it up, what a cafe
 * gets, what it costs, how to try it, and the questions an owner asks before
 * handing over access to a Firebase project. Fully static: no data is read.
 */
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Features />
        <Cost />
        <TryIt />
        <Faq />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
}
