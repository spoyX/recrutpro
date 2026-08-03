import swaggerJsdoc from 'swagger-jsdoc';

/**
 * Swagger/OpenAPI skeleton (ARCHITECTURE.md Section 3 locks Swagger as the API
 * documentation tool). Paths are intentionally empty for now: each domain
 * router documents its own endpoints with JSDoc `@openapi` blocks, which the
 * `apis` glob below picks up as Phase 3 adds them.
 *
 * Both .ts and .js are globbed so the spec builds identically under tsx in dev
 * and under plain node against dist/ in the container.
 */
export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'RecrutPro API',
      version: '1.0.0',
      description: 'Système de Gestion du Recrutement — API REST.',
    },
    servers: [{ url: '/api/v1', description: 'Base path (ARCHITECTURE.md Section 9)' }],
    components: {
      schemas: {
        // The single error shape every endpoint returns on failure.
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', example: 'NOT_FOUND' },
                message: { type: 'string', example: "La ressource demandée n'existe pas." },
              },
            },
          },
        },
      },
    },
  },
  apis: [`${__dirname}/../routes/*.js`, `${__dirname}/../routes/*.ts`],
});
