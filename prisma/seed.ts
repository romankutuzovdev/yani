import { Prisma, PrismaClient, type CharacterState } from "@prisma/client";
import bcrypt from "bcryptjs";
import { listTools, registerBuiltinTools } from "../src/tools";
import { registerMemoryTool } from "../src/memory";

const prisma = new PrismaClient();

const YANI_EMOTIONS: Array<{ state: CharacterState; file: string }> = [
  { state: "IDLE", file: "idle.jpg" },
  { state: "THINKING", file: "thinking.jpg" },
  { state: "WORKING", file: "working.jpg" },
  { state: "SUCCESS", file: "success.jpg" },
  { state: "ERROR", file: "error.jpg" },
  { state: "SPEAKING", file: "speaking.jpg" },
  { state: "WAITING", file: "waiting.jpg" },
  { state: "SAD", file: "sad.jpg" },
  { state: "ANGRY", file: "angry.jpg" },
];

async function main() {
  registerBuiltinTools();
  registerMemoryTool();

  const email = process.env.ADMIN_EMAIL ?? "admin@yani.local";
  const password = process.env.ADMIN_PASSWORD ?? "admin123456";
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN", name: "Admin" },
    create: {
      email,
      passwordHash,
      name: "Admin",
      role: "ADMIN",
    },
  });

  for (const tool of listTools()) {
    await prisma.toolRegistry.upsert({
      where: { name: tool.name },
      update: {
        description: tool.description,
        inputSchema: JSON.stringify(tool.inputSchema),
        enabled: true,
        builtIn: true,
      },
      create: {
        name: tool.name,
        description: tool.description,
        inputSchema: JSON.stringify(tool.inputSchema),
        enabled: true,
        builtIn: true,
      },
    });
  }

  const skills = [
    {
      name: "Customer Support",
      description: "Help users with product questions and troubleshooting.",
      systemPrompt: "Be empathetic, clear, and solution-oriented.",
      tools: ["memory_search", "datetime"],
      sortOrder: 0,
    },
    {
      name: "Web Research",
      description: "Research topics on the web and summarize findings.",
      systemPrompt: "Cite sources when available. Prefer factual summaries.",
      tools: ["web_search", "http_request"],
      sortOrder: 1,
    },
    {
      name: "Data Analysis",
      description: "Analyze numbers and perform calculations.",
      systemPrompt: "Show intermediate reasoning briefly and verify results.",
      tools: ["calculator"],
      sortOrder: 2,
    },
    {
      name: "Text Writing",
      description: "Write clear marketing and product copy.",
      systemPrompt: "Match the requested tone. Keep text concise.",
      tools: [],
      sortOrder: 3,
    },
  ];

  for (const skill of skills) {
    await prisma.skill.upsert({
      where: { name: skill.name },
      update: {
        description: skill.description,
        systemPrompt: skill.systemPrompt,
        tools: JSON.stringify(skill.tools),
        sortOrder: skill.sortOrder,
        enabled: true,
      },
      create: {
        name: skill.name,
        description: skill.description,
        systemPrompt: skill.systemPrompt,
        tools: JSON.stringify(skill.tools),
        sortOrder: skill.sortOrder,
      },
    });
  }

  let agent = await prisma.agent.findUnique({
    where: { slug: "alex" },
    include: { character: true },
  });

  let characterId = agent?.characterId ?? null;

  if (!characterId) {
    const character = await prisma.agentCharacter.create({
      data: {
        name: "Yani",
        description: "Blue blob hero with expressive emotions",
        defaultState: "IDLE",
      },
    });
    characterId = character.id;
  } else {
    await prisma.agentCharacter.update({
      where: { id: characterId },
      data: {
        name: "Yani",
        description: "Blue blob hero with expressive emotions",
        defaultState: "IDLE",
      },
    });
  }

  if (!agent) {
    agent = await prisma.agent.create({
      data: {
        name: "Alex",
        slug: "alex",
        description: "Demo agent with Yani character, skills and tools",
        logoUrl: "/brand/yani-logo.png",
        greeting: "Привет! Я Yani. Чем могу помочь?",
        personality: "friendly, curious, reliable",
        role: "General AI assistant",
        communicationStyle: "warm and clear",
        goals: "Help users complete tasks accurately",
        rules: "Be honest about uncertainty. Prefer tools for facts.",
        restrictions: "Do not invent credentials or private data.",
        model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
        temperature: 0.7,
        maxIterations: 8,
        ownerId: admin.id,
        characterId,
        status: "IDLE",
      },
      include: { character: true },
    });
  } else {
    agent = await prisma.agent.update({
      where: { id: agent.id },
      data: {
        ...(agent.characterId ? {} : { characterId }),
        logoUrl: agent.logoUrl || "/brand/yani-logo.png",
        greeting: agent.greeting || "Привет! Я Yani. Чем могу помочь?",
      },
      include: { character: true },
    });
  }

  for (const emotion of YANI_EMOTIONS) {
    const url = `/characters/yani/${emotion.file}`;
    await prisma.characterAsset.upsert({
      where: {
        characterId_state: {
          characterId: characterId!,
          state: emotion.state,
        },
      },
      update: {
        url,
        mimeType: "image/jpeg",
        filename: emotion.file,
        type: "IMAGE",
        sizeBytes: 0,
      },
      create: {
        characterId: characterId!,
        state: emotion.state,
        url,
        mimeType: "image/jpeg",
        filename: emotion.file,
        type: "IMAGE",
        sizeBytes: 0,
      },
    });
  }

  const allSkills = await prisma.skill.findMany({ orderBy: { sortOrder: "asc" } });
  for (const [i, skill] of allSkills.entries()) {
    await prisma.agentSkill.upsert({
      where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
      update: { enabled: true, visible: true, sortOrder: i },
      create: {
        agentId: agent.id,
        skillId: skill.id,
        enabled: true,
        visible: true,
        sortOrder: i,
      },
    });
  }

  const allTools = await prisma.toolRegistry.findMany();
  for (const tool of allTools) {
    await prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId: agent.id, toolId: tool.id } },
      update: { enabled: true },
      create: { agentId: agent.id, toolId: tool.id, enabled: true },
    });
  }

  await prisma.widget.upsert({
    where: { id: "seed-widget-alex" },
    update: { enabled: true },
    create: {
      id: "seed-widget-alex",
      agentId: agent.id,
      name: "Alex Widget",
      enabled: true,
      config: JSON.stringify({ greeting: "Привет! Я Alex. Чем могу помочь?" }),
    },
  });

  const demoForm = await prisma.form.upsert({
    where: { slug: "zayavka" },
    update: {
      title: "Заявка",
      description: "Оставьте контакты — мы свяжемся с вами.",
      enabled: true,
      successText: "Спасибо! Заявка принята.",
      ownerId: admin.id,
    },
    create: {
      title: "Заявка",
      slug: "zayavka",
      description: "Оставьте контакты — мы свяжемся с вами.",
      enabled: true,
      successText: "Спасибо! Заявка принята.",
      ownerId: admin.id,
    },
  });

  await prisma.formField.deleteMany({ where: { formId: demoForm.id } });
  const demoFields = [
    { label: "Имя", name: "name", type: "TEXT" as const, required: true, placeholder: "Как к вам обращаться", sortOrder: 0, options: "[]" },
    { label: "Телефон", name: "phone", type: "PHONE" as const, required: true, placeholder: "+7 …", sortOrder: 1, options: "[]" },
    { label: "Email", name: "email", type: "EMAIL" as const, required: false, placeholder: "you@example.com", sortOrder: 2, options: "[]" },
    {
      label: "Тема",
      name: "topic",
      type: "SELECT" as const,
      required: true,
      placeholder: "",
      sortOrder: 3,
      options: JSON.stringify(["Консультация", "Ипотека", "Страховка", "Другое"]),
    },
    { label: "Комментарий", name: "comment", type: "TEXTAREA" as const, required: false, placeholder: "Кратко опишите запрос", sortOrder: 4, options: "[]" },
  ];
  for (const field of demoFields) {
    await prisma.formField.create({
      data: { formId: demoForm.id, ...field },
    });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const playbook = `Ты консультант сервиса Yani.

Если пользователь хочет оставить заявку, записаться или просит форму — предложи форму по ссылке:
${appUrl}/f/zayavka
Название: «Заявка».

Используй инструмент offer_form с этим URL. Не выдумывай другие ссылки.`;

  await prisma.agent.update({
    where: { id: agent.id },
    data: { additionalInstructions: playbook },
  });

  console.log("Seed complete");
  console.log(`Admin: ${email} / ${password}`);
  console.log(`Demo agent slug: alex (id: ${agent.id})`);
  console.log(`Demo form: ${appUrl}/f/zayavka`);
  console.log(`Character emotions: ${YANI_EMOTIONS.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
