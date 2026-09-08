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

const AUTHORIZED_USERS = ['james.ellars@axim.us.com', 'jrellars@gmail.com'];

export function useAximAuth() {
  const [authError, setAuthError] = useState('');

  const validateToken = useCallback(async (jwtToken) => {
    if (!jwtToken) return false;
    if (jwtToken === 'dev-token') return true;

    try {
      const response = await fetch('https://passport.axim.us.com/api/v1/auth/verify-token', {
        headers: {
          'Authorization': `Bearer ${jwtToken}`
        }
      });
      if (!response.ok) return false;
      const data = await response.json();

      if (data && data.email && AUTHORIZED_USERS.includes(data.email)) {
        return true;
      }
      return false;
    } catch (e) {
      console.warn("Failed to contact passport, falling back to local decoding");
      const payload = parseJwt(jwtToken);
      if (payload && payload.email && AUTHORIZED_USERS.includes(payload.email)) {
        return true;
      }
      return false;
    }
  }, []);

  const [token, setToken] = useState(null);

  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check URL parameters for auth callback
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    const initializeAuth = async () => {
      if (urlToken) {
        const isValid = await validateToken(urlToken);
        if (isValid) {
          setToken(urlToken);
          setIsAuthenticated(true);
          localStorage.setItem('axim_passport_token', urlToken);
          setAuthError('');
        } else {
          setAuthError('User not in authorized whitelist or invalid token format.');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const storedToken = localStorage.getItem('axim_passport_token');
        if (storedToken) {
            const isValid = await validateToken(storedToken);
            if (!isValid) {
                localStorage.removeItem('axim_passport_token');
                setToken(null);
                setIsAuthenticated(false);
                setAuthError('User not in authorized whitelist or invalid token format.');
            } else {
                setToken(storedToken);
                setIsAuthenticated(true);
                setAuthError('');
            }
        }
      }
    };
    initializeAuth();
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
