import { Layout } from "@/components/layout";

export default function ConfigGeneric({ title }: { title: string }) {
  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        </div>
        <div className="bg-card border rounded-xl p-8 flex items-center justify-center text-muted-foreground">
          {title} config will go here
        </div>
      </div>
    </Layout>
  );
}