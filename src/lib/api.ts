/**
 * Xano Metadata API client
 * Re-exports from modular API structure for backward compatibility
 */

export {
  ApiResponse,
  createApiClient,
  createApiClientFromProfile,
  getDefaultProfileName,
  getProfile,
  getProfileWarning,
  listProfileNames,
  loadCredentials,
  RequestDebugInfo,
  XanoApi,
} from './api/index.js'
