import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export default async function DocPreviewPage({ params }: Params) {
  const { id } = await params;
  const doc = await prisma.agentDoc.findUnique({
    where: { id },
    include: { agent: { select: { enabled: true } } },
  });
  if (!doc || !doc.agent.enabled) notFound();

  const text = doc.text.trim();
  const isPdf = doc.mimeType === "application/pdf" || doc.url.toLowerCase().endsWith(".pdf");

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <article className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>
        {text ? (
          <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{text}</p>
        ) : isPdf && doc.url ? (
          <iframe
            title={doc.title}
            src={doc.url}
            className="mt-6 h-[min(80vh,900px)] w-full rounded-xl border border-slate-200"
          />
        ) : doc.url ? (
          <p className="mt-6 text-sm">
            <a href={doc.url} className="text-violet-700 underline" target="_blank" rel="noreferrer">
              Открыть файл
            </a>
          </p>
        ) : (
          <p className="mt-6 text-sm text-slate-500">В файле нет текста для предпросмотра.</p>
        )}
      </article>
    </main>
  );
}
