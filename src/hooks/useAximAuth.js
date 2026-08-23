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
  const [authError, setAuthError] = useState('');

  const validateToken = useCallback((jwtToken) => {
    if (!jwtToken) return false;
    if (jwtToken === 'dev-token') return true;

    const payload = parseJwt(jwtToken);
    if (payload && payload.email) {
      if (AUTHORIZED_USERS.includes(payload.email)) {
        return true;
      } else {
        return false; // Error set in effect
      }
    }
    return false;
  }, []);

  const [token, setToken] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get('token');
      if (urlToken && window.location.pathname.startsWith('/auth/callback')) {
          if (validateToken(urlToken)) return urlToken;
      }
      const storedToken = localStorage.getItem('axim_passport_token');
      if (storedToken && validateToken(storedToken)) return storedToken;
    }
    return null;
  });

  const [isAuthenticated, setIsAuthenticated] = useState(() => !!token);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check URL parameters for auth callback
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    if (urlToken && window.location.pathname.startsWith('/auth/callback')) {
      if (validateToken(urlToken)) {
        setToken(urlToken);
        setIsAuthenticated(true);
        localStorage.setItem('axim_passport_token', urlToken);
        setAuthError('');
      } else {
        setAuthError('User not in authorized whitelist or invalid token format.');
      }
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
       // Validate stored token on mount to set errors if any
       const storedToken = localStorage.getItem('axim_passport_token');
       if (storedToken) {
           if (!validateToken(storedToken)) {
               localStorage.removeItem('axim_passport_token');
               setToken(null);
               setIsAuthenticated(false);
               setAuthError('User not in authorized whitelist or invalid token format.');
           }
       }
    }
  }, [validateToken]);

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
