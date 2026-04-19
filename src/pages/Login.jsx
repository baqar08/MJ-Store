import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import toast from 'react-hot-toast';

export default function Login() {
  const { dispatch } = useStore();
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isSignup && !form.name) {
      toast.error('Please enter your name', { style: { fontSize: '13px' } });
      return;
    }
    if (!form.email || !form.password) {
      toast.error('Please fill in all fields', { style: { fontSize: '13px' } });
      return;
    }

    setLoading(true);
    try {
      if (isSignup) {
        const { createUserWithEmailAndPassword } = await import('firebase/auth');
        const { doc, setDoc } = await import('firebase/firestore');
        const { auth, db } = await import('../firebase');
        
        const userCred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        const userData = {
          name: form.name,
          email: form.email,
          role: 'user',
          joinDate: new Date().toISOString()
        };
        await setDoc(doc(db, 'users', userCred.user.uid), userData);
        
        dispatch({ type: 'SET_USER', payload: { ...userData, id: userCred.user.uid } });
        toast.success('Welcome to MJ Store', { style: { fontSize: '13px' } });
        navigate('/');
      } else {
        const { signInWithEmailAndPassword } = await import('firebase/auth');
        const { doc, getDoc } = await import('firebase/firestore');
        const { auth, db } = await import('../firebase');

        const userCred = await signInWithEmailAndPassword(auth, form.email, form.password);
        const userDocSnap = await getDoc(doc(db, 'users', userCred.user.uid));
        
        let userData = { role: 'user', name: 'User' };
        if (userDocSnap.exists()) {
          userData = userDocSnap.data();
        }
        
        dispatch({ type: 'SET_USER', payload: { ...userData, id: userCred.user.uid } });
        
        const isAdmin = userData.role === 'admin';
        toast.success(isAdmin ? 'Welcome, Admin' : 'Welcome back', { style: { fontSize: '13px' } });
        navigate(isAdmin ? '/admin' : '/');
      }
    } catch (error) {
      let msg = 'Authentication failed';
      if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') msg = 'Invalid email or password';
      if (error.code === 'auth/email-already-in-use') msg = 'Email already in use';
      if (error.code === 'auth/weak-password') msg = 'Password should be at least 6 characters';
      
      toast.error(msg, { style: { fontSize: '13px' } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="pt-16">
      <div className="container-main py-16 md:py-24 max-w-sm mx-auto">
        <div className="text-center mb-10">
          <Link to="/" className="text-lg font-medium tracking-tight">MJ Store</Link>
          <h1 className="text-2xl font-light tracking-tight mt-4 mb-1">
            {isSignup ? 'Create Account' : 'Sign In'}
          </h1>
          <p className="text-sm text-neutral-400">
            {isSignup ? 'Join MJ Store today.' : 'Welcome back to MJ Store.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup && (
            <div>
              <label className="text-xs text-neutral-400 mb-1.5 block">Full Name</label>
              <input
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="input-field"
                placeholder="Your name"
                id="signup-name"
                disabled={loading}
              />
            </div>
          )}
          <div>
            <label className="text-xs text-neutral-400 mb-1.5 block">Email Address</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
              className="input-field"
              placeholder="you@example.com"
              id="login-email"
              disabled={loading}
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 mb-1.5 block">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
              className="input-field"
              placeholder="••••••••"
              id="login-password"
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full mt-2 disabled:opacity-50" id="login-submit">
            {loading ? 'Processing...' : (isSignup ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div className="text-center mt-8">
          <button
            onClick={() => setIsSignup(!isSignup)}
            className="text-xs text-neutral-400 hover:text-neutral-900 transition-base"
            id="toggle-auth-mode"
            disabled={loading}
          >
            {isSignup ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
          </button>
        </div>

        <p className="text-center text-[11px] text-neutral-300 mt-6">
          Admin: admin@mjstore.com (password: password123)
        </p>
      </div>
    </main>
  );
}
