import Link from "next/link";
import { SuccessPanel } from "@/components/SuccessPanel";

export default function SuccessPage() {
  return (
    <>
      <SuccessPanel />
      <nav>
        <Link href="/">Home</Link>
      </nav>
    </>
  );
}
