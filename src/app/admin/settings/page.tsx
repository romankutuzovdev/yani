export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Настройки</h1>
        <p className="mt-1 text-slate-500">Конфигурация через переменные окружения</p>
      </div>
      <section className="rounded-2xl border border-violet-100 bg-white p-5 text-sm text-slate-700 shadow-sm">
        <ul className="space-y-2">
          <li>
            Модель DeepSeek:{" "}
            <code>{process.env.NEXT_PUBLIC_DEEPSEEK_MODEL ?? "deepseek-chat"}</code>
          </li>
          <li>
            API-ключ серверный: <code>DEEPSEEK_API_KEY</code>
          </li>
          <li>
            Папка загрузок: <code>UPLOAD_DIR</code>
          </li>
          <li>TODO: UI планировщика Redis/BullMQ</li>
          <li>TODO: выбор vector memory (pgvector / Qdrant / Pinecone)</li>
        </ul>
      </section>
    </div>
  );
}
