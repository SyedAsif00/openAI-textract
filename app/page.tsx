"use client";
import { useState, useEffect } from "react";
import AuthButton from "./components/AuthButton";
import useAuth from "./hooks/useAuth";
import { useFirestore } from "./hooks/useFirestore";
import { extractTextFromFile } from "./services/aws/textract";
import Loader from "./components/Loader";

interface UploadedFile {
  fileName: string;
  extractedText: string;
}

export default function Home() {
  const { user } = useAuth();
  const {
    uploadFileMetadata,
    fetchUserFiles,
    storeChatHistory,
    listenToChatHistory,
  } = useFirestore();
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(
    null
  );
  const [isProcessing, setIsProcessing] = useState<boolean>(false); // Loader for file upload
  const [chatResponse, setChatResponse] = useState<string>(""); // For the current bot response stream
  const [userQuestion, setUserQuestion] = useState<string>(""); // The user's question
  const [chatHistory, setChatHistory] = useState<any[]>([]); // Stores both user and bot messages
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false); // Loader for chat history

  useEffect(() => {
    if (user) {
      loadUserFiles();
    }
  }, [user]);

  // Load user files and set the first file selected
  const loadUserFiles = async () => {
    if (user) {
      const files = await fetchUserFiles(user.uid);
      setUploadedFiles(files);
      if (files.length > 0) {
        setSelectedFileIndex(0); // Automatically select the first file
      }
    }
  };

  // Set up real-time chat listener for the selected file
  useEffect(() => {
    if (selectedFileIndex !== null && user) {
      setLoadingHistory(true); // Show loader while fetching chat history
      const selectedFile = uploadedFiles[selectedFileIndex];
      const unsubscribe = listenToChatHistory(
        user.uid,
        selectedFile.fileName,
        (chats) => {
          setChatHistory(chats); // Update chat history with both user and bot messages
          setLoadingHistory(false); // Hide loader once chat history is fetched
        }
      );

      return () => unsubscribe(); // Cleanup listener on component unmount or file change
    }
  }, [selectedFileIndex, uploadedFiles]);

  // Handle file upload and store extracted text
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setIsProcessing(true);
      try {
        const extractedText = await extractTextFromFile(file);
        await uploadFileMetadata(user.uid, file.name, extractedText); // Upload metadata
        setUploadedFiles((prevFiles) => [
          ...prevFiles,
          { fileName: file.name, extractedText },
        ]);
        if (uploadedFiles.length === 0) setSelectedFileIndex(0); // Select first file if it's the only file
        alert("File uploaded and extracted successfully!");
      } catch (error) {
        console.error("Error uploading file:", error);
        alert("Error uploading file");
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Handle chat submission and store both user and bot chat messages in Firestore
  const handleChatSubmit = async () => {
    if (userQuestion.trim() && selectedFileIndex !== null) {
      const selectedFile = uploadedFiles[selectedFileIndex];
      setIsProcessing(true); // Show loader while sending the question
      try {
        // Store the user's question in Firestore
        await storeChatHistory(
          user.uid,
          selectedFile.fileName,
          userQuestion,
          "user"
        );

        // Clear the input field after submission
        setUserQuestion("");

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            extractedText: selectedFile.extractedText,
            userQuestion,
          }),
        });

        if (!response.body) {
          throw new Error("Response body is not available.");
        }

        const reader = response.body.getReader(); // Start reading the stream
        let text = "";
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setChatResponse(text); // Update chat response in real-time
        }

        // Remove "response" key and display only the message
        const parsedResponse = JSON.parse(text);
        const botResponse = parsedResponse.response;

        // Store the bot's response in Firestore
        await storeChatHistory(
          user.uid,
          selectedFile.fileName,
          botResponse,
          "bot"
        );
      } catch (error) {
        console.error("Error with chat:", error);
      } finally {
        setIsProcessing(false); // Hide loader after processing
      }
    }
  };

  return (
    <div>
      <div className="auth-container">
        <AuthButton />
      </div>
      <div className="container">
        <div className="sidebar">
          <h2>Uploaded Files</h2>
          {isProcessing ? (
            <Loader />
          ) : (
            <>
              <ul className="file-list">
                {uploadedFiles.map((file, index) => (
                  <li key={file.fileName}>
                    <button
                      className={`file-item ${
                        index === selectedFileIndex ? "file-item-active" : ""
                      }`}
                      onClick={() => setSelectedFileIndex(index)}
                    >
                      {file.fileName}
                    </button>
                  </li>
                ))}
              </ul>
              <input
                type="file"
                onChange={handleFileChange}
                className="file-input"
              />
            </>
          )}
        </div>
        <div className="chatbot">
          <h2>Chatbot</h2>
          <div className="chatbox">
            {loadingHistory ? (
              <Loader /> // Show loader while fetching chat history
            ) : (
              <div className="chatbox-messages">
                {selectedFileIndex !== null ? (
                  <>
                    {chatHistory.map((chat, index) => (
                      <div
                        key={index}
                        className={`chat-message ${
                          chat.sender === "user"
                            ? "user-message"
                            : "bot-message"
                        }`}
                      >
                        <p>
                          <strong>
                            {chat.sender === "user" ? "You" : "Bot"}:
                          </strong>{" "}
                          {chat.message}
                        </p>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="empty-chatbox">
                    Please upload a document to start chatting.
                  </div>
                )}
              </div>
            )}
            <div className="chatbox-input">
              <input
                type="text"
                value={userQuestion}
                onChange={(e) => setUserQuestion(e.target.value)}
                placeholder="Ask a question..."
                disabled={selectedFileIndex === null}
              />
              <button
                onClick={handleChatSubmit}
                disabled={selectedFileIndex === null}
              >
                Ask GPT-4
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
