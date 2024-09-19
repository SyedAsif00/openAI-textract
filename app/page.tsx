"use client";
import React, { useState, useEffect, useRef } from "react";
import { Upload, Button, message, Spin, Card, Input } from "antd";
import { UploadOutlined, LoadingOutlined } from "@ant-design/icons";
import AuthButton from "./components/AuthButton";
import useAuth from "./hooks/useAuth";
import { useFirestore } from "./hooks/useFirestore";
import { extractTextFromFile } from "./services/aws/textract";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import "antd/dist/reset.css";

export default function Home() {
  const { user } = useAuth();
  const {
    uploadFileMetadata,
    fetchUserFiles,
    storeChatHistory,
    listenToChatHistory,
  } = useFirestore();
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isChatProcessing, setIsChatProcessing] = useState(false);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [userQuestion, setUserQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [queryAllFiles, setQueryAllFiles] = useState(false);

  // New state for the bot's streaming response
  const [botStreamingResponse, setBotStreamingResponse] = useState("");

  // Reference to chat messages div
  const messagesEndRef = useRef(null);

  // Scroll to bottom when new message is added
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, botStreamingResponse]);

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

  const handleUpload = async (info) => {
    const file = info.file;
    const fileType = file.type;

    if (file.status !== "uploading") {
      setIsUploading(true);
      setUploadProgress(0);

      let extractedText = "";
      try {
        // Simulate progress updates
        setUploadProgress(10);

        if (
          fileType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          // Handle DOCX
          const arrayBuffer = await file.arrayBuffer();
          setUploadProgress(30);
          const result = await mammoth.extractRawText({ arrayBuffer });
          setUploadProgress(60);
          extractedText = result.value;
        } else if (
          fileType ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ) {
          // Handle XLSX
          const data = new Uint8Array(await file.arrayBuffer());
          setUploadProgress(30);
          const workbook = XLSX.read(data, { type: "array" });
          setUploadProgress(60);
          extractedText = workbook.SheetNames.map((sheetName) => {
            const worksheet = workbook.Sheets[sheetName];
            return XLSX.utils.sheet_to_csv(worksheet);
          }).join("\n");
        } else if (fileType === "text/csv") {
          // Handle CSV
          setUploadProgress(30);
          extractedText = await new Promise((resolve, reject) => {
            Papa.parse(file, {
              complete: (result) => {
                setUploadProgress(60);
                resolve(result.data.join("\n"));
              },
              error: (error) => reject(error),
            });
          });
        } else {
          // Handle PDFs & Images with AWS Textract
          setUploadProgress(30);
          extractedText = await extractTextFromFile(file);
          setUploadProgress(60);
        }

        // Upload extracted text to Firestore
        setUploadProgress(80);
        await uploadFileMetadata(user.uid, file.name, extractedText);
        setUploadProgress(100);

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
        setUploadProgress(0);
      }
    }
  };

  // Ensure that pressing Enter triggers message submission
  const handleKeyPress = (e) => {
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

        // Initialize streaming response
        setBotStreamingResponse("");

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
        const decoder = new TextDecoder();
        let done = false;
        let botResponse = "";

        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          const chunkValue = decoder.decode(value);
          if (chunkValue) {
            botResponse += chunkValue;
            setBotStreamingResponse(botResponse);
          }
        }

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
      } catch (error) {
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
        setBotStreamingResponse("");
      }
    }
  };

  return (
    <div>
      <div className="auth-container">
        <AuthButton />
      </div>
      <div className="main-container">
        <div className="sidebar-card">
          <Card className="sidebar-inner-card">
            <div className="sidebar">
              <h2>Uploaded Files</h2>

              {/* Sidebar content */}
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
                  <button
                    className="toggle-files-btn"
                    onClick={() => setShowAllFiles(!showAllFiles)}
                  >
                    {showAllFiles ? "Show Less" : "Show More"}
                  </button>
                )}

                {uploadedFiles.length > 1 && (
                  <button
                    className={`file-item query-all-button ${
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

                <Upload.Dragger
                  name="file"
                  multiple={false}
                  customRequest={handleUpload}
                  className="file-uploader"
                  showUploadList={false}
                  style={{ marginTop: "20px" }}
                  disabled={isUploading}
                >
                  <p className="ant-upload-drag-icon">
                    <UploadOutlined />
                  </p>
                  <p className="ant-upload-text">
                    Click or drag file to this area to upload
                  </p>
                </Upload.Dragger>
              </>

              {isUploading && (
                <div className="uploading-overlay">
                  <div className="upload-progress">
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar"
                        style={{ width: `${uploadProgress}%` }}
                      >
                        {uploadProgress}%
                      </div>
                    </div>
                    <p>Uploading...</p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="chatbot-card">
          <Card className="chatbot-inner-card">
            <div className="chatbot">
              <h2>Chatbot</h2>
              <div className="chatbox">
                <div className="chatbox-messages">
                  {loadingHistory ? (
                    <div className="chat-loader">
                      <Spin size="large" />
                    </div>
                  ) : (
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
                          <p>{chat.message}</p>
                        </div>
                      ))}
                      {/* Display streaming response if it's being generated */}
                      {isChatProcessing && botStreamingResponse && (
                        <div className="chat-message bot-message">
                          <p>{botStreamingResponse}</p>
                        </div>
                      )}
                    </>
                  )}
                  {/* Dummy div to keep scroll at bottom */}
                  <div ref={messagesEndRef} />
                </div>
                <div className="chatbox-input">
                  <Input
                    type="text"
                    value={userQuestion}
                    onChange={(e) => setUserQuestion(e.target.value)}
                    placeholder="Ask a question..."
                    disabled={isChatProcessing}
                    onKeyPress={handleKeyPress} // Trigger on Enter key
                    className="chat-input"
                  />
                  <Button
                    type="primary"
                    onClick={handleChatSubmit}
                    disabled={isChatProcessing}
                    className="chat-submit-button"
                  >
                    {isChatProcessing ? (
                      <Spin indicator={<LoadingOutlined />} />
                    ) : (
                      "Send"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
