import { type ApiRoute, apiJson } from './api-routes.js'
import type { RoomHub } from './transport.js'

/** Reports the live hub's opt-in, rather than a client build-time environment flag. */
export function botCapabilitiesRoute(hub: Pick<RoomHub, 'botCapabilities'>): ApiRoute {
  return {
    prefix: '/api/bot-capabilities',
    async handle(request) {
      if (new URL(request.url).pathname !== '/api/bot-capabilities') {
        return apiJson({ error: 'Not found.' }, 404)
      }
      return apiJson(hub.botCapabilities())
    },
  }
}
