import { type ApiRoute, apiJson } from './api-routes.js'

/** Reports the live hub's opt-in, rather than a client build-time environment flag. */
export function botCapabilitiesRoute(midasAvailable: boolean): ApiRoute {
  return {
    prefix: '/api/bot-capabilities',
    async handle(request) {
      if (new URL(request.url).pathname !== '/api/bot-capabilities') {
        return apiJson({ error: 'Not found.' }, 404)
      }
      return apiJson({ midasAvailable })
    },
  }
}
