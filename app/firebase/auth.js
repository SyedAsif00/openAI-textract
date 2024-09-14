// /app/firebase/auth.js
import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { auth } from "./firebaseConfig";

// Function to sign in with Google
export const googleSignIn = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Error during Google Sign-In:", error);
  }
};

// Function to sign out
export const googleSignOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error during Google Sign-Out:", error);
  }
};
