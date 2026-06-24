import React, { useState } from 'react';
import { Mail, Lock, LogIn, ShieldCheck, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { auth, googleProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '../services/firebase';
import './AuthModal.css';

const GoogleIcon = () => (
  <svg className="auth-google-icon" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const AuthModal = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSuccess = async (userCredential) => {
    const user = userCredential.user;
    const token = await user.getIdToken();
    localStorage.setItem('firebase_id_token', token);
    localStorage.setItem('firebase_uid', user.uid);
    localStorage.setItem('firebase_email', user.email);

    if (onLoginSuccess) {
      onLoginSuccess({
        uid: user.uid,
        email: user.email,
        token: token
      });
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let cred;
      if (isLogin) {
        cred = await signInWithEmailAndPassword(auth, email, password);
      } else {
        cred = await createUserWithEmailAndPassword(auth, email, password);
      }
      await handleSuccess(cred);
    } catch (err) {
      let msg = err.message;
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        msg = 'Invalid email or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = 'Email already exists. Please sign in instead.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setOauthLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await handleSuccess(cred);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google Sign-In failed.');
      }
    } finally {
      setOauthLoading(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-modal-container">
        {/* Header Logo */}
        <div className="auth-header-logo">
          <div className="auth-logo-box">
            <ShieldCheck size={24} color="#38bdf8" />
          </div>
          <h1>HL-MCK</h1>
        </div>

        {/* Title */}
        <div className="auth-title">
          <h2>{isLogin ? 'Welcome back' : 'Create an account'}</h2>
          <p>{isLogin ? 'Sign in to your account' : 'Sign up to start managing profiles'}</p>
        </div>

        {/* Google Auth Button */}
        <button 
          className="auth-google-btn" 
          onClick={handleGoogleAuth} 
          disabled={oauthLoading || loading}
        >
          {oauthLoading ? <div className="auth-spinner mini"></div> : <GoogleIcon />}
          <span>{isLogin ? 'Sign in with Google' : 'Sign up with Google'}</span>
        </button>

        {/* OR Divider */}
        <div className="auth-divider">
          <div className="auth-divider-line"></div>
          <span className="auth-divider-text">OR</span>
          <div className="auth-divider-line"></div>
        </div>

        {/* Error message */}
        {error && (
          <div className="auth-error-box">
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleAuth} className="auth-form-wrapper">
          {/* Email Field */}
          <div className="auth-field">
            <label className="auth-label">EMAIL</label>
            <div className="auth-input-group">
              <Mail className="auth-input-icon" size={18} />
              <input 
                type="email" 
                className="auth-input"
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                placeholder="you@example.com"
                required 
                disabled={loading || oauthLoading}
              />
            </div>
          </div>
          
          {/* Password Field */}
          <div className="auth-field">
            <div className="auth-label-row">
              <label className="auth-label">PASSWORD</label>
              {isLogin && <button type="button" className="auth-forgot-link">Forgot password?</button>}
            </div>
            <div className="auth-input-group">
              <Lock className="auth-input-icon" size={18} />
              <input 
                type={showPw ? "text" : "password"} 
                className="auth-input"
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="••••••••"
                required 
                minLength={6}
                disabled={loading || oauthLoading}
              />
              <button 
                type="button" 
                className="auth-pw-toggle" 
                onClick={() => setShowPw(!showPw)}
                tabIndex="-1"
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button type="submit" disabled={loading || oauthLoading} className="auth-submit-btn">
            {loading ? (
              <div className="auth-spinner"></div>
            ) : (
              <>
                <LogIn size={20} />
                <span>{isLogin ? 'Sign In' : 'Sign Up'}</span>
              </>
            )}
          </button>
        </form>

        {/* Switch Login / Register */}
        <div className="auth-footer-text">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button" 
            className="auth-toggle-link"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
          >
            {isLogin ? 'Register now' : 'Sign in now'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
