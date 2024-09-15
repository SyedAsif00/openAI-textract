"use client";
import { useState, useEffect } from "react";
import { Upload, Button, message, Spin } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import AuthButton from "./components/AuthButton";
import useAuth from "./hooks/useAuth";
import { useFirestore } from "./hooks/useFirestore";
import { extractTextFromFile } from "./services/aws/textract";
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
  const [isUploading, setIsUploading] = useState<boolean>(false); // State for file upload loader
  const [isChatProcessing, setIsChatProcessing] = useState<boolean>(false); // State for GPT chat loader
  const [showAllFiles, setShowAllFiles] = useState<boolean>(false); // State for Show More/Show Less
  const [chatResponse, setChatResponse] = useState<string>("");
  const [userQuestion, setUserQuestion] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  useEffect(() => {
    if (user) {
      loadUserFiles();
    }
  }, [user]);

  const loadUserFiles = async () => {
    if (user) {
      const files = await fetchUserFiles(user.uid);
      setUploadedFiles(files);
      if (files.length > 0) {
        setSelectedFileIndex(0);
      }
    }
  };

  useEffect(() => {
    if (selectedFileIndex !== null && user) {
      setLoadingHistory(true);
      const selectedFile = uploadedFiles[selectedFileIndex];
      const unsubscribe = listenToChatHistory(
        user.uid,
        selectedFile.fileName,
        (chats) => {
          setChatHistory(chats);
          setLoadingHistory(false);
        }
      );

      return () => unsubscribe();
    }
  }, [selectedFileIndex, uploadedFiles]);

  const handleUpload = async (info: any) => {
    const file = info.file;
    if (file.status !== "uploading") {
      setIsUploading(true);
      try {
        const extractedText = await extractTextFromFile(file);
        await uploadFileMetadata(user.uid, file.name, extractedText);
        setUploadedFiles((prevFiles) => [
          ...prevFiles,
          { fileName: file.name, extractedText },
        ]);
        if (uploadedFiles.length === 0) setSelectedFileIndex(0);
        message.success(`${file.name} uploaded successfully.`);
      } catch (error) {
        console.error("Error uploading file:", error);
        message.error(`${file.name} failed to upload.`);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleChatSubmit = async () => {
    if (userQuestion.trim() && selectedFileIndex !== null) {
      const selectedFile = uploadedFiles[selectedFileIndex];
      setIsChatProcessing(true);
      try {
        await storeChatHistory(
          user.uid,
          selectedFile.fileName,
          userQuestion,
          "user"
        );

        setUserQuestion("");

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            extractedText: selectedFile.extractedText,
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
          setChatResponse(text);
        }

        const parsedResponse = JSON.parse(text);
        const botResponse = parsedResponse.response;

        await storeChatHistory(
          user.uid,
          selectedFile.fileName,
          botResponse,
          "bot"
        );
      } catch (error) {
        console.error("Error with chat:", error);
      } finally {
        setIsChatProcessing(false);
      }
    }
  };

  const toggleShowFiles = () => {
    setShowAllFiles(!showAllFiles);
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
              {uploadedFiles.length > 5 && (
                <span onClick={toggleShowFiles} className="toggle-files-text">
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
            </>
          )}
        </div>

        <div className="chatbot">
          <h2>Chatbot</h2>
          <div className="chatbox">
            {loadingHistory ? (
              <Loader />
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
              <Button
                type="primary"
                onClick={handleChatSubmit}
                disabled={selectedFileIndex === null}
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
