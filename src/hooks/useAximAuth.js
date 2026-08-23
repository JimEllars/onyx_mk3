import { useState, useEffect, useCallback } from 'react';

// Decodes the JWT without verifying signature (for client-side reading)
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        if (!base64Url) return null;
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

const AUTHORIZED_USERS = ['jamesellars@jkrenewables.com', 'admin@axim.us.com'];

export function useAximAuth() {
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  const validateToken = (jwtToken) => {
    if (!jwtToken) return false;

    // In dev/mock scenarios if it's not a real JWT but we want to allow it
    if (jwtToken === 'dev-token') return true;

    const payload = parseJwt(jwtToken);

    if (payload && payload.email) {
      if (AUTHORIZED_USERS.includes(payload.email)) {
        return true;
      } else {
        setAuthError('User not in authorized whitelist.');
        return false;
      }
    }

    // If it's not a valid JWT or doesn't contain email, reject (except if it's some mocked legacy token)
    // Actually, to be strict, we require it to be valid and authorized.
    setAuthError('Invalid token format.');
    return false;
  };

  useEffect(() => {
    // Check local storage on mount
    const storedToken = localStorage.getItem('axim_passport_token');
    if (storedToken) {
      if (validateToken(storedToken)) {
        setToken(storedToken);
        setIsAuthenticated(true);
      } else {
        localStorage.removeItem('axim_passport_token');
      }
    }

    // Check URL parameters for auth callback
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    if (urlToken && window.location.pathname.startsWith('/auth/callback')) {
      if (validateToken(urlToken)) {
        setToken(urlToken);
        setIsAuthenticated(true);
        localStorage.setItem('axim_passport_token', urlToken);
        setAuthError('');
      }
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const loginWithPassport = useCallback(() => {
    window.location.href = 'https://passport.axim.us.com?redirect=onyx';
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setIsAuthenticated(false);
    localStorage.removeItem('axim_passport_token');
  }, []);

  return { token, isAuthenticated, loginWithPassport, logout, authError };
}
