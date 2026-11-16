import { handleRequest } from '../apps/api/handler.js';

export default {
  fetch(request: Request) {
    const url = new URL(request.url);
    const route = url.searchParams.get('__route');
    if (!route) return handleRequest(request);
    if (!route.startsWith('/api/') && !route.startsWith('/gym/api/')) return Response.json({ error: 'Ruta no válida.' }, { status: 400 });
    url.pathname = route;
    url.searchParams.delete('__route');
    return handleRequest(new Request(url, request));
  },
};
