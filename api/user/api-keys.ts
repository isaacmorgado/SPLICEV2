import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ApiKeyService } from '../../lib/api-keys.js';

/**
 * User API Keys Management Endpoint
 *
 * GET    /api/user/api-keys - List all API keys (masked)
 * POST   /api/user/api-keys - Store/update an API key
 * DELETE /api/user/api-keys - Delete an API key
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Dynamic imports for Vercel bundling
  const auth = await import('../../lib/auth.js');
  const apiKeys = await import('../../lib/api-keys.js');
  const middleware = await import('../../lib/middleware.js');

  const { authenticateRequest } = auth;
  const { storeUserApiKey, listUserApiKeys, deleteUserApiKey, validateApiKeyFormat } = apiKeys;
  const { createErrorResponse } = middleware;

  try {
    // Authenticate request
    const payload = await authenticateRequest(req);
    if (!payload) {
      return res
        .status(401)
        .json(createErrorResponse(401, 'UNAUTHORIZED', 'Authentication required'));
    }

    const userId = payload.userId;

    // Handle different HTTP methods
    switch (req.method) {
      case 'GET':
        return handleList(userId, res);

      case 'POST':
        return handleStore(userId, req, res);

      case 'DELETE':
        return handleDelete(userId, req, res);

      default:
        return res
          .status(405)
          .json(createErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'));
    }
  } catch (error) {
    console.error('API keys endpoint error:', error);
    return res
      .status(500)
      .json(createErrorResponse(500, 'INTERNAL_ERROR', 'Internal server error'));
  }

  /**
   * List all user API keys (masked)
   */
  async function handleList(userId: string, res: VercelResponse) {
    const keys = await listUserApiKeys(userId);
    return res.status(200).json({
      success: true,
      apiKeys: keys.map((key) => ({
        id: key.id,
        service: key.service,
        keyName: key.keyName,
        maskedKey: key.maskedKey,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString(),
      })),
    });
  }

  /**
   * Store or update an API key
   */
  async function handleStore(userId: string, req: VercelRequest, res: VercelResponse) {
    const { service, apiKey, keyName } = req.body as {
      service?: string;
      apiKey?: string;
      keyName?: string;
    };

    // Validation
    if (!service || !apiKey) {
      return res
        .status(400)
        .json(createErrorResponse(400, 'VALIDATION_ERROR', 'Service and API key are required'));
    }

    const validServices = ['openai', 'elevenlabs', 'gemini', 'groq'];
    if (!validServices.includes(service)) {
      return res.status(400).json(
        createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid service type', {
          validServices,
        })
      );
    }

    // Validate API key format
    const validation = validateApiKeyFormat(service as ApiKeyService, apiKey);
    if (!validation.valid) {
      return res
        .status(400)
        .json(
          createErrorResponse(400, 'INVALID_API_KEY', validation.error || 'Invalid API key format')
        );
    }

    // Store the key
    const storedKey = await storeUserApiKey(userId, service as ApiKeyService, apiKey, keyName);

    return res.status(200).json({
      success: true,
      message: 'API key stored successfully',
      apiKey: {
        id: storedKey.id,
        service: storedKey.service,
        keyName: storedKey.keyName,
        maskedKey: storedKey.maskedKey,
        createdAt: storedKey.createdAt.toISOString(),
        updatedAt: storedKey.updatedAt.toISOString(),
      },
    });
  }

  /**
   * Delete an API key
   */
  async function handleDelete(userId: string, req: VercelRequest, res: VercelResponse) {
    const { service } = req.body as { service?: string };

    if (!service) {
      return res
        .status(400)
        .json(createErrorResponse(400, 'VALIDATION_ERROR', 'Service is required'));
    }

    const validServices = ['openai', 'elevenlabs', 'gemini', 'groq'];
    if (!validServices.includes(service)) {
      return res
        .status(400)
        .json(createErrorResponse(400, 'VALIDATION_ERROR', 'Invalid service type'));
    }

    const deleted = await deleteUserApiKey(userId, service as ApiKeyService);

    if (!deleted) {
      return res
        .status(404)
        .json(createErrorResponse(404, 'NOT_FOUND', 'API key not found for this service'));
    }

    return res.status(200).json({
      success: true,
      message: 'API key deleted successfully',
    });
  }
}
