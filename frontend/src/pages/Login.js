import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Loader2, Handshake } from 'lucide-react';
import useAuthStore from '../store/authStore';
import { gpLanding } from './gp/GpAuth';

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please enter email and password');
      return;
    }

    setIsLoading(true);
    try {
      const user = await login(email.trim().toLowerCase(), password);
      // Route based on role
      if (user.role === 'admin') {
        navigate('/admin');
      } else if (user.role === 'manager') {
        navigate('/manager');
      } else if (['growth_partner', 'telecaller', 'sales_agent', 'partner', 'team_leader'].includes(user.role)) {
        navigate(await gpLanding());
      } else {
        navigate('/agent');
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6" data-testid="login-page">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-green-600">BANKEZEE</h1>
          <p className="text-2xl text-gray-600 -mt-1">Connect</p>
          <p className="text-sm text-gray-500 mt-2">Staff sign in</p>
        </div>

        {/* Form */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome Back</h2>
          <p className="text-gray-500 mb-8">Sign in to continue</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm" data-testid="login-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full px-4 py-3 pl-10 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                  autoComplete="email"
                  data-testid="email-input"
                />
              </div>
            </div>

            <div className="mb-6">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full px-4 py-3 pl-10 pr-12 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200"
                  autoComplete="current-password"
                  data-testid="password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-primary py-3.5 flex items-center justify-center gap-2"
              data-testid="login-submit-btn"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="flex items-center gap-3 my-6 text-xs text-gray-400"><span className="flex-1 h-px bg-gray-200" />Growth Partner?<span className="flex-1 h-px bg-gray-200" /></div>
          <Link to="/gp/login" className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg border-2 border-green-600 text-green-700 font-semibold hover:bg-green-50 transition-colors" data-testid="gp-signin-link">
            <Handshake size={18} />Sign in as Growth Partner
          </Link>
          <p className="text-center mt-5 text-gray-500">
            New Growth Partner?{' '}
            <Link to="/gp/signup" className="text-green-600 font-semibold hover:underline" data-testid="register-link">
              Become a Growth Partner
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
