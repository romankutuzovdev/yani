export const dynamic = "force-dynamic";

const CSV =
  "displayName,company,email,phone,telegram,notes\nИван Петров,ООО Пример,ivan@example.com,+375291112233,@ivan_example,Первый контакт\n";

export async function GET() {
  return new Response(CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="yani-crm-import.csv"',
    },
  });
}
