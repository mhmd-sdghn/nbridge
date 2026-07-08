import Link from "next/link";
import { BackButton } from "@/components/BackButton";

export default function DetailsPage() {
  return (
    <section className="card">
      <h2>Details</h2>
      <p>
        You navigated here from the home page, so there is in-app history:{" "}
        <code>canRouterBack()</code> is now <code>true</code> and the button
        below does <code>router.back()</code> instead of shutting down.
      </p>
      <BackButton />
      <nav>
        <Link href="/">Home</Link>
      </nav>
    </section>
  );
}
