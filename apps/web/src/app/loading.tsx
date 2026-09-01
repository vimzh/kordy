import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingPage() {
  return (
    <main className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </main>
  );
}
