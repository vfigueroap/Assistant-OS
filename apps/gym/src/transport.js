import { gymAccessToken } from './session.js'
import { createGymFetch } from './snapshot-transport.js'

export const gymFetch = createGymFetch({ getAccessToken: gymAccessToken })
