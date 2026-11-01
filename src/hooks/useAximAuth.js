import { useState, useEffect, useCallback } from 'react';
import useDesktopAgentStore from '../store/useDesktopAgentStore';

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

// Canonical role is super_admin. The other spellings remain accepted while the
// ecosystem converges; see edge-bridge/src/passport.ts.
const SUPER_ADMIN_ROLE = 'super_admin';
const SUPER_ADMIN_ROLES = ['super_admin', 'super-admin', 'superadmin', 'super_user', 'superuser'];

function hasSuperAdminRole(token) {
    const payload = parseJwt(token);
    if (!payload || (payload.exp && payload.exp * 1000 <= Date.now())) return false;
    return payload.app_metadata?.SUPER_ADMIN_ROLES.includes(String(role || '').toLowerCase());
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

export function useAximAuth() {
  const [authError, setAuthError] = useState('');

  const validateToken = useCallback(async (jwtToken) => {
    if (!jwtToken) return false;
    if (import.meta.env.DEV && jwtToken === 'dev-token') return true;
    // UI gating only; the edge worker re-verifies the signature and role on every call.
    if (!hasSuperAdminRole(jwtToken)) return false;

    try {
      const response = await fetch('https://passport.axim.us.com/api/v1/auth/verify-token', {
        headers: {
          'Authorization': `Bearer ${jwtToken}`
        }
      });
      if (!response.ok) return false;
      return true;
    } catch (e) {
      console.warn('Failed to contact passport; denying access');
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

    // Check for cookie
    const cookieToken = getCookie('axim_session');

    const activeToken = urlToken || cookieToken || localStorage.getItem('axim_passport_token');

    const initializeAuth = async () => {
      if (activeToken) {
        const isValid = await validateToken(activeToken);
        if (isValid) {
          setToken(activeToken);
          setIsAuthenticated(true);
          localStorage.setItem('axim_passport_token', activeToken);
          setAuthError('');
          useDesktopAgentStore.setState({ role: "super_admin", is_super_user: true, isSuperUser: true });
        } else {
          localStorage.removeItem('axim_passport_token');
          setToken(null);
          setIsAuthenticated(false);
          setAuthError('Not a super-admin or invalid token.');
          useDesktopAgentStore.setState({ role: "user", is_super_user: false, isSuperUser: false });
          window.location.href = 'https://passport.axim.us.com';
        }
        if (urlToken) {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete("token");
            window.history.replaceState({}, document.title, newUrl.pathname + newUrl.search);
        }
      } else {
        setToken(null);
        setIsAuthenticated(false);
        useDesktopAgentStore.setState({ role: "user", is_super_user: false, isSuperUser: false });
          window.location.href = 'https://passport.axim.us.com';
      }
    };
    initializeAuth();

    // Silent token refresh setup
    const refreshInterval = setInterval(async () => {
      const currentToken = localStorage.getItem('axim_passport_token');
      if (currentToken) {
        const payload = parseJwt(currentToken);
        if (payload && payload.exp) {
          const expiresAt = payload.exp * 1000;
          const timeUntilExpiry = expiresAt - Date.now();
          // If token expires in less than 15 minutes, try to refresh silently
          if (timeUntilExpiry < 15 * 60 * 1000 && timeUntilExpiry > 0) {
             try {
                const res = await fetch('https://passport.axim.us.com/api/v1/auth/refresh', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${currentToken}` }
                });
                if (res.ok) {
                   const data = await res.json();
                   if (data.token) {
                      localStorage.setItem('axim_passport_token', data.token);
                      setToken(data.token);
                   }
                }
             } catch (e) {
                console.warn("Silent token refresh failed", e);
             }
          } else if (timeUntilExpiry <= 0) {
             // Token already expired, clean up
             setToken(null);
             setIsAuthenticated(false);
             localStorage.removeItem('axim_passport_token');
             useDesktopAgentStore.setState({ role: "user", is_super_user: false, isSuperUser: false });
          window.location.href = 'https://passport.axim.us.com';
          }
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => clearInterval(refreshInterval);
  }, [validateToken]);

  const loginWithPassport = useCallback(() => {
    window.location.href = 'https://passport.axim.us.com?redirect=onyx';
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setIsAuthenticated(false);
    localStorage.removeItem('axim_passport_token');
    useDesktopAgentStore.setState({ role: "user", is_super_user: false, isSuperUser: false });
          window.location.href = 'https://passport.axim.us.com';
    // also clear cookie if possible, though it's cross-domain maybe
    document.cookie = 'axim_session=; Max-Age=0; path=/; domain=.axim.us.com';
  }, []);

  return { token, isAuthenticated, loginWithPassport, logout, authError };
}
