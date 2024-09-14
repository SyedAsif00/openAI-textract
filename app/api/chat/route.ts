import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { extractedText, userQuestion } = await request.json();

    if (!extractedText || !userQuestion) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content: `Here is the text extracted from a document: "${extractedText}". The user has asked: "${userQuestion}"`,
        },
      ],
    });

    return NextResponse.json(
      { response: completion.choices[0].message.content },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("OpenAI API error:", error);
    return NextResponse.json(
      { error: "Failed to query OpenAI" },
      { status: 500 }
    );
  }
}
