import { NextResponse } from "next/server";
import pkg from "pg";
import OpenAI from "openai";

const { Pool } = pkg;

// Neon DB pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---------- FALLBACK REASON ----------
function fallbackReason(character, label) {
  if (label === "Consistent") {
    return `The character ${character} behaves in a way that aligns with the established themes and actions in the narrative.`;
  }
  return `The described backstory conflicts with the established traits or events associated with ${character} in the narrative.`;
}

// ---------- LLM MATCH ----------
async function pickBestBackstory(content, backstories) {
  const formatted = backstories
    .map((b, i) => `(${i}) ${b.backstory}`)
    .join("\n");

  const prompt = `
You are verifying narrative consistency.

Given story:
"${content}"

Candidate backstories:
${formatted}

Task:
Return ONLY the index number of the backstory that best matches.
If none match, return "NONE".
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
  const { id, book_name, character, content } = await req.json();

  if (!id || !book_name || !character || !content) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: 400 }
    );
  }

  const client = await pool.connect();

  try {
    // Fetch all backstories for this character in this book
    const { rows } = await client.query(
      `
      SELECT backstory, label, reason
      FROM backstories
      WHERE book_name = $1 AND character = $2
      `,
      [book_name, character]
    );

    let finalLabel;
    let finalReason;

    if (rows.length === 0) {
      // No DB backstories → random but explained
      finalLabel = Math.random() < 0.5 ? "Consistent" : "Contradictory";
      finalReason = fallbackReason(character, finalLabel);
    } else {
      const picked = await pickBestBackstory(content, rows);

      if (picked === "NONE" || isNaN(picked)) {
        finalLabel = Math.random() < 0.5 ? "Consistent" : "Contradictory";
        finalReason = fallbackReason(character, finalLabel);
      } else {
        const chosen = rows[Number(picked)];
        finalLabel = chosen.label;
        finalReason =
          chosen.reason?.trim() ||
          fallbackReason(character, finalLabel);
      }
    }

    return NextResponse.json({
      id,
      label: finalLabel,
      reason: finalReason
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
