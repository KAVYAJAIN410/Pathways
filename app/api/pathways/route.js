import { NextResponse } from "next/server";
import pkg from "pg";
import OpenAI from "openai";

const { Pool } = pkg;

// Neon DB pool (safe for serverless)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function randomLabel() {
  return Math.random() < 0.5 ? "Consistent" : "Contradictory";
}


// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---------- LLM MATCH ----------
async function pickBestBackstory(content, backstories) {
  const formatted = backstories
    .map(b => `- (${b.label}) ${b.backstory}`)
    .join("\n");

  const prompt = `
You are checking narrative consistency.

Given story:
"${content}"

Reference backstories:
${formatted}

Task:
- Decide which reference backstory best matches the given story.
- Output ONLY ONE WORD:
  - "Consistent"
  - "Contradictory"

If none clearly match, output "NONE".
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0
  });

  return response.choices[0].message.content.trim();
}


// ---------- POST HANDLER ----------
export async function POST(req) {
  const body = await req.json();
  const { book_name, items } = body;

  if (!book_name || !Array.isArray(items)) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  const results = [];

  try {
    for (const item of items) {
      const { id, character, content } = item;

      const { rows } = await client.query(
        `
        SELECT label, backstory
        FROM backstories
        WHERE book_name = $1 AND character = $2
        `,
        [book_name, character]
      );

      let label = "Unknown";

     if (rows.length > 0) {
  const picked = await pickBestBackstory(content, rows);

  if (picked === "Consistent" || picked === "Contradictory") {
    label = picked;
  } else {
    // NONE or garbage → random fallback
    label = randomLabel();
  }
}
else {
  // No backstories at all → random fallback
  label = randomLabel();
}


      const question =
        `tell why the backstory: ${content}; for ` +
        `given character: ${character} is ${label} with the narrative`;

      results.push({ id, question });
    }

    return NextResponse.json({
      book_name,
      queries: results
    });

  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
