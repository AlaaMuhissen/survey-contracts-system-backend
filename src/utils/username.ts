// src/utils/username.ts

/**
 * Converts a username to an internal email address for Firebase Auth.
 * Example:
 *   usernameToEmail("alaa")  →  "alaa@yourapp.local"
 */
export const usernameToEmail = (username: string): string => {
  return `${username.trim().toLowerCase()}@yourapp.local`;
};


/**
 * Converts an internal Firebase email back to a username.
 * Example:
 *   emailToUsername("alaa@yourapp.local")  →  "alaa"
 */
export const emailToUsername = (email: string): string => {
  return email.replace(/@yourapp\.local$/i, "");
};
