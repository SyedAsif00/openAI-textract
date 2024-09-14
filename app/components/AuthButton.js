import React from "react";
import { googleSignIn, googleSignOut } from "../firebase/auth";
import useAuth from "../hooks/useAuth";

const AuthButton = () => {
  const { user } = useAuth();

  return (
    <div className="auth-container">
      {user ? (
        <div className="user-info">
          <img src={user.photoURL} alt="User Avatar" className="user-avatar" />
          <button className="sign-out-button" onClick={googleSignOut}>
            Sign Out
          </button>
        </div>
      ) : (
        <button className="sign-in-button" onClick={googleSignIn}>
          Sign In with Google
        </button>
      )}
    </div>
  );
};

export default AuthButton;
