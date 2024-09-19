import { NextResponse } from "next/server";
import { OpenAIStream, OpenAIStreamPayload } from "../../utils/OpenAIStream";

export const runtime = "edge";

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

    const payload: OpenAIStreamPayload = {
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      top_p: 1,
      max_tokens: 1000,
      stream: true,
      n: 1,
    };

    const stream = await OpenAIStream(payload);

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
      },
    });
  } catch (error) {
    console.error("OpenAI API error:", error);
    return NextResponse.json(
      { error: "Failed to query OpenAI" },
      { status: 500 }
    );
  }
}
