import {
  TextractClient,
  DetectDocumentTextCommand,
} from "@aws-sdk/client-textract";

// Initialize AWS Textract client
const client = new TextractClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY!,
  },
});

// Function to extract text from an image or PDF using AWS Textract
export const extractTextFromFile = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = async function () {
      try {
        const params = {
          Document: {
            Bytes: new Uint8Array(reader.result as ArrayBuffer),
          },
        };

        const command = new DetectDocumentTextCommand(params);
        const response = await client.send(command);

        // Extract and join the detected lines of text
        const extractedText =
          response.Blocks?.filter((block) => block.BlockType === "LINE")
            .map((block) => block.Text)
            .join("\n") || "";

        resolve(extractedText);
      } catch (error) {
        console.error("Error with Textract:", error);
        reject(error);
      }
    };

    reader.onerror = function (error) {
      reject("Error reading file: " + error);
    };
  });
};
