/**
 * Xano Metadata API client
 * Re-exports from modular API structure for backward compatibility
 */

export {
  ApiResponse,
  createApiClient,
  createApiClientFromProfile,
  getCliProfile,
  getDefaultProfileName,
  getMissingProfileError,
  getProfile,
  getProfileWarning,
  listProfileNames,
  loadCredentials,
  ProfileRequirementError,
  RequestDebugInfo,
  XanoApi,
} from './api/index.js'
