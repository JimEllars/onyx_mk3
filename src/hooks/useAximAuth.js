import { useState, useEffect, useCallback } from 'react';

export function useAximAuth() {
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check local storage on mount
    const storedToken = localStorage.getItem('axim_passport_token');
    if (storedToken) {
      setToken(storedToken);
      setIsAuthenticated(true);
    }

    // Check URL parameters for auth callback
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    if (urlToken && window.location.pathname === '/auth/callback') {
      setToken(urlToken);
      setIsAuthenticated(true);
      localStorage.setItem('axim_passport_token', urlToken);

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

  return { token, isAuthenticated, loginWithPassport, logout };
}
