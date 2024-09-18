"use client";
import React, { useState, useEffect } from "react";
import { Upload, Button, message, Spin } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import AuthButton from "./components/AuthButton";
import useAuth from "./hooks/useAuth";
import { useFirestore } from "./hooks/useFirestore";
import { extractTextFromFile } from "./services/aws/textract";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import Loader from "./components/Loader";
import "antd/dist/reset.css";

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
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isChatProcessing, setIsChatProcessing] = useState<boolean>(false);
  const [showAllFiles, setShowAllFiles] = useState<boolean>(false);
  const [userQuestion, setUserQuestion] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [queryAllFiles, setQueryAllFiles] = useState<boolean>(false); // Default is false

  // Load the user's uploaded files when component mounts
  useEffect(() => {
    if (user) {
      loadUserFiles();
    }
  }, [user]);

  const loadUserFiles = async () => {
    if (user) {
      const files = await fetchUserFiles(user.uid);
      setUploadedFiles(files);
      if (files.length > 0 && selectedFileIndex === null && !queryAllFiles) {
        setSelectedFileIndex(0); // Default to first file
      }
    }
  };

  // Load chat history when a specific file is selected or when querying all files
  useEffect(() => {
    if (user && (selectedFileIndex !== null || queryAllFiles)) {
      setLoadingHistory(true);
      const fileName = queryAllFiles
        ? "all-files"
        : uploadedFiles[selectedFileIndex]?.fileName;
      const unsubscribe = listenToChatHistory(user.uid, fileName, (chats) => {
        setChatHistory(chats);
        setLoadingHistory(false);
      });
      return () => unsubscribe();
    } else {
      setChatHistory([]); // Clear chat history when no file is selected
    }
  }, [selectedFileIndex, uploadedFiles, queryAllFiles]);

  const handleUpload = async (info: any) => {
    const file = info.file;
    const fileType = file.type;

    if (file.status !== "uploading") {
      setIsUploading(true);

      let extractedText = "";
      try {
        if (
          fileType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          // Handle DOCX
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          extractedText = result.value;
        } else if (
          fileType ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ) {
          // Handle XLSX
          const data = new Uint8Array(await file.arrayBuffer());
          const workbook = XLSX.read(data, { type: "array" });
          extractedText = workbook.SheetNames.map((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            return XLSX.utils.sheet_to_csv(worksheet);
          }).join("\n");
        } else if (fileType === "text/csv") {
          // Handle CSV
          extractedText = await new Promise((resolve, reject) => {
            Papa.parse(file, {
              complete: (result) => resolve(result.data.join("\n")),
              error: (error) => reject(error),
            });
          });
        } else {
          // Handle PDFs & Images with AWS Textract
          extractedText = await extractTextFromFile(file);
        }

        // Upload extracted text to Firestore
        await uploadFileMetadata(user.uid, file.name, extractedText);

        setUploadedFiles((prevFiles) => [
          ...prevFiles,
          { fileName: file.name, extractedText },
        ]);
        if (
          uploadedFiles.length === 0 &&
          selectedFileIndex === null &&
          !queryAllFiles
        ) {
          setSelectedFileIndex(0);
        }
        message.success(`${file.name} uploaded successfully.`);
      } catch (error) {
        console.error("Error uploading file:", error);
        message.error(`${file.name} failed to upload.`);
      } finally {
        setIsUploading(false);
      }
    }
  };

  // Ensure that pressing Enter triggers message submission
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isChatProcessing) {
      handleChatSubmit();
    }
  };

  // Submitting a chat message
  const handleChatSubmit = async () => {
    if (!uploadedFiles.length) {
      message.error("Please upload at least one file to start chatting.");
      return;
    }
    if (userQuestion.trim()) {
      setIsChatProcessing(true);
      let extractedText = "";

      try {
        // If querying across all files
        if (queryAllFiles) {
          extractedText = uploadedFiles
            .map((file) => file.extractedText)
            .join("\n");
        } else if (selectedFileIndex !== null) {
          const selectedFile = uploadedFiles[selectedFileIndex];
          extractedText = selectedFile.extractedText;
        } else {
          // No file selected and not querying all files
          throw new Error("No file selected.");
        }

        // Append user question to chat history immediately
        const userChat = {
          message: userQuestion,
          sender: "user",
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, userChat]);

        // Store user's message in Firestore
        await storeChatHistory(
          user.uid,
          queryAllFiles
            ? "all-files"
            : uploadedFiles[selectedFileIndex].fileName,
          userQuestion,
          "user"
        );

        // Send the question to OpenAI
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            extractedText,
            userQuestion,
          }),
        });

        if (!response.body) throw new Error("Response body is not available.");

        const reader = response.body.getReader();
        let text = "";
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }

        const parsedResponse = JSON.parse(text);
        const botResponse = parsedResponse.response;

        // Append bot's response to chat history
        const botChat = {
          message: botResponse,
          sender: "bot",
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, botChat]);

        // Store bot's response in Firestore
        await storeChatHistory(
          user.uid,
          queryAllFiles
            ? "all-files"
            : uploadedFiles[selectedFileIndex].fileName,
          botResponse,
          "bot"
        );
      } catch (error: any) {
        console.error("Error with chat submission:", error);
        setChatHistory((prev) => [
          ...prev,
          {
            message: "Error: " + error.message,
            sender: "bot",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsChatProcessing(false);
        setUserQuestion(""); // Clear input after sending
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
          {isUploading ? (
            <Loader />
          ) : (
            <>
              <ul className="file-list">
                {uploadedFiles
                  .slice(0, showAllFiles ? uploadedFiles.length : 5)
                  .map((file, index) => (
                    <li key={`${file.fileName}-${index}`}>
                      <button
                        className={`file-item ${
                          index === selectedFileIndex && !queryAllFiles
                            ? "file-item-active"
                            : ""
                        }`}
                        onClick={() => {
                          setSelectedFileIndex(index);
                          setQueryAllFiles(false); // Query specific file
                        }}
                      >
                        {file.fileName}
                      </button>
                    </li>
                  ))}
              </ul>
              {uploadedFiles.length > 5 && (
                <span onClick={() => setShowAllFiles(!showAllFiles)}>
                  {showAllFiles ? "Show Less" : "Show More"}
                </span>
              )}

              <Upload.Dragger
                name="file"
                multiple={false}
                customRequest={handleUpload}
                className="file-uploader"
                showUploadList={false}
              >
                <p className="ant-upload-drag-icon">
                  <UploadOutlined />
                </p>
                <p className="ant-upload-text">
                  Click or drag file to this area to upload
                </p>
              </Upload.Dragger>

              {uploadedFiles.length > 1 && (
                <button
                  className={`file-item ${
                    queryAllFiles ? "file-item-active" : ""
                  }`}
                  onClick={() => {
                    setQueryAllFiles(true); // Enable query across all files
                    setSelectedFileIndex(null); // Unselect any specific file
                  }}
                  style={{ marginTop: "20px" }}
                >
                  Query Across All Files
                </button>
              )}
            </>
          )}
        </div>

        <div className="chatbot">
          <h2>Chatbot</h2>
          <div className="chatbox">
            <div className="chatbox-messages">
              {loadingHistory ? (
                <Loader />
              ) : chatHistory.length > 0 ? (
                chatHistory.map((chat, index) => (
                  <div
                    key={index}
                    className={`chat-message ${
                      chat.sender === "user" ? "user-message" : "bot-message"
                    }`}
                  >
                    <p>
                      <strong>{chat.sender === "user" ? "You" : "Bot"}:</strong>{" "}
                      {chat.message}
                    </p>
                  </div>
                ))
              ) : (
                <p>No chat history available.</p>
              )}
            </div>
            <div className="chatbox-input">
              <input
                type="text"
                value={userQuestion}
                onChange={(e) => setUserQuestion(e.target.value)}
                placeholder="Ask a question..."
                disabled={isChatProcessing}
                onKeyPress={handleKeyPress} // Trigger on Enter key
              />
              <Button
                type="primary"
                onClick={handleChatSubmit}
                disabled={isChatProcessing}
                style={{ marginLeft: "10px" }}
              >
                {isChatProcessing ? <Spin /> : "Ask GPT-4"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
