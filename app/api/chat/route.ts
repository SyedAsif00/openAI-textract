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

    // Modify the prompt to instruct GPT to provide the main answer first.
    const prompt = `
      Here is the text extracted from a document: "${extractedText}".
      The user has asked: "${userQuestion}".

      Please provide a clear and concise answer to the user's question first.
      After giving the main answer, provide additional context, suggestions, or remarks if necessary.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: prompt },
      ],
    });

    const fullResponse = completion.choices[0].message.content;

    // Optional: You can add logic here to split the response into "main answer" and "additional remarks"
    // For example, if OpenAI provides a response in two parts, you can split it:
    const [mainAnswer, ...additionalRemarks] = fullResponse.split("\n\n");
    const formattedResponse = ` ${mainAnswer}\n\nAdditional Context:\n${additionalRemarks.join(
      "\n\n"
    )}`;

    return NextResponse.json(
      { response: formattedResponse }, // return the formatted response
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
