import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase/firebaseConfig";

export const useFirestore = () => {
  // Function to upload extracted text and file metadata to Firestore
  const uploadFileMetadata = async (userId, fileName, extractedText) => {
    try {
      const fileDoc = doc(db, `users/${userId}/files`, fileName);
      await setDoc(fileDoc, {
        extractedText,
        fileName,
        uploadTime: new Date(),
      });
    } catch (error) {
      console.error("Error uploading file metadata:", error);
    }
  };

  // Function to fetch all files for a specific user
  const fetchUserFiles = async (userId) => {
    try {
      const q = query(collection(db, `users/${userId}/files`));
      const querySnapshot = await getDocs(q);
      let files = [];
      querySnapshot.forEach((doc) => {
        files.push({ ...doc.data(), id: doc.id });
      });
      return files;
    } catch (error) {
      console.error("Error fetching user files:", error);
      return [];
    }
  };

  // Real-time chat listener for a specific file
  const listenToChatHistory = (userId, fileName, callback) => {
    const q = query(
      collection(db, `users/${userId}/chats`),
      where("fileName", "==", fileName),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      let chats = [];
      querySnapshot.forEach((doc) => {
        chats.push({ ...doc.data(), id: doc.id });
      });
      callback(chats); // Pass the chats to the callback function
    });

    return unsubscribe; // To stop listening when the component is unmounted
  };

  // Function to store chat history for a user
  const storeChatHistory = async (userId, fileName, message, sender) => {
    try {
      const chatDoc = doc(
        db,
        `users/${userId}/chats`,
        `${fileName}_${new Date().getTime()}`
      );
      await setDoc(chatDoc, {
        fileName,
        message,
        sender,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error("Error storing chat:", error);
    }
  };

  return {
    uploadFileMetadata,
    fetchUserFiles,
    storeChatHistory,
    listenToChatHistory,
  };
};
