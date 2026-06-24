/**
 * Regex matching portable environment variable names: starts with a letter
 * or underscore, continues with letters, digits, or underscores. Shared by
 * validation (assertPortableEnvName) and quoting (filterStringEntries).
 */
export const PORTABLE_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
