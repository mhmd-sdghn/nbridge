import Link from "next/link";
import { HomePanel } from "@/components/HomePanel";

export default function HomePage() {
  return (
    <>
      <HomePanel />
      <nav>
        <Link href="/details">Go to a details page →</Link>
        <Link href="/success">Go to the success screen →</Link>
      </nav>
    </>
  );
}
